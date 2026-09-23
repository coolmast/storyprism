import { escapeHtml, paragraphs } from "./render.js";

// One page = one `.pdf-page`, full document width/height (see PDF_PAGE_CSS's
// `.pdf-page { width/height: 100%; break-after: page; }`), built with CSS
// Grid so each template gets an exact, deterministic layout regardless of
// photo aspect ratios - the actual fix for "always the same result" that
// prompted this whole rewrite (a fixed page box + Grid, not flow-and-hope).
//
// Every template exports:
//   label       - shown in the "PDF layout" picker
//   photoSlots  - { min, max } included-photo capacity; the planner uses
//                 this to decide what fits and to chunk remaining photos
//   hasText     - whether this template has a narrative/pull-quote text
//                 zone (used by the planner to prefer this template for a
//                 stop's opening page)
//   render(page, strings) -> one <section class="pdf-page ...">...</section>
//
// `page` shape (all fields optional depending on the template):
//   { photos: [{thumbUrl, fullUrl, caption}], stopHeading, narrative,
//     pullQuote, infoCard }

function photoImg(p, alt) {
  return `<img src="${escapeHtml(p.fullUrl || p.thumbUrl)}" alt="${escapeHtml(p.caption || alt || "")}">`;
}

function captionsList(photos) {
  const withCaptions = photos.filter((p) => p.caption);
  if (!withCaptions.length) return "";
  return `<p class="pdf-caption-strip">${withCaptions.map((p) => escapeHtml(p.caption)).join(" &middot; ")}</p>`;
}

