import { getBookProduct, vendorOf, coverSize, resolvePageCount, knownPageCounts, childArticleIdFor } from "./products.js";
import {
  SPREAD_LAYOUTS,
  DEFAULT_SPREAD_WEIGHTS,
  chapterSpread,
  infoCardSpread,
  coverSpread,
  resolveFonts,
  backdropScore,
} from "./spreadLayouts.js";
import { photoAspect, coverRetention } from "../pdfLayoutEngine.js";
import { dateRange } from "../render.js";
import { getTheme } from "../themes.js";

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

// Splits a stop's photos into spreads. `pinned` (the user's per-spread photo
// counts for this stop, in order) fixes how many photos the first spreads
// hold; everything after them is paced automatically: layout *and* count per
// spread are chosen by how well the photos' shapes suit each layout, with
// variety penalties so the book doesn't repeat itself.
function chunkIntoSpreads(photos, weights, spread, nextVariant, pinned = []) {
  const entries = Object.entries(weights).filter(([id]) => SPREAD_LAYOUTS[id]);
  const spreads = [];
  const recent = [];
  let i = 0;
  while (i < photos.length) {
    const remaining = photos.length - i;
    const pinnedCount = pinned[spreads.length];
    let best = null;
    if (pinnedCount) {
      const k = Math.min(pinnedCount, remaining, MAX_PHOTOS_PER_SPREAD);
      best = { id: bestLayoutFor(photos.slice(i, i + k), weights, spread, recent), k, pinned: true };
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
    spreads.push({ layoutId: best.id, photos: photos.slice(i, i + best.k), variant: nextVariant(), pinned: !!best.pinned });
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

function isStopEmpty(stop) {
  return (
    !stop.photos.some((p) => p.included) &&
    !stop.narrative &&
    !stop.pullQuote &&
    !(stop.infoCards || []).length
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
  // User text size choice (Photobook panel), on top of the product scale.
  const textScale = { title: story.bookTitleScale || 1, body: story.bookBodyScale || 1 };
  const baseCtx = { typeScale, accentColor: theme.accent, fonts, textScale };
  // Text parts the user took out of the book (re-addable in the preview).
  const hiddenItems = [];

  const spreads = [];
  let burstSkips = 0;
  const build = (layoutId, photos, v, extra = {}) => {
    const { elements, paper } = SPREAD_LAYOUTS[layoutId].build(photos, spreadSize, { ...baseCtx, variant: v, ...extra });
    return { layoutId, elements, paper: paper || "#ffffff" };
  };

  const allIncluded = story.stops.flatMap((s) => s.photos.filter((p) => p.included));
  const featured = story.stops.map((s) => s.photos.find((p) => p.included && p.featured)).filter(Boolean);
  const coverPool = featured.length ? featured : allIncluded;

  // Intro spread: story title + intro text over a photo from the trip.
  if (story.intro && story.bookHideIntro) hiddenItems.push({ label: "Intro", toggle: { target: "intro" } });
  if (story.intro && !story.bookHideIntro) {
    const backdrop = coverPool[1] || coverPool[0] || null;
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

    let pool = included;
    if (hasText) {
      // The chapter's backdrop: best scenery for a full spread (a face-free
      // featured photo wins through backdropScore's featured bonus).
      const spreadAspect = spreadSize.w / spreadSize.h;
      const backdrop =
        [...included].sort((a, b) => backdropScore(b, spreadAspect) - backdropScore(a, spreadAspect))[0] || null;
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

    const weights =
      stop.bookLayoutOverride && SPREAD_LAYOUTS[stop.bookLayoutOverride]
        ? { [stop.bookLayoutOverride]: 1, panorama: 0.01 }
        : DEFAULT_SPREAD_WEIGHTS;
    const photoSpreads = chunkIntoSpreads(pool, weights, spreadSize, nextVariant, stop.bookSpreadCounts || []).map(
      (s, idx) => ({
        kind: "photos",
        ...tag,
        photoIndex: idx,
        photoCount: s.photos.length,
        pinned: s.pinned,
        ...build(s.layoutId, s.photos, s.variant, { title: !hasText && idx === 0 ? stop.heading : null }),
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
    const top = cards.filter((c) => (c.placement || "top") === "top").map(infoSpread);
    const middle = cards.filter((c) => c.placement === "middle").map(infoSpread);
    const end = cards.filter((c) => c.placement === "end").map(infoSpread);
    // Top cards come after whichever spread carries the stop title.
    const lead = stopSpreads.length ? stopSpreads : photoSpreads.slice(0, 1);
    const photosAfterLead = stopSpreads.length ? photoSpreads : photoSpreads.slice(1);
    const mid = Math.ceil(photosAfterLead.length / 2);
    spreads.push(
      ...lead,
      ...top,
      ...photosAfterLead.slice(0, mid),
      ...middle,
      ...photosAfterLead.slice(mid),
      ...end
    );
  });

  if (story.outro && story.bookHideOutro) hiddenItems.push({ label: "Outro", toggle: { target: "outro" } });
  if (story.outro && !story.bookHideOutro) {
    spreads.push({
      kind: "outro",
      label: "Outro",
      toggle: { target: "outro" },
      ...chapterSpread(spreadSize, baseCtx, { backdrop: allIncluded.at(-1) || null, narrative: story.outro }),
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

  // Cover: best-fitting featured photo as backdrop, two more as prints.
  const cSize = coverSize(product, numPages);
  const cAspect = cSize.w / cSize.h;
  const coverCandidates = [...coverPool, ...allIncluded.filter((p) => !coverPool.includes(p))];
  const coverBg =
    [...coverCandidates].sort((a, b) => backdropScore(b, cAspect) + (coverPool.includes(b) ? 0.15 : 0) - backdropScore(a, cAspect) - (coverPool.includes(a) ? 0.15 : 0))[0] ||
    null;
  const coverCards = [...coverPool, ...allIncluded].filter((p, i, arr) => p !== coverBg && arr.indexOf(p) === i).slice(0, 2);
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
