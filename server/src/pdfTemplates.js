import { escapeHtml, paragraphs } from "./render.js";
import {
  photoAspect,
  coverRetention,
  toCss,
  collage,
  pickBackdrop,
  cardLayout,
} from "./pdfLayoutEngine.js";

// One page = one `.pdf-page` with exact physical dimensions (set from the
// chosen paper size in pdfDocument.js). Photo positions are computed by
// pdfLayoutEngine.js from each photo's real aspect ratio and absolutely
// positioned in percentages, so a landscape photo is never squeezed into a
// portrait cell and every template works on every paper shape.
//
// Every template exports:
//   label       - shown in the "PDF layout" picker
//   photoSlots  - { min, max, ideal } included-photo capacity; the planner
//                 uses this to decide how many photos a page takes
//   hasText     - whether this template has a narrative/pull-quote zone
//   selectable  - offered as a manual per-stop override
//   fit(photos, ctx) -> 0..1 how well these photos suit this template on
//                 this page shape (the planner's orientation awareness)
//   render(page, strings, ctx) -> one <section class="pdf-page ...">
//
// `page`: { photos, stopHeading, showTitle, narrative, pullQuote, infoCard,
//           backdrop, subtitle, variant }
// `ctx`:  { pageAspect, preview }

// Previews load the 720px thumbnails so the in-editor live preview stays
// fast on a phone; the real export uses the 2048px versions.
function src(p, ctx) {
  return ctx.preview ? p.thumbUrl || p.fullUrl : p.fullUrl || p.thumbUrl;
}

function img(p, ctx, alt) {
  return `<img src="${escapeHtml(src(p, ctx))}" alt="${escapeHtml(p.caption || alt || "")}">`;
}

function captionOverlay(p) {
  return p.caption ? `<span class="pdf-box-caption">${escapeHtml(p.caption)}</span>` : "";
}

function photoBox(p, box, ctx, { cls = "", style = "", alt = "" } = {}) {
  return `<div class="pdf-box ${cls}" style="${toCss(box, ctx.pageAspect)}${style}">${img(p, ctx, alt)}${captionOverlay(p)}</div>`;
}

// Always the small thumbnail: it's blurred beyond recognition anyway, and
// embedding a second full-resolution copy of the photo would roughly double
// the PDF's size for no visible difference.
function blurredBackdrop(p) {
  return `<div class="pdf-blur-bg"><img src="${escapeHtml(p.thumbUrl || p.fullUrl)}" alt=""></div>`;
}

function fullBleed(p, ctx, alt) {
  return `<div class="pdf-fill">${img(p, ctx, alt)}</div>`;
}

function title(page, cls = "") {
  if (!page.showTitle || !page.stopHeading) return "";
  return `<h2 class="pdf-title ${cls}">${escapeHtml(page.stopHeading)}</h2>`;
}

function captionsList(photos) {
  const withCaptions = photos.filter((p) => p.caption);
  if (!withCaptions.length) return "";
  return `<p class="pdf-caption-strip">${withCaptions.map((p) => escapeHtml(p.caption)).join(" &middot; ")}</p>`;
}

function pageH(ctx) {
  return 100 / ctx.pageAspect;
}

// Space kept free at the top of a collage page for the stop's title.
function titleBand(page, ctx, share = 0.13) {
  return page.showTitle && page.stopHeading ? pageH(ctx) * share : 0;
}

function collageFit(photos, ctx, { inset = 0, topBand = 0, gap = 1 } = {}) {
  const h = pageH(ctx);
  const box = { x: inset, y: inset + topBand, w: 100 - 2 * inset, h: h - 2 * inset - topBand };
  return collage(photos, box, { gap }).coverage;
}

function textSizeClass(text) {
  const len = (text || "").length;
  if (len > 1400) return "pdf-text-xs";
  if (len > 900) return "pdf-text-s";
  if (len > 450) return "pdf-text-m";
  return "pdf-text-l";
}

