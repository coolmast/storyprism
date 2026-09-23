import { PDF_TEMPLATES } from "./pdfTemplates.js";
import { getLayoutPack } from "./pdfLayoutPacks.js";
import { getPaperSize } from "./pdfPaperSizes.js";

// Greedily assigns `photos` across `templateIds` (a layout pack's rotation,
// or a single-element array for a per-stop manual override): picks whichever
// candidate template's max capacity uses the most of what's left (so a
// photo-heavy stop doesn't end with an awkward string of near-empty pages),
// avoids repeating the same template twice in a row when an alternative
// fits, and falls back to single-full-bleed for a straggler count too small
// for anything else in the pack (its min/max of 1 always fits).
function chunkPhotosWithPack(photos, templateIds) {
  const pages = [];
  let remaining = [...photos];
  let lastId = null;

  while (remaining.length > 0) {
    const fits = templateIds.filter((id) => {
      const t = PDF_TEMPLATES[id];
      return t && t.photoSlots.min > 0 && t.photoSlots.min <= remaining.length;
    });
    const nonRepeat = fits.filter((id) => id !== lastId);
    let pool = nonRepeat.length ? nonRepeat : fits;
    if (!pool.length) pool = ["single-full-bleed"];

    const chosenId = pool.reduce((bestId, id) => {
      const take = Math.min(PDF_TEMPLATES[id].photoSlots.max, remaining.length);
      const bestTake = Math.min(PDF_TEMPLATES[bestId].photoSlots.max, remaining.length);
      return take > bestTake ? id : bestId;
    }, pool[0]);

    const take = Math.min(PDF_TEMPLATES[chosenId].photoSlots.max, remaining.length);
    pages.push({ templateId: chosenId, photos: remaining.slice(0, take) });
    remaining = remaining.slice(take);
    lastId = chosenId;
  }

  return pages;
}

// A featured photo (or narrative/pull quote) always gets its own opening
// page, same as the web view's "featured photo gets full-width treatment"
// convention - independent of any per-stop layout override, so a manual pin
// to e.g. "4-Photo Grid" affects the rest of the stop's photos, not whether
// its narrative gets shown at all. Never silently drop text content.
function planStopPages(stop, pack) {
  const included = stop.photos.filter((p) => p.included);
  const featured = included.find((p) => p.featured);
  const remaining = featured ? included.filter((p) => p.id !== featured.id) : included;
  const hasText = Boolean(stop.narrative || stop.pullQuote);

  const openingPages = [];
  if (featured && hasText) {
    openingPages.push({
      templateId: "hero-pullquote",
      photos: [featured],
      stopHeading: stop.heading,
      narrative: stop.narrative,
      pullQuote: stop.pullQuote,
    });
  } else if (featured) {
    openingPages.push({ templateId: "single-full-bleed", photos: [featured], stopHeading: stop.heading });
  } else if (hasText) {
    openingPages.push({
      templateId: "text-chapter",
      photos: [],
      stopHeading: stop.heading,
      narrative: stop.narrative,
      pullQuote: stop.pullQuote,
    });
  }

  const templateIds =
    stop.pdfTemplateOverride && PDF_TEMPLATES[stop.pdfTemplateOverride]
      ? [stop.pdfTemplateOverride]
      : pack.templates;
  const photoPages = chunkPhotosWithPack(remaining, templateIds).map((p) => ({
    ...p,
    stopHeading: stop.heading,
  }));

  // Info cards become their own dedicated page, positioned by the same
  // top/middle/end placement already established for the (continuous-
  // scroll) web view, reinterpreted for a paginated medium: top -> right
  // after the opening page, middle -> partway through the photo pages,
  // end -> after all of them.
  const cards = stop.infoCards || [];
  const topCards = cards.filter((c) => (c.placement || "top") === "top");
  const middleCards = cards.filter((c) => c.placement === "middle");
  const endCards = cards.filter((c) => c.placement === "end");
  const infoPage = (card) => ({ templateId: "info-card-page", photos: [], infoCard: card });
  const mid = Math.ceil(photoPages.length / 2);

  return [
    ...openingPages,
    ...topCards.map(infoPage),
    ...photoPages.slice(0, mid),
    ...middleCards.map(infoPage),
    ...photoPages.slice(mid),
    ...endCards.map(infoPage),
  ];
}

// A stop with nothing in it at all (matches the same rule render.js's web
// view uses to hide it) contributes zero pages rather than a blank one.
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

export function planPdfPages(story, { pack: packOverride, paperSize: paperSizeOverride } = {}) {
  const pack = getLayoutPack(packOverride || story.pdfLayoutPack);
  const paperSize = getPaperSize(paperSizeOverride || story.pdfPaperSize);

  const includedByStop = story.stops.map((s) => s.photos.filter((p) => p.included));
  const featuredByStop = includedByStop.map((photos) => photos.find((p) => p.featured));
  const coverPhoto = (featuredByStop.find(Boolean) || includedByStop.flat()[0])?.fullUrl
    || (featuredByStop.find(Boolean) || includedByStop.flat()[0])?.thumbUrl;

  const pages = [];

  if (coverPhoto || story.intro) {
    pages.push({
      templateId: "hero-pullquote",
      photos: coverPhoto ? [{ fullUrl: coverPhoto, thumbUrl: coverPhoto }] : [],
      stopHeading: story.title,
      narrative: story.intro,
      pullQuote: null,
    });
  }

  story.stops.forEach((stop) => {
    if (isStopEmpty(stop)) return;
    pages.push(...planStopPages(stop, pack));
  });

  if (story.outro) {
    pages.push({ templateId: "text-chapter", photos: [], stopHeading: null, narrative: story.outro, pullQuote: null });
  }

  return { pages, paperSize };
}
