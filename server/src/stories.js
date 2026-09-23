import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { listAlbums, getAlbumPhotos, getPhotosByDateRange, thumbUrl } from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";
import { DEFAULT_THEME } from "./themes.js";
import { isAllowedEmbedHost } from "./embeds.js";
import { suggestPlacesForStop, photosMatchingPlace } from "./places.js";
import { DEFAULT_LANGUAGE } from "./i18n.js";
import { PDF_TEMPLATE_IDS } from "./pdfTemplates.js";
import { PDF_LAYOUT_PACKS, DEFAULT_LAYOUT_PACK } from "./pdfLayoutPacks.js";
import { PDF_PAPER_SIZES, DEFAULT_PAPER_SIZE } from "./pdfPaperSizes.js";
import { BOOK_PRODUCTS, DEFAULT_BOOK_PRODUCT } from "./photobook/products.js";
import { SPREAD_LAYOUT_IDS } from "./photobook/spreadLayouts.js";

// The AI always returns a full https:// URL when it includes one at all, but
// a human editing/adding this field by hand will often just type
// "example.com" - silently dropping that on save (a strict http(s):// check
// would) defeats the entire point of letting them fix or add a link. Add
// the protocol if it's missing rather than reject, but still refuse
// anything that isn't at least domain-shaped.
function normalizeWebsiteUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(withProtocol) ? withProtocol : "";
}

const insertStory = db.prepare(`
  INSERT INTO stories (id, album_uid, album_title, title, intro, outro, theme, content_language, pdf_layout_pack, created_at, updated_at)
  VALUES (@id, @albumUid, @albumTitle, @title, '', '', @theme, @contentLanguage, '${DEFAULT_LAYOUT_PACK}', @now, @now)
`);
const insertStop = db.prepare(`
  INSERT INTO stops (id, story_id, position, lat, lng, place_label, started_at, ended_at, heading, narrative)
  VALUES (@id, @storyId, @position, @lat, @lng, @placeLabel, @startedAt, @endedAt, @heading, '')
`);
const insertPhoto = db.prepare(`
  INSERT INTO stop_photos (id, stop_id, photo_uid, hash, width, height, position, caption, included, title, place_label)
  VALUES (@id, @stopId, @photoUid, @hash, @width, @height, @position, '', @included, @title, @placeLabel)
`);

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
    });
    // Stops from a real trip can have 50-100+ photos; defaulting all of
    // them to "included" would make the editor an unusable wall of
    // caption boxes. Pre-select a spread across the stop's time range so
    // the story starts curated, and let the user add more.
    const CURATED_PER_STOP = 20;
    const step = Math.max(1, Math.floor(stop.photos.length / CURATED_PER_STOP));

    stop.photos.forEach((p, j) => {
      insertPhoto.run({
        id: randomUUID(),
        stopId,
        photoUid: p.uid,
        hash: p.thumbHash,
        width: p.width || null,
        height: p.height || null,
        position: j,
        included: j % step === 0 ? 1 : 0,
        title: p.title || "",
        placeLabel: p.placeLabel || "",
      });
    });
  });
}

export async function createStoryFromAlbum(albumUid, contentLanguage = DEFAULT_LANGUAGE) {
  const albums = await listAlbums();
  const album = albums.find((a) => a.uid === albumUid);
  if (!album) throw new Error("Album not found");

  const photos = await getAlbumPhotos(albumUid);
  const stops = buildItinerary(photos);

  const storyId = randomUUID();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    insertStory.run({
      id: storyId,
      albumUid,
      albumTitle: album.title,
      title: album.title,
      theme: DEFAULT_THEME,
      contentLanguage,
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
      now,
    });
    insertStops(storyId, stops);
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
    pdfLayoutPack: story.pdf_layout_pack,
    pdfPaperSize: story.pdf_paper_size,
    bookProduct: story.book_product,
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
  "UPDATE stories SET title = @title, intro = @intro, outro = @outro, theme = @theme, content_language = @contentLanguage, pdf_layout_pack = @pdfLayoutPack, pdf_paper_size = @pdfPaperSize, book_product = @bookProduct, updated_at = @now WHERE id = @id"
);
// Upsert, not a plain UPDATE: the editor can now create brand-new stops
// client-side (splitting one stop into two, or adding a blank section) and
// send them back with a client-generated id that doesn't exist in the
// database yet - a plain UPDATE would silently affect 0 rows for those.
// Position is included so inserting a stop in the middle (or reordering)
// is reflected, same as photos already work.
const upsertStopStmt = db.prepare(`
  INSERT INTO stops (id, story_id, position, lat, lng, place_label, started_at, ended_at, heading, narrative, research, pull_quote, pdf_template_override, book_layout_override)
  VALUES (@id, @storyId, @position, @lat, @lng, @placeLabel, @startedAt, @endedAt, @heading, @narrative, @research, @pullQuote, @pdfTemplateOverride, @bookLayoutOverride)
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
    book_layout_override = excluded.book_layout_override
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
  INSERT INTO stop_info_cards (id, stop_id, place_name, subtitle, summary, facts, position, placement, hero_photo_hash, website_url)
  VALUES (@id, @stopId, @placeName, @subtitle, @summary, @facts, @position, @placement, @heroPhotoHash, @websiteUrl)
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
          id: randomUUID(),
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
// short relevant set instead of the whole stop.
export function getMatchingPhotosForPlace(stopId, placeName) {
  const rows = db
    .prepare("SELECT hash, title, place_label FROM stop_photos WHERE stop_id = ? AND hash IS NOT NULL")
    .all(stopId);
  return photosMatchingPlace(
    rows.map((r) => ({ hash: r.hash, title: r.title, placeLabel: r.place_label })),
    placeName
  ).map((p) => ({ hash: p.hash, thumbUrl: thumbUrl(p.hash, "fit_720") }));
}

export function deleteStory(id) {
  return db.prepare("DELETE FROM stories WHERE id = ?").run(id).changes > 0;
}