export const PDF_TEMPLATES = {
  "single-full-bleed": {
    label: "Single Photo",
    photoSlots: { min: 1, max: 1 },
    hasText: false,
    render(page) {
      const p = page.photos[0];
      return `
      <section class="pdf-page pdf-tpl-single-full-bleed">
        <div class="pdf-photo-full">${photoImg(p, page.stopHeading)}</div>
        ${p.caption ? `<p class="pdf-caption-overlay">${escapeHtml(p.caption)}</p>` : ""}
      </section>`;
    },
  },

  "hero-pullquote": {
    label: "Opening Page",
    photoSlots: { min: 0, max: 1 },
    hasText: true,
    render(page) {
      const p = page.photos[0];
      return `
      <section class="pdf-page pdf-tpl-hero-pullquote">
        ${p ? `<div class="pdf-hero-photo">${photoImg(p, page.stopHeading)}</div>` : `<div class="pdf-hero-photo pdf-hero-photo-empty"></div>`}
        <div class="pdf-hero-text">
          ${page.stopHeading ? `<h2>${escapeHtml(page.stopHeading)}</h2>` : ""}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
          ${page.pullQuote ? `<blockquote class="pdf-pull-quote">${escapeHtml(page.pullQuote)}</blockquote>` : ""}
        </div>
      </section>`;
    },
  },

  "duo-caption": {
    label: "2 Photos + Caption",
    photoSlots: { min: 2, max: 2 },
    hasText: true,
    render(page) {
      const [a, b] = page.photos;
      // Captions are optional per photo, so this specific pair often won't
      // have one - a text zone with nothing in it would just be dead white
      // space under two photos. Collapse it and let the photos fill the
      // page instead of wasting the layout on an empty caption strip.
      const hasContent = page.photos.some((p) => p.caption) || page.narrative;
      return `
      <section class="pdf-page pdf-tpl-duo-caption${hasContent ? "" : " pdf-notext"}">
        <div class="pdf-duo-a">${photoImg(a, page.stopHeading)}</div>
        <div class="pdf-duo-b">${photoImg(b, page.stopHeading)}</div>
        ${
          hasContent
            ? `<div class="pdf-duo-text">
          ${captionsList(page.photos)}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
        </div>`
            : ""
        }
      </section>`;
    },
  },

  "grid-4": {
    label: "4-Photo Grid",
    photoSlots: { min: 3, max: 4 },
    hasText: false,
    render(page) {
      return `
      <section class="pdf-page pdf-tpl-grid-4 pdf-count-${page.photos.length}">
        ${page.photos.map((p) => `<div class="pdf-grid-cell">${photoImg(p, page.stopHeading)}</div>`).join("\n")}
      </section>`;
    },
  },

  "grid-6": {
    label: "6-Photo Grid",
    photoSlots: { min: 5, max: 6 },
    hasText: false,
    render(page) {
      return `
      <section class="pdf-page pdf-tpl-grid-6 pdf-count-${page.photos.length}">
        ${page.photos.map((p) => `<div class="pdf-grid-cell">${photoImg(p, page.stopHeading)}</div>`).join("\n")}
      </section>`;
    },
  },

  "photo-strip": {
    label: "Photo Strip + Caption",
    photoSlots: { min: 3, max: 3 },
    hasText: true,
    render(page) {
      // Same reasoning as duo-caption: no point reserving a third of the
      // page for captions these particular 3 photos don't have.
      const hasContent = page.photos.some((p) => p.caption) || page.narrative;
      return `
      <section class="pdf-page pdf-tpl-photo-strip${hasContent ? "" : " pdf-notext"}">
        <div class="pdf-strip">
          ${page.photos.map((p) => `<div class="pdf-strip-cell">${photoImg(p, page.stopHeading)}</div>`).join("\n")}
        </div>
        ${
          hasContent
            ? `<div class="pdf-strip-text">
          ${captionsList(page.photos)}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
        </div>`
            : ""
        }
      </section>`;
    },
  },

  "text-chapter": {
    label: "Text Page",
    photoSlots: { min: 0, max: 0 },
    hasText: true,
    render(page) {
      return `
      <section class="pdf-page pdf-tpl-text-chapter">
        <div class="pdf-chapter-text">
          ${page.stopHeading ? `<h2>${escapeHtml(page.stopHeading)}</h2>` : ""}
          ${page.narrative ? `<div class="pdf-narrative">${paragraphs(page.narrative)}</div>` : ""}
          ${page.pullQuote ? `<blockquote class="pdf-pull-quote">${escapeHtml(page.pullQuote)}</blockquote>` : ""}
        </div>
      </section>`;
    },
  },

  "info-card-page": {
    label: "Info Card",
    photoSlots: { min: 0, max: 1 },
    hasText: true,
    render(page, strings) {
      const card = page.infoCard;
      return `
      <section class="pdf-page pdf-tpl-info-card-page">
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

// Every id in PDF_LAYOUT_PACKS must exist here - validated once at import
// time rather than failing confusingly deep inside a render call.
export const PDF_TEMPLATE_IDS = Object.keys(PDF_TEMPLATES);

export function getTemplate(id) {
  return PDF_TEMPLATES[id] || PDF_TEMPLATES["grid-4"];
}

// Shared stylesheet for every template. Physical page size comes from a
// separate `@page` rule (see pdf.js); each `.pdf-page` just fills that box.
// Deliberately full-bleed (0 margin on `.pdf-page` itself) with each
// template managing its own internal padding for text zones - a "single
// full-bleed photo" page genuinely has ink to every edge, which no amount
// of `@page margin` would allow if it were global.
export const PDF_TEMPLATE_CSS = `
  .pdf-page {
    width: 100%;
    height: 100vh;
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
    font-size: 1.4em; line-height: 1.35; color: var(--accent);
    border-left: 4px solid var(--accent); margin: 0.8em 0 0; padding: 0 0 0 0.7em;
  }

  /* single-full-bleed */
  .pdf-tpl-single-full-bleed .pdf-photo-full { position: absolute; inset: 0; }
  .pdf-caption-overlay {
    position: absolute; left: 0; right: 0; bottom: 0; margin: 0;
    padding: 1em 1.2em; font-size: 0.9em; color: #fff;
    background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
  }

  /* hero-pullquote */
  .pdf-tpl-hero-pullquote { display: grid; grid-template-rows: 55% 45%; }
  .pdf-hero-photo { position: relative; overflow: hidden; }
  .pdf-hero-photo-empty { background: var(--sand); }
  .pdf-hero-text { padding: 1.4em 1.6em; overflow: hidden; }
  .pdf-hero-text h2 {
    font-family: var(--heading-font); color: var(--accent); margin: 0 0 0.3em;
    font-size: 1.8em; text-transform: var(--heading-case); letter-spacing: var(--heading-tracking);
  }

  /* duo-caption */
  .pdf-tpl-duo-caption {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 62% 38%;
    grid-template-areas: "a b" "text text";
  }
  .pdf-duo-a { grid-area: a; position: relative; overflow: hidden; }
  .pdf-duo-b { grid-area: b; position: relative; overflow: hidden; }
  .pdf-duo-text { grid-area: text; padding: 1.2em 1.6em; overflow: hidden; }
  .pdf-tpl-duo-caption.pdf-notext { grid-template-rows: 100% 0; }

  /* grid-4 / grid-6: full-bleed cells with a thin ink-colored gap */
  .pdf-tpl-grid-4, .pdf-tpl-grid-6 {
    display: grid; gap: 3px; background: var(--ink);
  }
  .pdf-tpl-grid-4.pdf-count-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .pdf-tpl-grid-4.pdf-count-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .pdf-tpl-grid-4.pdf-count-3 .pdf-grid-cell:first-child { grid-column: span 2; }
  .pdf-tpl-grid-6.pdf-count-6 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .pdf-tpl-grid-6.pdf-count-5 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .pdf-tpl-grid-6.pdf-count-5 .pdf-grid-cell:first-child { grid-column: span 2; }
  .pdf-grid-cell { position: relative; overflow: hidden; }

  /* photo-strip */
  .pdf-tpl-photo-strip { display: grid; grid-template-rows: 65% 35%; }
  .pdf-tpl-photo-strip.pdf-notext { grid-template-rows: 100% 0; }
  .pdf-strip { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px; background: var(--ink); }
  .pdf-strip-cell { position: relative; overflow: hidden; }
  .pdf-strip-text { padding: 1.2em 1.6em; overflow: hidden; }
  .pdf-caption-strip { font-size: 0.85em; opacity: 0.75; margin: 0 0 0.6em; }

  /* text-chapter */
  .pdf-tpl-text-chapter { display: flex; align-items: center; justify-content: center; }
  .pdf-chapter-text { max-width: 75%; padding: 2em; }
  .pdf-chapter-text h2 {
    font-family: var(--heading-font); color: var(--accent); font-size: 2.2em; margin: 0 0 0.4em;
    text-transform: var(--heading-case); letter-spacing: var(--heading-tracking);
  }
  .pdf-chapter-text .pdf-narrative { font-size: 1.15em; }

  /* info-card-page */
  .pdf-tpl-info-card-page { display: grid; grid-template-rows: 40% 60%; }
  .pdf-info-hero { position: relative; overflow: hidden; }
  .pdf-tpl-info-card-page:has(.pdf-info-hero:empty) { grid-template-rows: 0 100%; }
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
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.8em 1.4em; margin-top: 1em;
  }
  .pdf-info-facts div { border-top: 1px solid var(--line); padding-top: 0.4em; }
  .pdf-info-facts dt { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.7; }
  .pdf-info-facts dd { margin: 0.15em 0 0; font-weight: bold; }
`;
