import { getBookProduct, coverSize } from "./products.js";
import {
  SPREAD_LAYOUTS,
  DEFAULT_SPREAD_WEIGHTS,
  chapterSpread,
  infoCardSpread,
  coverSpread,
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

function chunkIntoSpreads(photos, weights, spread, nextVariant) {
  const entries = Object.entries(weights).filter(([id]) => SPREAD_LAYOUTS[id]);
  const spreads = [];
  const recent = [];
  let i = 0;
  while (i < photos.length) {
    const remaining = photos.length - i;
    let best = null;
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
    spreads.push({ layoutId: best.id, photos: photos.slice(i, i + best.k), variant: nextVariant() });
    i += best.k;
    recent.push(best.id);
    if (recent.length > 3) recent.shift();
  }
  return spreads;
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
  const baseCtx = { typeScale, accentColor: theme.accent };

  const spreads = [];
  const build = (layoutId, photos, v, extra = {}) => {
    const { elements, paper } = SPREAD_LAYOUTS[layoutId].build(photos, spreadSize, { ...baseCtx, variant: v, ...extra });
    return { layoutId, elements, paper: paper || "#ffffff" };
  };

  const allIncluded = story.stops.flatMap((s) => s.photos.filter((p) => p.included));
  const featured = story.stops.map((s) => s.photos.find((p) => p.included && p.featured)).filter(Boolean);
  const coverPool = featured.length ? featured : allIncluded;

  // Intro spread: story title + intro text over a photo from the trip.
  if (story.intro) {
    const backdrop = coverPool[1] || coverPool[0] || null;
    spreads.push({
      kind: "intro",
      label: "Intro",
      ...chapterSpread(spreadSize, baseCtx, { backdrop, title: story.title, narrative: story.intro }),
      layoutId: "chapter",
    });
  }

  story.stops.forEach((stop) => {
    if (isStopEmpty(stop)) return;
    const included = stop.photos.filter((p) => p.included);
    const feat = included.find((p) => p.featured);
    const hasText = Boolean(stop.narrative || stop.pullQuote);
    const tag = { stopId: stop.id, stopHeading: stop.heading };
    const stopSpreads = [];

    let pool = included;
    if (hasText) {
      const spreadAspect = spreadSize.w / spreadSize.h;
      const backdrop =
        feat ||
        [...included].sort(
          (a, b) => coverRetention(photoAspect(b), spreadAspect) - coverRetention(photoAspect(a), spreadAspect)
        )[0] ||
        null;
      pool = included.filter((p) => p !== backdrop);
      stopSpreads.push({
        kind: "chapter",
        ...tag,
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
    const photoSpreads = chunkIntoSpreads(pool, weights, spreadSize, nextVariant).map((s, idx) => ({
      kind: "photos",
      ...tag,
      ...build(s.layoutId, s.photos, s.variant, { title: !hasText && idx === 0 ? stop.heading : null }),
    }));

    const cards = stop.infoCards || [];
    const infoSpread = (card) => ({
      kind: "info",
      ...tag,
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

  if (story.outro) {
    spreads.push({
      kind: "outro",
      label: "Outro",
      ...chapterSpread(spreadSize, baseCtx, { backdrop: allIncluded.at(-1) || null, narrative: story.outro }),
      layoutId: "chapter",
    });
  }

  // Saal books need an even page count within the product's range; pad
  // with blank spreads (easy to delete in Saal) up to the minimum.
  const minSpreads = Math.ceil(product.minPages / 2);
  const blanks = Math.max(0, minSpreads - spreads.length);
  for (let b = 0; b < blanks; b++) spreads.push({ kind: "blank", layoutId: "blank", elements: [], paper: "#ffffff" });
  const numPages = spreads.length * 2;

  // Cover: best-fitting featured photo as backdrop, two more as prints.
  const cSize = coverSize(product, numPages);
  const cAspect = cSize.w / cSize.h;
  const coverBg =
    [...coverPool].sort((a, b) => coverRetention(photoAspect(b), cAspect) - coverRetention(photoAspect(a), cAspect))[0] ||
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
    tooManyPages: numPages > product.maxPages,
    blankSpreads: blanks,
  };
}
