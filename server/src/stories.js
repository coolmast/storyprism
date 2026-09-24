import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import {
  listAlbums,
  getAlbumPhotos,
  getPhotosByDateRange,
  getPhotosByLabel,
  getPhotosBySubject,
  thumbUrl,
} from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";
import { DEFAULT_THEME } from "./themes.js";
import { isAllowedEmbedHost } from "./embeds.js";
import { suggestPlacesForStop, photosMatchingPlace } from "./places.js";
import { DEFAULT_LANGUAGE } from "./i18n.js";
import { PDF_TEMPLATE_IDS } from "./pdfTemplates.js";
import { PDF_LAYOUT_PACKS, DEFAULT_LAYOUT_PACK } from "./pdfLayoutPacks.js";
import { BOOK_LAYOUT_PACKS, DEFAULT_BOOK_LAYOUT_PACK } from "./photobook/bookLayoutPacks.js";
import { PDF_PAPER_SIZES, DEFAULT_PAPER_SIZE } from "./pdfPaperSizes.js";
import { BOOK_PRODUCTS, DEFAULT_BOOK_PRODUCT } from "./photobook/products.js";
import { SPREAD_LAYOUT_IDS, BOOK_FONTS, CEWE_FONTS } from "./photobook/spreadLayouts.js";

// The AI always returns a full https:// URL when it includes one at all, but
// a human editing/adding this field by hand will often just type
// "example.com" - silently dropping that on save (a strict http(s):// check
// would) defeats the entire point of letting them fix or add a link. Add
// the protocol if it's missing rather than reject, but still refuse
// anything that isn't at least domain-shaped.
// Per-stop photobook pacing: how many photos each of the stop's photo
// spreads holds, in order (the rest of the stop is laid out automatically).
// Stored as a JSON array; anything malformed is treated as "automatic".
function parseSpreadCounts(json) {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n >= 1 && n <= 10) : [];
  } catch {
    return [];
  }
}

function serializeSpreadCounts(counts) {
  if (!Array.isArray(counts)) return null;
  const clean = counts.filter((n) => Number.isInteger(n) && n >= 1 && n <= 10).slice(0, 60);
  return clean.length ? JSON.stringify(clean) : null;
}

// Text size multiplier for the printed book (50 %-200 %).
function textScale(value, fallback) {
  const v = Number(value);
  if (Number.isFinite(v) && v >= 0.5 && v <= 2) return Math.round(v * 100) / 100;
  return fallback ?? 1;
}

function validFont(name, fallback) {
  if (name === null) return null;
  if (name && [...BOOK_FONTS, ...CEWE_FONTS].some((f) => f.name === name)) return name;
  return fallback || null;
}

function normalizeWebsiteUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(withProtocol) ? withProtocol : "";
}

const insertStory = db.prepare(`
  INSERT INTO stories (id, album_uid, album_title, title, intro, outro, theme, content_language, pdf_layout_pack, source_type, source_config, created_at, updated_at)
  VALUES (@id, @albumUid, @albumTitle, @title, '', '', @theme, @contentLanguage, '${DEFAULT_LAYOUT_PACK}', @sourceType, @sourceConfig, @now, @now)
`);
const insertStop = db.prepare(`
  INSERT INTO stops (id, story_id, position, lat, lng, place_label, started_at, ended_at, heading, narrative, theme_id)
  VALUES (@id, @storyId, @position, @lat, @lng, @placeLabel, @startedAt, @endedAt, @heading, '', @themeId)
`);
const insertPhoto = db.prepare(`
  INSERT INTO stop_photos (id, stop_id, photo_uid, hash, width, height, position, caption, included, title, place_label)
  VALUES (@id, @stopId, @photoUid, @hash, @width, @height, @position, '', @included, @title, @placeLabel)
`);

// Stops from a real trip can have 50-100+ photos; defaulting all of them to
// "included" would make the editor an unusable wall of caption boxes.
// Pre-select a spread across the stop's time range so it starts curated,
// and let the user add more. Shared with storyUpdate.js: a brand-new stop
// discovered by "check for new photos" is exactly the same situation a
// freshly-created story's own stop is in, and deserves the same treatment.
const CURATED_PER_STOP = 20;
export function curatedIncluded(photoCount, index) {
  const step = Math.max(1, Math.floor(photoCount / CURATED_PER_STOP));
  return index % step === 0;
}

