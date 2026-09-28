import { getBookProduct, vendorOf, coverSize, resolvePageCount, knownPageCounts, childArticleIdFor } from "./products.js";
import { getBookLayoutPack } from "./bookLayoutPacks.js";
import {
  SPREAD_LAYOUTS,
  chapterSpread,
  infoCardSpread,
  routeMapSpread,
  coverSpread,
  resolveFonts,
  backdropScore,
  captionOverlaysFor,
} from "./spreadLayouts.js";
import { photoAspect, coverRetention } from "../pdfLayoutEngine.js";
import { dateRange } from "../render.js";
import { getTheme } from "../themes.js";
import { embedKind, komootImageUrl, stravaActivityInfo } from "../embeds.js";

// Turns a story into a printed photobook: a wrap-around cover plus a list of
// lay-flat spreads, each a list of positioned elements (see
// spreadLayouts.js). Pure and deterministic, so the editor's live preview
// and the Saal export plan exactly the same book.
//
// Per stop:
//   - with narrative: a chapter spread (photo across the spread, story on a
//     translucent panel) using the featured photo
//   - without: the stop title goes onto its first photo spread
//   - photos: chunked into spreads; layout *and* photo count per spread are
//     chosen by how well the photos' shapes suit each layout, with variety
//     penalties so the book doesn't repeat itself
//   - info cards: one spread each (place photo + facts), at their placement

// Most photos a single spread can take (the densest layout's capacity).
export const MAX_PHOTOS_PER_SPREAD = Math.max(...Object.values(SPREAD_LAYOUTS).map((l) => l.photos.max));

// Best layout for exactly `group` (a fixed photo count): the pack's
// preferred layouts first, any layout that can hold that many as fallback.
function bestLayoutFor(group, weights, spread, recent) {
  const k = group.length;
  const pick = (entries, allowZero) => {
    let best = null;
    for (const [id, weight] of entries) {
      const l = SPREAD_LAYOUTS[id];
      if (!l || k < l.photos.min || k > l.photos.max) continue;
      const fit = l.fit(group, spread);
      if (fit <= 0 && !allowZero) continue;
      let score = fit * weight;
      if (recent.at(-1) === id) score -= 0.45;
      else if (recent.includes(id)) score -= 0.12;
      if (!best || score > best.score) best = { id, score };
    }
    return best;
  };
  const all = Object.keys(SPREAD_LAYOUTS).map((id) => [id, weights[id] ?? 0.8]);
  return (pick(Object.entries(weights), false) || pick(all, false) || pick(all, true))?.id || "page-mosaics";
}

// Splits a stop's photos into spreads. `pinned` (the user's per-spread
// choices for this stop, in order - a plain number for a legacy count-only
// pin, or { count?, layoutId? }) fixes what the first spreads hold; the
// rest is automatic: layout *and* count per spread are chosen by how well
// the photos' shapes suit each layout, with variety penalties so the book
// doesn't repeat itself. A pinned layout with no pinned count still picks
// its own best photo count automatically, same scoring as the fully
// automatic branch just restricted to that one layout.
function chunkIntoSpreads(photos, weights, spread, nextVariant, pinned = []) {
  const entries = Object.entries(weights).filter(([id]) => SPREAD_LAYOUTS[id]);
  const spreads = [];
  const recent = [];
  let i = 0;
  while (i < photos.length) {
    const remaining = photos.length - i;
    const pin = pinned[spreads.length];
    const pinnedCount = typeof pin === "number" ? pin : pin?.count;
    const pinnedLayoutId = typeof pin === "object" && pin && SPREAD_LAYOUTS[pin.layoutId] ? pin.layoutId : null;
    let best = null;
    if (pinnedLayoutId) {
      const l = SPREAD_LAYOUTS[pinnedLayoutId];
      if (pinnedCount) {
        const k = Math.min(pinnedCount, remaining, l.photos.max, MAX_PHOTOS_PER_SPREAD);
        best = { id: pinnedLayoutId, k, pinned: true, layoutPinned: true };
      } else {
        let bestK = null;
        for (let k = l.photos.min; k <= Math.min(l.photos.max, remaining); k++) {
          const group = photos.slice(i, i + k);
          const fit = l.fit(group, spread);
          const score = fit - Math.abs(k - l.photos.ideal) * 0.05;
          if (!bestK || score > bestK.score) bestK = { k, score };
        }
        best = { id: pinnedLayoutId, k: bestK?.k ?? l.photos.min, pinned: true, layoutPinned: true };
      }
    } else if (pinnedCount) {
      const k = Math.min(pinnedCount, remaining, MAX_PHOTOS_PER_SPREAD);
      best = { id: bestLayoutFor(photos.slice(i, i + k), weights, spread, recent), k, pinned: true, layoutPinned: false };
    } else {
      for (const [id, weight] of entries) {
        const l = SPREAD_LAYOUTS[id];
        for (let k = l.photos.min; k <= Math.min(l.photos.max, remaining); k++) {
          const group = photos.slice(i, i + k);
          const fit = l.fit(group, spread);
          if (fit <= 0) continue;
          const left = remaining - k;
          let score = fit * weight - Math.abs(k - l.photos.ideal) * 0.05;
          if (recent.at(-1) === id) score -= 0.45;
          else if (recent.includes(id)) score -= 0.12;
          if (left > 0 && left < 2) score -= 0.15;
          if (!best || score > best.score) best = { id, k, score };
        }
      }
      if (!best) best = { id: "panorama", k: 1 };
    }
    spreads.push({
      layoutId: best.id,
      photos: photos.slice(i, i + best.k),
      variant: nextVariant(),
      pinned: !!best.pinned,
      layoutPinned: !!best.layoutPinned,
    });
    i += best.k;
    recent.push(best.id);
    if (recent.length > 3) recent.shift();
  }
  return spreads;
}

