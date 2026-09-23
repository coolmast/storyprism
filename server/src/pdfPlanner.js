import { PDF_TEMPLATES } from "./pdfTemplates.js";
import { getLayoutPack } from "./pdfLayoutPacks.js";
import { getPaperSize } from "./pdfPaperSizes.js";
import { photoAspect, coverRetention } from "./pdfLayoutEngine.js";
import { dateRange } from "./render.js";

// Narratives longer than this don't fit on a translucent band over a photo;
// they get the photo page (title only) plus their own text page instead.
const OVERLAY_TEXT_LIMIT = 700;

// Splits a stop's photos into pages, in order, choosing template and photo
// count per page by score: how well these specific photo shapes suit the
// template on this page shape (`fit`, the orientation awareness), weighted
// by how much the pack likes that template, nudged toward the template's
// ideal photo count, away from repeating the previous page's template and
// away from leaving a straggler no template in the pack can take.
function chunkPhotos(photos, weights, ctx, nextVariant) {
  const entries = Object.entries(weights).filter(([id]) => PDF_TEMPLATES[id]);
  const minTake = Math.max(1, Math.min(...entries.map(([id]) => PDF_TEMPLATES[id].photoSlots.min)));
  const pages = [];
  let i = 0;
  const recent = [];

  while (i < photos.length) {
    const remaining = photos.length - i;
    let best = null;
    for (const [id, weight] of entries) {
      const t = PDF_TEMPLATES[id];
      const { min, max, ideal } = t.photoSlots;
      for (let k = Math.max(1, min); k <= Math.min(max, remaining); k++) {
        const group = photos.slice(i, i + k);
        const fit = t.fit(group, ctx);
        if (fit <= 0) continue;
        const left = remaining - k;
        let score = fit * weight - Math.abs(k - ideal) * 0.06;
        // Variety: never the same look twice in a row if avoidable, and
        // mildly discouraged within the last three pages.
        if (recent.at(-1) === id) score -= 0.45;
        else if (recent.includes(id)) score -= 0.12;
        if (left > 0 && left < minTake) score -= 0.3;
        if (!best || score > best.score) best = { id, k, score };
      }
    }
    if (!best) best = { id: "single-full-bleed", k: 1 };

    pages.push({ templateId: best.id, photos: photos.slice(i, i + best.k), variant: nextVariant() });
    i += best.k;
    recent.push(best.id);
    if (recent.length > 3) recent.shift();
  }
  return pages;
}

function textLength(stop) {
  return (stop.narrative || "").length + (stop.pullQuote || "").length;
}

function planStopPages(stop, pack, ctx, nextVariant) {
  const included = stop.photos.filter((p) => p.included);
  const featured = included.find((p) => p.featured);
  const hasText = Boolean(stop.narrative || stop.pullQuote);
  const base = { stopId: stop.id, stopHeading: stop.heading };

  // Opening: a stop with text opens with the pack's opening page (featured
  // photo + narrative). A stop without text doesn't need a separate
  // opening - its featured photo leads the first photo page instead, and
  // that page carries the stop's title.
  const openingPages = [];
  let photoPool = included;
  if (hasText && featured) {
    photoPool = included.filter((p) => p.id !== featured.id);
    const tooLong = pack.opening === "hero-overlay" && textLength(stop) > OVERLAY_TEXT_LIMIT;
    openingPages.push({
      ...base,
      templateId: pack.opening,
      photos: [featured],
      narrative: tooLong ? null : stop.narrative,
      pullQuote: tooLong ? null : stop.pullQuote,
    });
    if (tooLong) {
      openingPages.push({
        ...base,
        templateId: "text-chapter",
        photos: [],
        stopHeading: null,
        narrative: stop.narrative,
        pullQuote: stop.pullQuote,
        backdrop: pack.chapterBackdrop ? featured : null,
      });
    }
  } else if (hasText) {
    openingPages.push({
      ...base,
      templateId: "text-chapter",
      photos: [],
      narrative: stop.narrative,
      pullQuote: stop.pullQuote,
      backdrop: pack.chapterBackdrop ? included[0] : null,
    });
  } else if (featured) {
    photoPool = [featured, ...included.filter((p) => p.id !== featured.id)];
  }

  const weights =
    stop.pdfTemplateOverride && PDF_TEMPLATES[stop.pdfTemplateOverride]
      ? { [stop.pdfTemplateOverride]: 1 }
      : pack.templates;
  const photoPages = chunkPhotos(photoPool, weights, ctx, nextVariant).map((p) => ({ ...base, ...p }));
  if (!openingPages.length && photoPages.length) photoPages[0].showTitle = true;

  // Info cards become their own page, positioned by the same top/middle/end
  // placement the web view uses, reinterpreted for a paginated medium.
  const cards = stop.infoCards || [];
  const infoPage = (card) => ({ ...base, templateId: "info-card-page", photos: [], infoCard: card });
  const topCards = cards.filter((c) => (c.placement || "top") === "top");
  const middleCards = cards.filter((c) => c.placement === "middle");
  const endCards = cards.filter((c) => c.placement === "end");
  const mid = Math.ceil(photoPages.length / 2);

  // Without an opening page the first photo page carries the stop title, so
  // it has to come before any "top" info cards.
  if (!openingPages.length && photoPages.length) {
    const [titlePage, ...rest] = photoPages;
    const restMid = Math.max(0, mid - 1);
    return [
      titlePage,
      ...topCards.map(infoPage),
      ...rest.slice(0, restMid),
      ...middleCards.map(infoPage),
      ...rest.slice(restMid),
      ...endCards.map(infoPage),
    ];
  }

  return [
    ...openingPages,
    ...topCards.map(infoPage),
    ...photoPages.slice(0, mid),
    ...middleCards.map(infoPage),
    ...photoPages.slice(mid),
    ...endCards.map(infoPage),
  ];
}