function insertStops(storyId, stops) {
  stops.forEach((stop, i) => {
    const stopId = randomUUID();
    insertStop.run({
      id: stopId,
      storyId,
      position: i,
      lat: stop.lat,
      lng: stop.lng,
      placeLabel: stop.placeCity || stop.placeLabel || null,
      startedAt: stop.startedAt,
      endedAt: stop.endedAt,
      heading: stop.placeCity || stop.placeLabel || `Stop ${i + 1}`,
      themeId: stop.themeId || null,
    });

    stop.photos.forEach((p, j) => {
      insertPhoto.run({
        id: randomUUID(),
        stopId,
        photoUid: p.uid,
        hash: p.thumbHash,
        width: p.width || null,
        height: p.height || null,
        position: j,
        included: curatedIncluded(stop.photos.length, j) ? 1 : 0,
        title: p.title || "",
        placeLabel: p.placeLabel || "",
      });
    });
  });
}

// One or several source albums/moments merged into one itinerary - photos
// appearing in more than one selected album (not unusual for PhotoPrism's
// auto "moment" albums, which can overlap a manually-curated one covering
// the same trip) are deduplicated by photo UID before clustering, so a
// shared photo doesn't show up as two stops' worth of the same moment.
export async function createStoryFromAlbums(albumUids, title, contentLanguage = DEFAULT_LANGUAGE) {
  const albums = await listAlbums();
  const selected = albumUids.map((uid) => albums.find((a) => a.uid === uid)).filter(Boolean);
  if (selected.length === 0) throw new Error("Album not found");

  const photoLists = await Promise.all(selected.map((a) => getAlbumPhotos(a.uid)));
  const seen = new Set();
  const photos = [];
  for (const list of photoLists) {
    for (const p of list) {
      if (seen.has(p.uid)) continue;
      seen.add(p.uid);
      photos.push(p);
    }
  }
  const stops = buildItinerary(photos);

  const storyId = randomUUID();
  const now = new Date().toISOString();
  const defaultTitle = selected.map((a) => a.title).join(" + ");
  const storyTitle = (title || "").trim() || defaultTitle;

  const tx = db.transaction(() => {
    insertStory.run({
      id: storyId,
      // Only meaningful (and only ever used) as a "look the album back up"
      // reference, which stops making sense once a story merges more than
      // one - see createStoryFromDateRange's album_uid below for the same
      // "no single source album" sentinel.
      albumUid: selected.length === 1 ? selected[0].uid : "",
      albumTitle: storyTitle,
      title: storyTitle,
      theme: DEFAULT_THEME,
      contentLanguage,
      sourceType: "albums",
      sourceConfig: JSON.stringify({ albumUids }),
      now,
    });
    insertStops(storyId, stops);
  });
  tx();

  return getStory(storyId);
}

// For trips that don't fit a single album or PhotoPrism "moment" - crossing
// New Year's (splits across two yearly moments) or spanning several
// countries. Not backed by any one PhotoPrism album, so album_uid is left
// empty rather than added as a nullable column - the schema has no
// migration mechanism, and an empty string is a fine "no source album"
// sentinel given album_uid is only ever used to look the album back up,
// which a date-range story has no reason to do.
export async function createStoryFromDateRange(from, to, title, contentLanguage = DEFAULT_LANGUAGE) {
  const photos = await getPhotosByDateRange(from, to);
  const stops = buildItinerary(photos);

  const storyId = randomUUID();
  const now = new Date().toISOString();
  const storyTitle = (title || "").trim() || `Trip ${from} – ${to}`;

  const tx = db.transaction(() => {
    insertStory.run({
      id: storyId,
      albumUid: "",
      albumTitle: storyTitle,
      title: storyTitle,
      theme: DEFAULT_THEME,
      contentLanguage,
      sourceType: "date_range",
      sourceConfig: JSON.stringify({ from, to }),
      now,
    });
    insertStops(storyId, stops);
  });
  tx();

  return getStory(storyId);
}