// Burst shots: photos taken within a few seconds of each other are almost
// always the same moment shot several times, not distinct pictures. Keep
// one per burst (the featured one, else the best-rated by PhotoPrism, else
// the first) unless the story says to keep them all.
const BURST_MS = 3000;

function skipBursts(photos) {
  const kept = [];
  const skipped = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const best =
      group.find((p) => p.featured) ||
      group.reduce((a, p) => ((p.insights?.quality ?? 0) > (a.insights?.quality ?? 0) ? p : a), group[0]);
    kept.push(best);
    skipped.push(...group.filter((p) => p !== best));
    group = [];
  };
  for (const p of photos) {
    const prev = group.at(-1);
    const t = p.insights?.takenAt;
    const tp = prev?.insights?.takenAt;
    if (prev && t != null && tp != null && Math.abs(t - tp) <= BURST_MS) group.push(p);
    else {
      flush();
      group = [p];
    }
  }
  flush();
  return { kept, skipped };
}

function heroForCard(card, stop) {
  if (!card.heroPhotoHash) return null;
  return stop.photos.find((p) => p.hash === card.heroPhotoHash || (p.thumbUrl || "").includes(card.heroPhotoHash)) || null;
}

// The server's own origin - needed only for the *export*'s server-side
// fetch (exportShared.js's fetchExternalBuffer, plain node fetch, no
// notion of "current page" to resolve a relative URL against). The live
// preview's own fetch is a normal <img src>, which resolves a relative URL
// against whatever page it's showing in just fine (see thumbUrl below).
const SELF_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

// A route embed's map, as a "photo" for the image element it's placed in -
// not a PhotoPrism photo at all (see exportShared.js's fetchExternalBuffer
// / photoKey, which key on this externalUrl when there's no hash).
// width/height are only ever a preview-time placement estimate (a real
// tour's elevation profile, or a Strava widget's actual layout, varies the
// image's exact proportions) - the actual export measures the real fetched
// pixels instead of trusting these.
function routeMapPhoto(embed) {
  const kind = embedKind(embed.url);
  if (kind === "strava-widget") {
    const info = stravaActivityInfo(embed.url);
    if (!info) return null;
    const q = `activityId=${encodeURIComponent(info.activityId)}&token=${encodeURIComponent(info.token)}&style=${encodeURIComponent(info.style)}`;
    return {
      id: `route-${embed.id}`,
      thumbUrl: `/api/embeds/strava-map?${q}`,
      fullUrl: `/api/embeds/strava-map?${q}`,
      externalUrl: `${SELF_ORIGIN}/api/embeds/strava-map?${q}`,
      width: 700,
      height: 900,
    };
  }
  const url = komootImageUrl(embed.url);
  // thumbUrl/fullUrl are what the live preview's inline SVG loads directly
  // in the browser (bookPreview.js's previewRef); externalUrl is what the
  // real Saal/CEWE export fetches server-side (exportShared.js) - both need
  // to point at the same image.
  return url ? { id: `route-${embed.id}`, externalUrl: url, thumbUrl: url, fullUrl: url, width: 1280, height: 1160 } : null;
}