// A stop with nothing in it at all (same rule render.js's web view uses to
// hide it) contributes zero pages rather than a blank one.
function isStopEmpty(stop) {
  const included = stop.photos.filter((p) => p.included);
  return (
    included.length === 0 &&
    !stop.narrative &&
    !stop.pullQuote &&
    !(stop.embeds || []).length &&
    !(stop.infoCards || []).length
  );
}

function tripDates(story, strings) {
  const dated = story.stops.filter((s) => s.startedAt);
  if (!dated.length) return "";
  return dateRange(dated[0].startedAt, dated[dated.length - 1].endedAt || dated[dated.length - 1].startedAt, strings?.dateLocale);
}

function coverPages(story, pack, ctx, strings) {
  const included = story.stops.flatMap((s) => s.photos.filter((p) => p.included));
  const featured = story.stops.map((s) => s.photos.find((p) => p.included && p.featured)).filter(Boolean);
  const candidates = featured.length ? featured : included;
  if (!candidates.length && !story.intro) return [];

  const subtitle = tripDates(story, strings);

  if (pack.cover === "cover-collage" && candidates.length) {
    // Backdrop: the featured photo that survives a full-page crop best.
    const bg = [...candidates].sort(
      (a, b) => coverRetention(photoAspect(b), ctx.pageAspect) - coverRetention(photoAspect(a), ctx.pageAspect)
    )[0];
    const others = [...candidates, ...included].filter((p, i, arr) => p.id !== bg.id && arr.findIndex((q) => q.id === p.id) === i);
    const pages = [{ templateId: "cover-collage", photos: [bg, ...others.slice(0, 2)], stopHeading: story.title, subtitle }];
    if (story.intro) {
      pages.push({
        templateId: "text-chapter",
        photos: [],
        narrative: story.intro,
        backdrop: pack.chapterBackdrop ? others[2] || bg : null,
      });
    }
    return pages;
  }

  return [
    {
      templateId: "hero-pullquote",
      photos: candidates.length ? [candidates[0]] : [],
      stopHeading: story.title,
      subtitle,
      narrative: story.intro,
    },
  ];
}

export function planPdfPages(story, { pack: packOverride, paperSize: paperSizeOverride, strings } = {}) {
  const pack = getLayoutPack(packOverride || story.pdfLayoutPack);
  const paperSize = getPaperSize(paperSizeOverride || story.pdfPaperSize);
  const ctx = { pageAspect: paperSize.widthMm / paperSize.heightMm };
  let variant = 0;
  const nextVariant = () => variant++;

  const pages = [...coverPages(story, pack, ctx, strings)];

  story.stops.forEach((stop) => {
    if (isStopEmpty(stop)) return;
    pages.push(...planStopPages(stop, pack, ctx, nextVariant));
  });

  if (story.outro) {
    const lastPhoto = story.stops.flatMap((s) => s.photos.filter((p) => p.included)).at(-1);
    pages.push({
      templateId: "text-chapter",
      photos: [],
      narrative: story.outro,
      backdrop: pack.chapterBackdrop ? lastPhoto : null,
    });
  }

  return { pages, paperSize, pack, ctx };
}