// "Yearbook" mode: instead of one chronological itinerary, a date range's
// photos are split into theme sections the user picked from suggested
// candidates (see photoThemes.js) - or hand-defined custom date sub-ranges,
// which are just a type: "trip" theme whose from/to came from the user
// instead of detection - in the order trip -> content -> person, followed
// by one ordinary chronological tail for whatever no theme claimed. A photo
// can belong to more than one selected theme (an "airport" beach-vacation
// shot can be both the trip and a "Beach" content theme) - intentional
// per-theme duplication, not deduped against other themes - but only ever
// appears once more, in the chronological tail, if no theme claimed it at
// all. Split out from story creation so the exact same planning logic
// backs both the live preview (GET /api/theme-plan-preview) and actually
// creating the story - the preview is never a guess at what creation will
// do, it's a dry run of the same code.
// A popular label (or a long vacation) can pull in far more photos than
// any one book section should reasonably hold - a "Camping" theme matched
// 405 photos across one real 9-month range, ballooning that one story to
// >1MB and tripping a reverse proxy's request-size limit on export. Rather
// than dropping the overflow, only the evenly-sampled highlights become
// this theme's own section; the rest are left unclaimed, so they still
// show up in whichever chronological stop they naturally belong to
// instead of vanishing - same "nothing is silently dropped" guarantee,
// just not all under this one heading.
const MAX_THEME_STOP_PHOTOS = 120;

function sampleEvenly(photos, max) {
  if (photos.length <= max) return photos;
  const step = photos.length / max;
  const sampled = [];
  for (let i = 0; i < max; i++) {
    sampled.push(photos[Math.floor(i * step)]);
  }
  return sampled;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// buildItinerary's per-stop clustering (a few hours/km apart = a new stop)
// is tuned for telling apart the distinct legs of *one* trip - across a
// whole yearbook range it does something different and much less useful:
// every separate errand/outing anywhere in a family's home city over 9
// months becomes its own stop, one real case going from a reasonable-
// sounding "31 stops" (only because photo fetching was silently truncated
// to April - see getPhotosByDateRange) to 100+ once that was fixed and the
// whole year was actually considered. That also matches what was actually
// asked for: "I'd put leftovers in *a* chronological section" - singular,
// not a rediscovered day-by-day itinerary. One section per calendar month
// is simple, predictable (at most 12 for a full year), and keeps a
// yearbook's non-thematic content readable as a monthly diary instead of
// a wall of tiny same-city stops.
function groupLeftoverByMonth(photos) {
  const sorted = [...photos].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
  const byMonth = new Map();
  for (const p of sorted) {
    const key = p.takenAt.slice(0, 7); // YYYY-MM
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }
  return [...byMonth.entries()].map(([key, monthPhotos]) => {
    const [year, month] = key.split("-");
    return {
      photos: monthPhotos,
      lat: null,
      lng: null,
      placeLabel: `${MONTH_NAMES[Number(month) - 1]} ${year}`,
      placeCity: null,
      startedAt: monthPhotos[0].takenAt,
      endedAt: monthPhotos[monthPhotos.length - 1].takenAt,
      themeId: `leftover-${key}`,
    };
  });
}

export async function planThemeStops({ from, to, themes }) {
  const rangePhotos = await getPhotosByDateRange(from, to);
  const claimed = new Set();
  const themeStops = [];

  const typeOrder = { trip: 0, content: 1, person: 2 };
  const orderedThemes = [...themes].sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9));

  for (const theme of orderedThemes) {
    let photos;
    if (theme.type === "trip") {
      const fromMs = new Date(`${theme.from}T00:00:00Z`).getTime();
      const toMs = new Date(`${theme.to}T23:59:59.999Z`).getTime();
      photos = rangePhotos.filter((p) => {
        const t = new Date(p.takenAt).getTime();
        return t >= fromMs && t <= toMs;
      });
    } else if (theme.type === "content") {
      photos = await getPhotosByLabel(theme.slug, from, to);
    } else if (theme.type === "person") {
      photos = await getPhotosBySubject(theme.subjectUid, from, to);
    } else {
      continue;
    }
    if (photos.length === 0) continue;

    photos = [...photos].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
    photos = sampleEvenly(photos, MAX_THEME_STOP_PHOTOS);
    for (const p of photos) claimed.add(p.uid);
    themeStops.push({
      photos,
      lat: null,
      lng: null,
      placeLabel: theme.title,
      placeCity: null,
      startedAt: photos[0].takenAt,
      endedAt: photos[photos.length - 1].takenAt,
      themeId: theme.id,
    });
  }

  // Deliberately *not* capped like the theme stops above: there's no
  // further fallback tier left for a leftover photo to land in, so capping
  // it here would actually drop it from the story rather than just move it
  // - unlike the theme cap, where the overflow still shows up in whichever
  // month it belongs to. A busy month can still run large, but every one
  // of its photos is genuinely in the book somewhere.
  const leftoverPhotos = rangePhotos.filter((p) => !claimed.has(p.uid));
  const leftoverStops = groupLeftoverByMonth(leftoverPhotos);
  const allStops = [...themeStops, ...leftoverStops];

  // Same shape buildItinerary itself returns, so the New Story preview
  // (ItineraryMap/StopList) can render theme-plan stops with zero changes -
  // plus themeId, ignored by that preview, which is what lets a later
  // "check for new photos" match a freshly recomputed group back to the
  // existing stop that holds its narrative/heading edits (storyUpdate.js).
  return allStops.map((s, i) => ({
    index: i,
    lat: s.lat,
    lng: s.lng,
    placeLabel: s.placeLabel,
    placeCity: s.placeCity,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    photoCount: s.photos.length,
    photos: s.photos,
    themeId: s.themeId,
  }));
}