// Jitter for the "scattered prints" look - deterministic per page/photo so
// the preview and the exported PDF are identical.
function jitter(seed, i, amount) {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return ((v - Math.floor(v)) * 2 - 1) * amount;
}

export const PDF_TEMPLATES = {
  // Full-bleed when the photo roughly matches the page shape; otherwise the
  // whole photo is shown on a blurred, enlarged copy of itself instead of
  // cutting half of it away.
  "single-full-bleed": {
    label: "Single Photo",
    photoSlots: { min: 1, max: 1, ideal: 1 },
    hasText: false,
    selectable: true,
    fit(photos, ctx) {
      return coverRetention(photoAspect(photos[0]), ctx.pageAspect) >= 0.82 ? 0.9 : 0.7;
    },
    render(page, strings, ctx) {
      const p = page.photos[0];
      const bleed = coverRetention(photoAspect(p), ctx.pageAspect) >= 0.82;
      if (bleed) {
        return `
      <section class="pdf-page pdf-tpl-single">
        ${fullBleed(p, ctx, page.stopHeading)}
        ${title(page, "pdf-title-light pdf-title-bl")}
        ${p.caption ? `<p class="pdf-caption-overlay">${escapeHtml(p.caption)}</p>` : ""}
      </section>`;
      }
      const h = pageH(ctx);
      const band = titleBand(page, ctx);
      const inset = 7;
      const { boxes } = collage([p], { x: inset, y: inset + band, w: 100 - 2 * inset, h: h - 2 * inset - band }, { fillTolerance: 2 });
      return `
      <section class="pdf-page pdf-tpl-single pdf-dark">
        ${blurredBackdrop(p)}
        ${title(page, "pdf-title-light pdf-title-top")}
        ${photoBox(p, boxes[0], ctx, { cls: "pdf-card", alt: page.stopHeading })}
      </section>`;
    },
  },

  // Classic opening page: photo on top (sized to the photo's own shape, up
  // to 60% of the page), narrative below.
  "hero-pullquote": {
    label: "Opening Page",
    photoSlots: { min: 0, max: 1, ideal: 1 },
    hasText: true,
    selectable: false,
    fit: () => 0,
    render(page, strings, ctx) {
      const p = page.photos[0];
      const photoShare = p ? Math.min(60, (100 / photoAspect(p) / pageH(ctx)) * 100) : 0;
      const text = `${page.narrative || ""}${page.pullQuote || ""}`;
      return `
      <section class="pdf-page pdf-tpl-hero-pullquote" style="grid-template-rows:${p ? `${photoShare}%` : "0"} 1fr">
        <div class="pdf-hero-photo">${p ? fullBleed(p, ctx, page.stopHeading) : ""}</div>
        <div class="pdf-hero-text ${textSizeClass(text)}">
          ${page.stopHeading ? `<h2>${escapeHtml(page.stopHeading)}</h2>` : ""}
          ${page.subtitle ? `<p class="pdf-subtitle">${page.subtitle}</p>` : ""}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
          ${page.pullQuote ? `<blockquote class="pdf-pull-quote">${escapeHtml(page.pullQuote)}</blockquote>` : ""}
        </div>
      </section>`;
    },
  },

  // Photobook opening page: the photo runs edge to edge, title and text sit
  // on a translucent band across it (like the cover band of a printed
  // photobook). Long narratives are moved to their own page by the planner.
  "hero-overlay": {
    label: "Opening Photo + Text Band",
    photoSlots: { min: 1, max: 1, ideal: 1 },
    hasText: true,
    selectable: false,
    fit: () => 0,
    render(page, strings, ctx) {
      const p = page.photos[0];
      const text = `${page.narrative || ""}${page.pullQuote || ""}`;
      return `
      <section class="pdf-page pdf-tpl-hero-overlay pdf-dark">
        ${coverRetention(photoAspect(p), ctx.pageAspect) >= 0.6 ? fullBleed(p, ctx, page.stopHeading) : blurredBackdrop(p)}
        <div class="pdf-band ${textSizeClass(text)}">
          ${page.stopHeading ? `<h2 class="pdf-title pdf-title-light">${escapeHtml(page.stopHeading)}</h2>` : ""}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
          ${page.pullQuote ? `<blockquote class="pdf-pull-quote">${escapeHtml(page.pullQuote)}</blockquote>` : ""}
        </div>
      </section>`;
    },
  },

  // Story cover for the photobook pack: full-bleed backdrop, a translucent
  // title band, and up to two slightly tilted prints on top.
  "cover-collage": {
    label: "Cover Collage",
    photoSlots: { min: 1, max: 3, ideal: 3 },
    hasText: true,
    selectable: false,
    fit: () => 0,
    render(page, strings, ctx) {
      const [bg, ...cards] = page.photos;
      const h = pageH(ctx);
      const tilts = [-4, 3];
      const cardHtml = cards.slice(0, 2).map((p, i) => {
        const a = photoAspect(p);
        let w = a >= 1 ? 30 : 21;
        let ch = w / a;
        if (ch > h * 0.36) { ch = h * 0.36; w = ch * a; }
        const box = { x: 6 + i * 33, y: h * 0.06 + i * h * 0.04, w, h: ch };
        return photoBox(p, box, ctx, { cls: "pdf-card", style: `transform:rotate(${tilts[i]}deg);` });
      }).join("\n");
      return `
      <section class="pdf-page pdf-tpl-cover-collage pdf-dark">
        ${bg ? fullBleed(bg, ctx, page.stopHeading) : ""}
        ${cardHtml}
        <div class="pdf-cover-band">
          <h1 class="pdf-title pdf-title-light">${escapeHtml(page.stopHeading || "")}</h1>
          ${page.subtitle ? `<p class="pdf-subtitle">${page.subtitle}</p>` : ""}
        </div>
      </section>`;
    },
  },

  // One photo as full-page scenery with 1-3 others floating on it as
  // shadowed prints, each at its own aspect ratio.
  "backdrop-cards": {
    label: "Background + Photo Cards",
    photoSlots: { min: 2, max: 4, ideal: 3 },
    hasText: false,
    selectable: true,
    fit(photos, ctx) {
      const bgIdx = pickBackdrop(photos, ctx.pageAspect);
      const retention = coverRetention(photoAspect(photos[bgIdx]), ctx.pageAspect);
      return retention < 0.55 ? 0 : Math.min(1, retention + 0.25);
    },
    render(page, strings, ctx) {
      const preferred = page.photos.findIndex((p) => p.featured);
      const bgIdx =
        preferred >= 0 && coverRetention(photoAspect(page.photos[preferred]), ctx.pageAspect) >= 0.55
          ? preferred
          : pickBackdrop(page.photos, ctx.pageAspect);
      const bg = page.photos[bgIdx];
      const cards = page.photos.filter((_, i) => i !== bgIdx);
      const { boxes, freeCorners } = cardLayout(cards, ctx.pageAspect, { variant: page.variant || 0 });
      const titleCorner = freeCorners[0] || "tl";
      return `
      <section class="pdf-page pdf-tpl-backdrop-cards pdf-dark">
        ${fullBleed(bg, ctx, page.stopHeading)}
        ${cards.map((p, i) => photoBox(p, boxes[i], ctx, { cls: "pdf-card", alt: page.stopHeading })).join("\n")}
        ${title(page, `pdf-title-light pdf-title-${titleCorner}`)}
      </section>`;
    },
  },

  // Aspect-true mosaic floating on a blurred, darkened copy of one of its
  // own photos - fills the page without cropping anything.
  "blur-mosaic": {
    label: "Mosaic on Blurred Background",
    photoSlots: { min: 2, max: 6, ideal: 4 },
    hasText: false,
    selectable: true,
    fit(photos, ctx) {
      return collageFit(photos, ctx, { inset: 4, gap: 1.4 });
    },
    render(page, strings, ctx) {
      const h = pageH(ctx);
      const band = titleBand(page, ctx);
      const inset = 4;
      const { boxes } = collage(
        page.photos,
        { x: inset, y: inset + band, w: 100 - 2 * inset, h: h - 2 * inset - band },
        { gap: 1.4, fillTolerance: 0.93, variant: page.variant || 0 }
      );
      const bg = page.photos[pickBackdrop(page.photos, ctx.pageAspect)];
      return `
      <section class="pdf-page pdf-tpl-blur-mosaic pdf-dark">
        ${blurredBackdrop(bg)}
        ${title(page, "pdf-title-light pdf-title-top")}
        ${page.photos.map((p, i) => photoBox(p, boxes[i], ctx, { cls: "pdf-card", alt: page.stopHeading })).join("\n")}
      </section>`;
    },
  },

  // Loose prints on plain paper with generous white space.
  scatter: {
    label: "Scattered Prints",
    photoSlots: { min: 2, max: 3, ideal: 2 },
    hasText: false,
    selectable: true,
    fit(photos, ctx) {
      return Math.min(1, collageFit(photos, ctx, { inset: 9, gap: 6 }) + 0.1);
    },
    render(page, strings, ctx) {
      const h = pageH(ctx);
      const band = titleBand(page, ctx, 0.15);
      const inset = 9;
      const { boxes } = collage(
        page.photos,
        { x: inset, y: inset + band, w: 100 - 2 * inset, h: h - 2 * inset - band },
        { gap: 6, fillTolerance: 2, variant: page.variant || 0 }
      );
      const seed = (page.variant || 0) + 1;
      return `
      <section class="pdf-page pdf-tpl-scatter">
        ${title(page, "pdf-title-top")}
        ${page.photos
          .map((p, i) => {
            const b = boxes[i];
            const moved = { ...b, x: b.x + jitter(seed, i, 2.5), y: b.y + jitter(seed + 7, i, 2.5) };
            return photoBox(p, moved, ctx, { cls: "pdf-card", alt: page.stopHeading });
          })
          .join("\n")}
      </section>`;
    },
  },

  "duo-caption": {
    label: "2 Photos + Caption",
    photoSlots: { min: 2, max: 2, ideal: 2 },
    hasText: true,
    selectable: true,
    fit(photos, ctx) {
      return collageFit(photos, ctx, { inset: 5, gap: 2.5, topBand: pageH(ctx) * 0.18 });
    },
    render(page, strings, ctx) {
      const hasContent = page.photos.some((p) => p.caption) || page.narrative;
      const h = pageH(ctx);
      const band = titleBand(page, ctx);
      const textZone = hasContent ? h * 0.2 : 0;
      const inset = 5;
      const { boxes } = collage(
        page.photos,
        { x: inset, y: inset + band, w: 100 - 2 * inset, h: h - 2 * inset - band - textZone },
        { gap: 2.5, fillTolerance: 0.94, variant: page.variant || 0 }
      );
      return `
      <section class="pdf-page pdf-tpl-duo-caption">
        ${title(page, "pdf-title-top")}
        ${page.photos.map((p, i) => photoBox({ ...p, caption: null }, boxes[i], ctx, { alt: page.stopHeading })).join("\n")}
        ${
          hasContent
            ? `<div class="pdf-bottom-text" style="height:${(textZone / h) * 100}%">
          ${captionsList(page.photos)}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
        </div>`
            : ""
        }
      </section>`;
    },
  },

  // Classic gallery grid: aspect-true collage with clean white gutters.
  "grid-4": {
    label: "Photo Grid (3–4)",
    photoSlots: { min: 3, max: 4, ideal: 4 },
    hasText: false,
    selectable: true,
    fit(photos, ctx) {
      return collageFit(photos, ctx, { inset: 5, gap: 2 });
    },
    render(page, strings, ctx) {
      return renderGrid(page, ctx, { inset: 5, gap: 2 });
    },
  },

  // Dense edge-to-edge mosaic with hairline gaps.
  "grid-6": {
    label: "Dense Mosaic (5–6)",
    photoSlots: { min: 4, max: 6, ideal: 6 },
    hasText: false,
    selectable: true,
    fit(photos, ctx) {
      return collageFit(photos, ctx, { inset: 0, gap: 0.6 });
    },
    render(page, strings, ctx) {
      return renderGrid(page, ctx, { inset: 0, gap: 0.6, dark: true });
    },
  },

  "photo-strip": {
    label: "3 Photos + Caption",
    photoSlots: { min: 3, max: 3, ideal: 3 },
    hasText: true,
    selectable: true,
    fit(photos, ctx) {
      return collageFit(photos, ctx, { inset: 5, gap: 2, topBand: pageH(ctx) * 0.2 });
    },
    render(page, strings, ctx) {
      const hasContent = page.photos.some((p) => p.caption) || page.narrative;
      const h = pageH(ctx);
      const band = titleBand(page, ctx);
      const textZone = hasContent ? h * 0.22 : 0;
      const inset = 5;
      const { boxes } = collage(
        page.photos,
        { x: inset, y: inset + band, w: 100 - 2 * inset, h: h - 2 * inset - band - textZone },
        { gap: 2, fillTolerance: 0.94, variant: page.variant || 0 }
      );
      return `
      <section class="pdf-page pdf-tpl-photo-strip">
        ${title(page, "pdf-title-top")}
        ${page.photos.map((p, i) => photoBox({ ...p, caption: null }, boxes[i], ctx, { alt: page.stopHeading })).join("\n")}
        ${
          hasContent
            ? `<div class="pdf-bottom-text" style="height:${(textZone / h) * 100}%">
          ${captionsList(page.photos)}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
        </div>`
            : ""
        }
      </section>`;
    },
  },

  // Text only - or, with `page.backdrop`, text on a paper panel over a
  // blurred photo (the photobook pack's chapter pages).
  "text-chapter": {
    label: "Text Page",
    photoSlots: { min: 0, max: 0, ideal: 0 },
    hasText: true,
    selectable: false,
    fit: () => 0,
    render(page, strings, ctx) {
      const text = `${page.narrative || ""}${page.pullQuote || ""}`;
      return `
      <section class="pdf-page pdf-tpl-text-chapter${page.backdrop ? " pdf-has-backdrop" : ""}">
        ${page.backdrop ? blurredBackdrop(page.backdrop) : ""}
        <div class="pdf-chapter-text ${textSizeClass(text)}">
          ${page.stopHeading ? `<h2 class="pdf-title">${escapeHtml(page.stopHeading)}</h2>` : ""}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
          ${page.pullQuote ? `<blockquote class="pdf-pull-quote">${escapeHtml(page.pullQuote)}</blockquote>` : ""}
        </div>
      </section>`;
    },
  },

  "info-card-page": {
    label: "Info Card",
    photoSlots: { min: 0, max: 1, ideal: 0 },
    hasText: true,
    selectable: false,
    fit: () => 0,
    render(page, strings) {
      const card = page.infoCard;
      return `
      <section class="pdf-page pdf-tpl-info-card-page${card.heroPhotoUrl ? "" : " pdf-no-hero"}">
        ${card.heroPhotoUrl ? `<div class="pdf-info-hero"><img src="${escapeHtml(card.heroPhotoUrl)}" alt="${escapeHtml(card.placeName)}"></div>` : ""}
        <div class="pdf-info-body">
          <h2>${escapeHtml(card.placeName)}${
            card.websiteUrl
              ? ` <a class="pdf-info-link" href="${escapeHtml(card.websiteUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(strings.visitWebsite)}">↗</a>`
              : ""
          }</h2>
          ${card.subtitle ? `<p class="pdf-info-subtitle">${escapeHtml(card.subtitle)}</p>` : ""}
          ${card.summary ? `<p class="pdf-info-summary">${escapeHtml(card.summary)}</p>` : ""}
          ${
            card.facts?.length
              ? `<dl class="pdf-info-facts">
            ${card.facts
              .map((f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`)
              .join("\n")}
          </dl>`
              : ""
          }
        </div>
      </section>`;
    },
  },
};

function renderGrid(page, ctx, { inset, gap, dark = false }) {
  const h = pageH(ctx);
  const band = titleBand(page, ctx);
  const { boxes } = collage(
    page.photos,
    { x: inset, y: inset + band, w: 100 - 2 * inset, h: h - 2 * inset - band },
    { gap, fillTolerance: 0.9, variant: page.variant || 0 }
  );
  const titleCls = dark ? "pdf-title-light pdf-title-top" : "pdf-title-top";
  return `
      <section class="pdf-page pdf-tpl-grid${dark ? " pdf-dark pdf-ink-bg" : ""}">
        ${title(page, titleCls)}
        ${page.photos.map((p, i) => photoBox(p, boxes[i], ctx, { alt: page.stopHeading })).join("\n")}
      </section>`;
}

export const PDF_TEMPLATE_IDS = Object.keys(PDF_TEMPLATES);

export function getTemplate(id) {
  return PDF_TEMPLATES[id] || PDF_TEMPLATES["grid-4"];
}

// Shared stylesheet for every template. Page dimensions come from the
// --page-w / --page-h variables pdfDocument.js sets from the paper size;
// type sizes are in rem, with the root size scaled to the page (1rem = 10pt
// on a 21 cm page) so text keeps its proportions on a 30 cm photobook.
export const PDF_TEMPLATE_CSS = `
  .pdf-page {
    width: var(--page-w);
    height: var(--page-h);
    break-after: page;
    position: relative;
    overflow: hidden;
    background: var(--paper);
    color: var(--ink);
  }
  .pdf-page:last-child { break-after: auto; }
  .pdf-page img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pdf-narrative p { margin: 0.5em 0; }
  .pdf-pull-quote {
    font-family: var(--heading-font);
    font-size: 1.3em; line-height: 1.35; color: var(--accent);
    border-left: 4px solid var(--accent); margin: 0.8em 0 0; padding: 0 0 0 0.7em;
  }
  .pdf-text-l { font-size: 1.25rem; }
  .pdf-text-m { font-size: 1.1rem; }
  .pdf-text-s { font-size: 0.95rem; }
  .pdf-text-xs { font-size: 0.85rem; }

  .pdf-fill { position: absolute; inset: 0; }
  .pdf-box { position: absolute; overflow: hidden; }
  .pdf-card { box-shadow: 0 1.2mm 4mm rgba(0,0,0,0.45), 0 0 0.6mm rgba(0,0,0,0.25); }
  .pdf-box-caption {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 1.2em 0.8em 0.5em; font-size: 0.75rem; color: #fff; line-height: 1.3;
    background: linear-gradient(to top, rgba(0,0,0,0.65), transparent);
  }
  .pdf-blur-bg { position: absolute; inset: 0; overflow: hidden; }
  .pdf-blur-bg img { filter: blur(18px) saturate(0.85) brightness(0.72); transform: scale(1.3); }
  .pdf-ink-bg { background: var(--ink); }

  /* titles: handwritten in the photobook pack (--title-font), theme heading
     font everywhere else */
  .pdf-title {
    position: absolute; margin: 0; z-index: 2;
    font-family: var(--title-font); font-weight: 400;
    font-size: 2.6rem; line-height: 1.1; color: var(--accent);
    text-transform: var(--title-case); letter-spacing: var(--title-tracking);
    max-width: 44%;
  }
  .pdf-title-light { color: #fff; text-shadow: 0 0.4mm 2.5mm rgba(0,0,0,0.6); }
  .pdf-title-top { left: 5%; right: 5%; top: 3.5%; max-width: none; }
  .pdf-title-tl { left: 5%; top: 5%; }
  .pdf-title-tr { right: 5%; top: 5%; text-align: right; }
  .pdf-title-bl { left: 5%; bottom: 5%; }
  .pdf-title-br { right: 5%; bottom: 5%; text-align: right; }

  .pdf-caption-overlay {
    position: absolute; left: 0; right: 0; bottom: 0; margin: 0;
    padding: 1em 1.2em; font-size: 0.9rem; color: #fff;
    background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
  }
  .pdf-tpl-single .pdf-caption-overlay ~ .pdf-title-bl,
  .pdf-tpl-single .pdf-title-bl { bottom: 9%; }

  /* hero-pullquote */
  .pdf-tpl-hero-pullquote { display: grid; }
  .pdf-hero-photo { position: relative; overflow: hidden; }
  .pdf-hero-text { padding: 1.4em 1.8em; overflow: hidden; }
  .pdf-hero-text h2 {
    font-family: var(--title-font); color: var(--accent); margin: 0 0 0.2em;
    font-size: 2.4rem; font-weight: 400; text-transform: var(--title-case); letter-spacing: var(--title-tracking);
  }
  .pdf-subtitle { margin: 0 0 0.6em; opacity: 0.75; font-size: 1rem; }

  /* hero-overlay: translucent band across a full-bleed photo */
  .pdf-band {
    position: absolute; left: 0; right: 0; bottom: 7%;
    max-height: 60%; overflow: hidden;
    padding: 1.2em 7% 1.3em;
    background: rgba(18, 18, 24, 0.55); color: #fff;
  }
  .pdf-band .pdf-title { position: static; max-width: none; margin-bottom: 0.2em; font-size: 2.8rem; }
  .pdf-band .pdf-pull-quote { color: #fff; border-color: rgba(255,255,255,0.7); }

  /* cover-collage */
  .pdf-cover-band {
    position: absolute; left: 0; right: 0; top: 56%;
    padding: 1.1em 7% 1.2em; text-align: center;
    background: rgba(18, 18, 24, 0.5); color: #fff;
  }
  .pdf-cover-band .pdf-title { position: static; max-width: none; font-size: 3.8rem; }
  .pdf-cover-band .pdf-subtitle { margin: 0.4em 0 0; opacity: 0.9; font-size: 1.1rem; }

  /* caption zone under duo / strip collages */
  .pdf-bottom-text {
    position: absolute; left: 5%; right: 5%; bottom: 3%;
    overflow: hidden; font-size: 1rem;
  }
  .pdf-caption-strip { font-size: 0.9rem; opacity: 0.75; margin: 0 0 0.5em; }

  /* text-chapter */
  .pdf-tpl-text-chapter { display: flex; align-items: center; justify-content: center; }
  .pdf-chapter-text { position: relative; max-width: 76%; padding: 2em 2.2em; }
  .pdf-has-backdrop .pdf-chapter-text {
    background: color-mix(in srgb, var(--paper) 90%, transparent);
    box-shadow: 0 1mm 5mm rgba(0,0,0,0.35);
  }
  .pdf-chapter-text .pdf-title { position: static; max-width: none; margin: 0 0 0.3em; font-size: 2.8rem; }

  /* info-card-page */
  .pdf-tpl-info-card-page { display: grid; grid-template-rows: 40% 60%; }
  .pdf-tpl-info-card-page.pdf-no-hero { grid-template-rows: 100%; }
  .pdf-info-hero { position: relative; overflow: hidden; }
  .pdf-info-body { padding: 1.6em 2em; overflow: hidden; background: var(--sand); }
  .pdf-info-body h2 {
    font-family: var(--heading-font); color: var(--accent); margin: 0; font-size: 1.8em;
  }
  .pdf-info-link {
    display: inline-flex; align-items: center; justify-content: center;
    width: 0.7em; height: 0.7em; font-size: 0.6em; margin-left: 0.2em;
    border-radius: 50%; border: 2px solid var(--accent2); color: var(--accent2); text-decoration: none;
  }
  .pdf-info-subtitle { font-style: italic; color: var(--accent2); margin: 0.3em 0 0; }
  .pdf-info-summary { margin: 0.8em 0; font-size: 1.05em; }
  .pdf-info-facts {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.8em 1.4em; margin-top: 1em;
  }
  .pdf-info-facts div { border-top: 1px solid var(--line); padding-top: 0.4em; }
  .pdf-info-facts dt { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.7; }
  .pdf-info-facts dd { margin: 0.15em 0 0; font-weight: bold; }
`;