function isStopEmpty(stop) {
  return (
    !stop.photos.some((p) => p.included) &&
    !stop.narrative &&
    !stop.pullQuote &&
    !(stop.infoCards || []).length &&
    !(stop.embeds || []).length
  );
}

function tripDates(story, locale) {
  const dated = story.stops.filter((s) => s.startedAt);
  if (!dated.length) return "";
  const last = dated[dated.length - 1];
  return dateRange(dated[0].startedAt, last.endedAt || last.startedAt, locale).replace("&ndash;", "–");
}

export function planBook(story, { product: productId, strings } = {}) {
  const product = getBookProduct(productId || story.bookProduct);
  const spreadSize = product.spread;
  const theme = getTheme(story.theme);
  const typeScale = Math.min(spreadSize.w / 2, spreadSize.h) / 2730;
  let variant = 0;
  const nextVariant = () => variant++;
  const fonts = resolveFonts(story, vendorOf(product));
  const layoutPack = getBookLayoutPack(story.bookLayoutPack);
  // User text size choice (Photobook panel), on top of the product scale.
  const textScale = { title: story.bookTitleScale || 1, body: story.bookBodyScale || 1 };
  const baseCtx = { typeScale, accentColor: theme.accent, fonts, textScale };
  // Text parts the user took out of the book (re-addable in the preview).
  const hiddenItems = [];

  const spreads = [];
  let burstSkips = 0;
  const build = (layoutId, photos, v, extra = {}) => {
    const ctx = { ...baseCtx, variant: v, ...extra };
    const { elements, paper } = SPREAD_LAYOUTS[layoutId].build(photos, spreadSize, ctx);
    const captions = elements.flatMap((el) => captionOverlaysFor(el, ctx));
    return { layoutId, elements: [...elements, ...captions], paper: paper || "#ffffff" };
  };

  const allIncluded = story.stops.flatMap((s) => s.photos.filter((p) => p.included));
  const featured = story.stops.map((s) => s.photos.find((p) => p.included && p.featured)).filter(Boolean);
  const coverPool = featured.length ? featured : allIncluded;

  // Intro spread: story title + intro text over a photo from the trip.
  // coverPool[1] (not [0]) for the automatic pick since [0] is the photo
  // most likely to double as the cover's own background - a manual pick
  // (introBackdropHash) always wins over either.
  if (story.intro && story.bookHideIntro) hiddenItems.push({ label: "Intro", toggle: { target: "intro" } });
  if (story.intro && !story.bookHideIntro) {
    const manualIntroBackdrop = story.introBackdropHash
      ? allIncluded.find((p) => p.hash === story.introBackdropHash)
      : null;
    const backdrop = manualIntroBackdrop || coverPool[1] || coverPool[0] || null;
    spreads.push({
      kind: "intro",
      label: "Intro",
      toggle: { target: "intro" },
      ...chapterSpread(spreadSize, baseCtx, { backdrop, title: story.title, narrative: story.intro }),
      layoutId: "chapter",
    });
  }

  story.stops.forEach((stop) => {
    if (isStopEmpty(stop)) return;
    const allIncludedHere = stop.photos.filter((p) => p.included);
    const { kept: included, skipped } = story.bookKeepBursts
      ? { kept: allIncludedHere, skipped: [] }
      : skipBursts(allIncludedHere);
    burstSkips += skipped.length;
    const feat = included.find((p) => p.featured);
    const stopHasText = Boolean(stop.narrative || stop.pullQuote);
    const hasText = stopHasText && !stop.bookHideText;
    if (stopHasText && stop.bookHideText)
      hiddenItems.push({ label: `Story text · ${stop.heading}`, stopId: stop.id, toggle: { target: "chapter", stopId: stop.id } });
    const tag = { stopId: stop.id, stopHeading: stop.heading };
    const stopSpreads = [];

    // The chapter's backdrop: the user's own pick (bookChapterBackdropHash -
    // same idea as an info card's own hero photo, see InfoCards.jsx) if they
    // set one, else the best-scoring scenery for a full spread (a face-free
    // featured photo wins through backdropScore's featured bonus). A manual
    // pick earns the stop a full chapter-opener spread even with no
    // narrative/pull quote - picking a specific backdrop is itself a strong
    // signal the user wants the "photo behind a heading" treatment, not just
    // the plain title-over-first-photo-grid fallback below.
    const manualBackdrop = stop.bookChapterBackdropHash
      ? included.find((p) => p.hash === stop.bookChapterBackdropHash)
      : null;
    const showChapterSpread = hasText || Boolean(manualBackdrop);

    let pool = included;
    if (showChapterSpread) {
      const spreadAspect = spreadSize.w / spreadSize.h;
      const backdrop =
        manualBackdrop ||
        [...included].sort((a, b) => backdropScore(b, spreadAspect) - backdropScore(a, spreadAspect))[0] ||
        null;
      pool = included.filter((p) => p !== backdrop);
      stopSpreads.push({
        kind: "chapter",
        ...tag,
        toggle: { target: "chapter", stopId: stop.id },
        ...chapterSpread(spreadSize, baseCtx, {
          backdrop,
          title: stop.heading,
          narrative: stop.narrative,
          pullQuote: stop.pullQuote,
        }),
        layoutId: "chapter",
      });
    } else if (feat) {
      pool = [feat, ...included.filter((p) => p !== feat)];
    }

    // Route map spreads - one per embed with a derivable map image. Each
    // also gets a handful of the stop's own photos: 1-2 small ones sharing
    // the map's own page (so the map doesn't have to fill, and dominate,
    // the whole page) plus a few more on the opposite page (see
    // routeMapSpread), so a route spread never reads as a mostly-empty
    // page(s) facing a map. Every embed draws from the same shrinking
    // `pool` in turn (not just the first) so two routes on one stop each
    // still get their share, and none of these photos also repeat later in
    // the normal photo-grid chunking below.
    const routeSpreads = (stop.embeds || [])
      .map((embed) => ({ embed, hero: routeMapPhoto(embed) }))
      .filter((r) => r.hero)
      .map(({ embed, hero }) => {
        const picked = pool.slice(0, Math.min(5, pool.length));
        pool = pool.filter((p) => !picked.includes(p));
        const mapPagePhotos = picked.slice(0, Math.min(2, picked.length));
        const galleryPhotos = picked.slice(mapPagePhotos.length);
        return {
          kind: "route",
          ...tag,
          ...routeMapSpread(spreadSize, baseCtx, {
            hero,
            title: embed.title || null,
            mapPagePhotos,
            galleryPhotos,
            variant: nextVariant(),
          }),
          layoutId: "route-map",
        };
      });

    const weights =
      stop.bookLayoutOverride && SPREAD_LAYOUTS[stop.bookLayoutOverride]
        ? { [stop.bookLayoutOverride]: 1, panorama: 0.01 }
        : layoutPack.templates;
    const photoSpreads = chunkIntoSpreads(pool, weights, spreadSize, nextVariant, stop.bookSpreadCounts || []).map(
      (s, idx) => ({
        kind: "photos",
        ...tag,
        photoIndex: idx,
        photoCount: s.photos.length,
        pinned: s.pinned,
        layoutPinned: s.layoutPinned,
        ...build(s.layoutId, s.photos, s.variant, { title: !showChapterSpread && idx === 0 ? stop.heading : null }),
      })
    );

    const allCards = stop.infoCards || [];
    allCards.forEach((card, cardIndex) => {
      if (card.bookHidden)
        hiddenItems.push({
          label: `Info card · ${card.placeName}`,
          stopId: stop.id,
          toggle: { target: "info", stopId: stop.id, cardIndex },
        });
    });
    const cards = allCards.filter((c) => !c.bookHidden);
    const infoSpread = (card) => ({
      kind: "info",
      ...tag,
      toggle: { target: "info", stopId: stop.id, cardIndex: allCards.indexOf(card) },
      ...infoCardSpread(spreadSize, baseCtx, { card, hero: heroForCard(card, stop) || feat || included[0] || null }),
      layoutId: "info-card",
    });
    // The route map (a similar overview-up-front element) comes right after
    // whichever spread carries the stop title; info cards are free-placed
    // among the stop's own photo spreads instead - see below.
    const lead = stopSpreads.length ? stopSpreads : photoSpreads.slice(0, 1);
    const photosAfterLead = stopSpreads.length ? photoSpreads : photoSpreads.slice(1);
    // A card's own spread lands after `photoPosition` (0-1) of the way
    // through the stop's photo spreads - free placement instead of the old
    // fixed top/middle/end three-way choice, so a card can be pushed to
    // roughly "the first third" of a long section, say. A card saved before
    // this shipped has no photoPosition at all; its old `placement` maps to
    // the exact same spot free placement replaced it at (top -> 0,
    // middle -> the old halfway split, end -> the very end), so nothing
    // already in a book silently jumps to a new position.
    const positioned = cards
      .map((card) => {
        const frac =
          typeof card.photoPosition === "number"
            ? card.photoPosition
            : card.placement === "end"
              ? 1
              : card.placement === "middle"
                ? 0.5
                : 0;
        const index = Math.max(0, Math.min(photosAfterLead.length, Math.round(frac * photosAfterLead.length)));
        return { card, index };
      })
      .sort((a, b) => a.index - b.index);
    const combined = [...photosAfterLead];
    positioned.forEach(({ card, index }, i) => combined.splice(index + i, 0, infoSpread(card)));
    spreads.push(...lead, ...routeSpreads, ...combined);
  });

  if (story.outro && story.bookHideOutro) hiddenItems.push({ label: "Outro", toggle: { target: "outro" } });
  if (story.outro && !story.bookHideOutro) {
    // The automatic pick is the *second*-to-last photo, not the very last
    // one - the last included photo of the last stop is always the last
    // photo shown in that stop's own photo grid too (nothing removes it
    // from that pool), so defaulting to it here would show the same photo
    // twice back to back, right before the outro. A manual pick
    // (outroBackdropHash) always wins over this heuristic.
    const manualOutroBackdrop = story.outroBackdropHash
      ? allIncluded.find((p) => p.hash === story.outroBackdropHash)
      : null;
    const backdrop = manualOutroBackdrop || allIncluded.at(-2) || allIncluded.at(-1) || null;
    spreads.push({
      kind: "outro",
      label: "Outro",
      toggle: { target: "outro" },
      ...chapterSpread(spreadSize, baseCtx, { backdrop, narrative: story.outro }),
      layoutId: "chapter",
    });
  }

  // Only page counts the vendor's catalog offers are accepted (see
  // products.js); pad with blank spreads (easy to delete there) up to the
  // next one. More content than the largest known count is an overflow
  // the export refuses rather than silently dropping pages.
  const contentPages = spreads.length * 2;
  const { pages: numPages, overflow } = resolvePageCount(product, contentPages);
  const blanks = Math.max(0, (numPages - (product.singlePages || 0)) / 2 - spreads.length);
  for (let b = 0; b < blanks; b++) spreads.push({ kind: "blank", layoutId: "blank", elements: [], paper: "#ffffff" });

  // Cover: best-fitting featured photo as backdrop, two more as prints -
  // unless the user picked specific photos instead (bookCoverBackdropHash /
  // bookCoverCards, same "Auto unless overridden" pattern as a stop's
  // chapter backdrop). Each of the 2 card slots overrides independently -
  // a null entry there still lets that one slot auto-pick.
  const cSize = coverSize(product, numPages);
  const cAspect = cSize.w / cSize.h;
  const manualCoverBg = story.bookCoverBackdropHash
    ? allIncluded.find((p) => p.hash === story.bookCoverBackdropHash)
    : null;
  const coverCandidates = [...coverPool, ...allIncluded.filter((p) => !coverPool.includes(p))];
  const coverBg =
    manualCoverBg ||
    [...coverCandidates].sort((a, b) => backdropScore(b, cAspect) + (coverPool.includes(b) ? 0.15 : 0) - backdropScore(a, cAspect) - (coverPool.includes(a) ? 0.15 : 0))[0] ||
    null;
  const manualCoverCards = (story.bookCoverCards || []).map((h) => (h ? allIncluded.find((p) => p.hash === h) : null));
  const autoCoverCardPool = [...coverPool, ...allIncluded].filter(
    (p, i, arr) => p !== coverBg && !manualCoverCards.includes(p) && arr.indexOf(p) === i
  );
  let autoCoverCardIdx = 0;
  const coverCards = [0, 1]
    .map((i) => manualCoverCards[i] || autoCoverCardPool[autoCoverCardIdx++] || null)
    .filter(Boolean);
  const cover = {
    kind: "cover",
    size: cSize,
    ...coverSpread(cSize, baseCtx, {
      backdrop: coverBg,
      cards: coverCards,
      title: story.title,
      subtitle: tripDates(story, strings?.dateLocale),
    }),
  };

  return {
    product,
    layoutPack,
    spreadSize,
    cover,
    spreads,
    numPages,
    fonts,
    contentPages,
    overflow,
    knownPageCounts: knownPageCounts(product),
    childArticleID: childArticleIdFor(product, numPages),
    blankSpreads: blanks,
    hiddenItems,
    burstSkips,
  };
}