export async function createStoryFromThemePlan({ from, to, title, contentLanguage = DEFAULT_LANGUAGE, themes }) {
  const allStops = await planThemeStops({ from, to, themes });

  const storyId = randomUUID();
  const now = new Date().toISOString();
  const storyTitle = (title || "").trim() || `Yearbook ${from} – ${to}`;

  const tx = db.transaction(() => {
    insertStory.run({
      id: storyId,
      albumUid: "",
      albumTitle: storyTitle,
      title: storyTitle,
      theme: DEFAULT_THEME,
      contentLanguage,
      sourceType: "theme_plan",
      sourceConfig: JSON.stringify({ from, to, themes }),
      now,
    });
    insertStops(storyId, allStops);
  });
  tx();

  return getStory(storyId);
}

export function listStories() {
  return db
    .prepare(
      `SELECT s.id, s.album_uid as albumUid, s.album_title as albumTitle, s.title,
              s.updated_at as updatedAt,
              (SELECT COUNT(*) FROM stops WHERE story_id = s.id) as stopCount
       FROM stories s ORDER BY s.updated_at DESC`
    )
    .all();
}

export function getStory(id) {
  const story = db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  if (!story) return null;

  const stops = db
    .prepare("SELECT * FROM stops WHERE story_id = ? ORDER BY position")
    .all(id);

  const photoStmt = db.prepare(
    "SELECT * FROM stop_photos WHERE stop_id = ? ORDER BY position"
  );
  const embedStmt = db.prepare(
    "SELECT * FROM stop_embeds WHERE stop_id = ? ORDER BY position"
  );
  const infoCardStmt = db.prepare(
    "SELECT * FROM stop_info_cards WHERE stop_id = ? ORDER BY position"
  );

  return {
    id: story.id,
    albumUid: story.album_uid,
    albumTitle: story.album_title,
    title: story.title,
    intro: story.intro,
    outro: story.outro,
    theme: story.theme,
    contentLanguage: story.content_language,
    // Non-empty only for a story created from a saved search (album(s), a
    // date range, or a theme plan) - what "check for new photos" needs to
    // exist at all (storyUpdate.js). Empty for anything older than that
    // feature, which just hides the button rather than guessing at a source.
    sourceType: story.source_type || "",
    pdfLayoutPack: story.pdf_layout_pack,
    pdfPaperSize: story.pdf_paper_size,
    bookProduct: story.book_product,
    bookLayoutPack: story.book_layout_pack,
    bookTitleFont: story.book_title_font || null,
    bookBodyFont: story.book_body_font || null,
    bookKeepBursts: !!story.book_keep_bursts,
    bookHideIntro: !!story.book_hide_intro,
    bookHideOutro: !!story.book_hide_outro,
    bookTitleScale: story.book_title_scale ?? 1,
    bookBodyScale: story.book_body_scale ?? 1,
    createdAt: story.created_at,
    updatedAt: story.updated_at,
    stops: stops.map((s) => {
      const photoRows = photoStmt.all(s.id);
      const includedRows = photoRows.filter((p) => p.included);

      return {
        id: s.id,
        position: s.position,
        lat: s.lat,
        lng: s.lng,
        placeLabel: s.place_label,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        heading: s.heading,
        narrative: s.narrative,
        research: s.research,
        pullQuote: s.pull_quote,
        pdfTemplateOverride: s.pdf_template_override || null,
        bookLayoutOverride: s.book_layout_override || null,
        bookSpreadCounts: parseSpreadCounts(s.book_spread_counts),
        bookHideText: !!s.book_hide_text,
        suggestedPlaces: suggestPlacesForStop(
          includedRows.map((p) => ({ title: p.title, placeLabel: p.place_label }))
        ),
        photos: photoRows.map((p) => ({
          id: p.id,
          photoUid: p.photo_uid,
          hash: p.hash || null,
          thumbUrl: p.hash ? thumbUrl(p.hash, "fit_720") : null,
          fullUrl: p.hash ? thumbUrl(p.hash, "fit_2048") : null,
          width: p.width,
          height: p.height,
          position: p.position,
          caption: p.caption,
          included: !!p.included,
          featured: !!p.featured,
        })),
        embeds: embedStmt.all(s.id).map((e) => ({
          id: e.id,
          provider: e.provider,
          url: e.url,
          title: e.title,
        })),
        infoCards: infoCardStmt.all(s.id).map((c) => ({
          id: c.id,
          bookHidden: !!c.book_hidden,
          placeName: c.place_name,
          subtitle: c.subtitle,
          summary: c.summary,
          facts: JSON.parse(c.facts || "[]"),
          placement: c.placement || "top",
          // Both the raw hash and its derived thumb URL: updateStory's save
          // path reads heroPhotoHash back from whatever the client sends, so
          // omitting it here would silently wipe every existing hero photo
          // on the next save of a stop the user never touched the hero
          // picker for at all - found by reproducing exactly that.
          heroPhotoHash: c.hero_photo_hash || null,
          heroPhotoUrl: c.hero_photo_hash ? thumbUrl(c.hero_photo_hash, "fit_1280") : null,
          websiteUrl: c.website_url || "",
        })),
      };
    }),
  };
}

const updateStoryStmt = db.prepare(
  "UPDATE stories SET title = @title, intro = @intro, outro = @outro, theme = @theme, content_language = @contentLanguage, pdf_layout_pack = @pdfLayoutPack, pdf_paper_size = @pdfPaperSize, book_product = @bookProduct, book_layout_pack = @bookLayoutPack, book_title_font = @bookTitleFont, book_body_font = @bookBodyFont, book_keep_bursts = @bookKeepBursts, book_hide_intro = @bookHideIntro, book_hide_outro = @bookHideOutro, book_title_scale = @bookTitleScale, book_body_scale = @bookBodyScale, updated_at = @now WHERE id = @id"
);
// Upsert, not a plain UPDATE: the editor can now create brand-new stops
// client-side (splitting one stop into two, or adding a blank section) and
// send them back with a client-generated id that doesn't exist in the
// database yet - a plain UPDATE would silently affect 0 rows for those.
// Position is included so inserting a stop in the middle (or reordering)
// is reflected, same as photos already work.
const upsertStopStmt = db.prepare(`
  INSERT INTO stops (id, story_id, position, lat, lng, place_label, started_at, ended_at, heading, narrative, research, pull_quote, pdf_template_override, book_layout_override, book_spread_counts, book_hide_text)
  VALUES (@id, @storyId, @position, @lat, @lng, @placeLabel, @startedAt, @endedAt, @heading, @narrative, @research, @pullQuote, @pdfTemplateOverride, @bookLayoutOverride, @bookSpreadCounts, @bookHideText)
  ON CONFLICT(id) DO UPDATE SET
    position = excluded.position,
    lat = excluded.lat,
    lng = excluded.lng,
    place_label = excluded.place_label,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    heading = excluded.heading,
    narrative = excluded.narrative,
    research = excluded.research,
    pull_quote = excluded.pull_quote,
    pdf_template_override = excluded.pdf_template_override,
    book_layout_override = excluded.book_layout_override,
    book_spread_counts = excluded.book_spread_counts,
    book_hide_text = excluded.book_hide_text
`);
// Matched by id alone (a photo's id is globally unique, not just within its
// stop) and stop_id is now part of the SET clause, not the WHERE - splitting
// a stop moves some of its photos to a newly-created stop, which means the
// row's stop_id itself needs to change. Matching by "id AND stop_id" (the
// old query) would silently no-op for exactly that move, since the row's
// *current* stop_id in the database is the old one.
const updatePhotoStmt = db.prepare(
  "UPDATE stop_photos SET stop_id = @stopId, caption = @caption, included = @included, featured = @featured, position = @position WHERE id = @id"
);
const clearFeaturedStmt = db.prepare(
  "UPDATE stop_photos SET featured = 0 WHERE stop_id = @stopId"
);
const deleteEmbedsStmt = db.prepare("DELETE FROM stop_embeds WHERE stop_id = @stopId");
const insertEmbedStmt = db.prepare(`
  INSERT INTO stop_embeds (id, stop_id, provider, url, title, position)
  VALUES (@id, @stopId, @provider, @url, @title, @position)
`);
const deleteInfoCardsStmt = db.prepare("DELETE FROM stop_info_cards WHERE stop_id = @stopId");
const insertInfoCardStmt = db.prepare(`
  INSERT INTO stop_info_cards (id, stop_id, place_name, subtitle, summary, facts, position, placement, hero_photo_hash, website_url, book_hidden)
  VALUES (@id, @stopId, @placeName, @subtitle, @summary, @facts, @position, @placement, @heroPhotoHash, @websiteUrl, @bookHidden)
`);
const touchStoryStmt = db.prepare("UPDATE stories SET updated_at = @now WHERE id = @id");

export function updateStory(id, data) {
  const existing = getStory(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    updateStoryStmt.run({
      id,
      title: data.title ?? existing.title,
      intro: data.intro ?? existing.intro,
      outro: data.outro ?? existing.outro,
      theme: data.theme ?? existing.theme,
      contentLanguage: data.contentLanguage ?? existing.contentLanguage,
      pdfLayoutPack:
        data.pdfLayoutPack in PDF_LAYOUT_PACKS
          ? data.pdfLayoutPack
          : existing.pdfLayoutPack || DEFAULT_LAYOUT_PACK,
      pdfPaperSize:
        data.pdfPaperSize in PDF_PAPER_SIZES ? data.pdfPaperSize : existing.pdfPaperSize || DEFAULT_PAPER_SIZE,
      bookProduct:
        data.bookProduct in BOOK_PRODUCTS ? data.bookProduct : existing.bookProduct || DEFAULT_BOOK_PRODUCT,
      bookLayoutPack:
        data.bookLayoutPack in BOOK_LAYOUT_PACKS
          ? data.bookLayoutPack
          : existing.bookLayoutPack || DEFAULT_BOOK_LAYOUT_PACK,
      bookTitleFont: validFont(data.bookTitleFont, existing.bookTitleFont),
      bookBodyFont: validFont(data.bookBodyFont, existing.bookBodyFont),
      bookKeepBursts: (data.bookKeepBursts ?? existing.bookKeepBursts) ? 1 : 0,
      bookHideIntro: (data.bookHideIntro ?? existing.bookHideIntro) ? 1 : 0,
      bookHideOutro: (data.bookHideOutro ?? existing.bookHideOutro) ? 1 : 0,
      bookTitleScale: textScale(data.bookTitleScale, existing.bookTitleScale),
      bookBodyScale: textScale(data.bookBodyScale, existing.bookBodyScale),
      now,
    });

    const stopsData = data.stops ?? [];
    stopsData.forEach((stop, stopIndex) => {
      upsertStopStmt.run({
        id: stop.id,
        storyId: id,
        position: stopIndex,
        lat: stop.lat ?? null,
        lng: stop.lng ?? null,
        placeLabel: stop.placeLabel ?? null,
        startedAt: stop.startedAt ?? null,
        endedAt: stop.endedAt ?? null,
        pdfTemplateOverride: PDF_TEMPLATE_IDS.includes(stop.pdfTemplateOverride) ? stop.pdfTemplateOverride : null,
        bookLayoutOverride: SPREAD_LAYOUT_IDS.includes(stop.bookLayoutOverride) ? stop.bookLayoutOverride : null,
        bookSpreadCounts: serializeSpreadCounts(stop.bookSpreadCounts),
        bookHideText: stop.bookHideText ? 1 : 0,
        heading: stop.heading ?? "",
        narrative: stop.narrative ?? "",
        research: stop.research ?? "",
        pullQuote: stop.pullQuote ?? "",
      });
      // Only one featured photo per stop: clear, then set the one the
      // client marked (if any), rather than trusting every row's flag.
      clearFeaturedStmt.run({ stopId: stop.id });
      // Position comes from array order, not a client-sent field: the
      // editor's drag-to-reorder just reorders this array client-side.
      (stop.photos ?? []).forEach((photo, index) => {
        updatePhotoStmt.run({
          id: photo.id,
          stopId: stop.id,
          caption: photo.caption ?? "",
          included: photo.included === false ? 0 : 1,
          featured: photo.featured ? 1 : 0,
          position: index,
        });
      });

      // Full-replace rather than diff/upsert: the list is short, and this
      // avoids needing to reconcile client-generated vs server-generated
      // ids for a field with no other references.
      deleteEmbedsStmt.run({ stopId: stop.id });
      (stop.embeds ?? [])
        .filter((e) => e.url && isAllowedEmbedHost(e.url))
        .forEach((embed, index) => {
          insertEmbedStmt.run({
            id: randomUUID(),
            stopId: stop.id,
            provider: embed.provider || "Route",
            url: embed.url,
            title: embed.title || "",
            position: index,
          });
        });

      deleteInfoCardsStmt.run({ stopId: stop.id });
      (stop.infoCards ?? []).forEach((card, index) => {
        insertInfoCardStmt.run({
          // Keep a card's id across saves (the book's per-card settings and
          // the editor refer to it); only new cards get a fresh one.
          id: typeof card.id === "string" && /^[0-9a-f-]{36}$/i.test(card.id) ? card.id : randomUUID(),
          bookHidden: card.bookHidden ? 1 : 0,
          stopId: stop.id,
          placeName: card.placeName || "",
          subtitle: card.subtitle || "",
          summary: card.summary || "",
          facts: JSON.stringify(card.facts || []),
          position: index,
          placement: ["top", "middle", "end"].includes(card.placement) ? card.placement : "top",
          heroPhotoHash: card.heroPhotoHash || null,
          // Re-validated here too, not just at generation time - never trust
          // a client-supplied string as a safe link target without a check.
          websiteUrl: normalizeWebsiteUrl(card.websiteUrl),
        });
      });
    });

    // Prune stops no longer present (e.g. a "remove section" the user
    // triggered client-side) - guarded on a non-empty array so a client
    // bug or bad payload that sends no stops at all can't wipe every stop
    // in the story.
    if (stopsData.length > 0) {
      const keepIds = stopsData.map((s) => s.id);
      db.prepare(
        `DELETE FROM stops WHERE story_id = ? AND id NOT IN (${keepIds.map(() => "?").join(",")})`
      ).run(id, ...keepIds);
    }

    touchStoryStmt.run({ id, now });
  });
  tx();

  return getStory(id);
}

// For the info card hero-image picker: which of this stop's photos are the
// ones that actually signaled this place name, so the user picks from a
// short relevant set instead of the whole stop. That name match only works
// for cards created from a suggestion chip (the name came from a photo's
// own PlaceLabel/title in the first place); a card added by typing an
// arbitrary name - "Eiffel Tower", a restaurant, ... - won't match any
// photo's metadata at all, so fall back to every photo in the section
// rather than leaving the picker empty.
export function getMatchingPhotosForPlace(stopId, placeName) {
  const rows = db
    .prepare("SELECT hash, title, place_label FROM stop_photos WHERE stop_id = ? AND hash IS NOT NULL")
    .all(stopId);
  const photos = rows.map((r) => ({ hash: r.hash, title: r.title, placeLabel: r.place_label }));
  const matched = photosMatchingPlace(photos, placeName);
  const exact = matched.length > 0;
  const result = exact ? matched : photos;
  return { exact, photos: result.map((p) => ({ hash: p.hash, thumbUrl: thumbUrl(p.hash, "fit_720") })) };
}

export function deleteStory(id) {
  return db.prepare("DELETE FROM stories WHERE id = ?").run(id).changes > 0;
}
