import { getTheme } from "./themes.js";
import { isEmbeddable } from "./embeds.js";
import { getStrings } from "./i18n.js";

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function dateRange(start, end, locale) {
  const opts = { day: "numeric", month: "long", year: "numeric" };
  const s = new Date(start).toLocaleDateString(locale, opts);
  const e = new Date(end).toLocaleDateString(locale, opts);
  return s === e ? s : `${s} &ndash; ${e}`;
}

function tripDateRange(stops, locale) {
  if (stops.length === 0) return "";
  return dateRange(stops[0].startedAt, stops[stops.length - 1].endedAt, locale);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const PHOTOS_PER_SLIDE = 6;

// A presentation is a different medium from the scrolling page/PDF: each
// stop becomes a small vertical stack (down-arrow) of slides - the story
// text, then its featured photo full-bleed, then grid slides for the
// rest - while left/right moves between stops. No map here; reveal.js's
// fixed-size slides don't suit an interactive Leaflet map, and the web
// view already covers that.
function infoCardSlide(card, strings) {
  return `
      <section>
        ${card.heroPhotoUrl ? `<img class="deck-card-hero" src="${escapeHtml(card.heroPhotoUrl)}" alt="${escapeHtml(card.placeName)}">` : ""}
        <h2>${escapeHtml(card.placeName)}${
          card.websiteUrl
            ? ` <a class="info-card-link" href="${escapeHtml(card.websiteUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(strings.visitWebsite)}" aria-label="${escapeHtml(strings.visitWebsite)}">↗</a>`
            : ""
        }</h2>
        ${card.subtitle ? `<p class="deck-dates">${escapeHtml(card.subtitle)}</p>` : ""}
        ${card.summary ? `<p class="deck-narrative">${escapeHtml(card.summary)}</p>` : ""}
        ${
          card.facts?.length
            ? `<div class="deck-facts">
          ${card.facts
            .map(
              (f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`
            )
            .join("\n")}
        </div>`
            : ""
        }
      </section>`;
}

export function renderStoryDeck(story) {
  const theme = getTheme(story.theme);
  const strings = getStrings(story.contentLanguage);
  const includedByStop = story.stops.map((s) => s.photos.filter((p) => p.included));
  const featuredByStop = includedByStop.map((photos) => photos.find((p) => p.featured));
  const coverPhoto = (featuredByStop.find(Boolean) || includedByStop.flat()[0])?.thumbUrl;

  const stopSlides = story.stops
    .map((stop, i) => {
      const featured = featuredByStop[i];
      const gridPhotos = featured
        ? includedByStop[i].filter((p) => p.id !== featured.id)
        : includedByStop[i];

      const textSlide = `
      <section>
        <h2><span class="deck-number">${i + 1}</span>${escapeHtml(stop.heading)}</h2>
        <p class="deck-dates">${dateRange(stop.startedAt, stop.endedAt, strings.dateLocale)}</p>
        ${stop.narrative ? `<p class="deck-narrative">${escapeHtml(stop.narrative)}</p>` : ""}
        ${stop.pullQuote ? `<blockquote class="deck-quote">${escapeHtml(stop.pullQuote)}</blockquote>` : ""}
      </section>`;

      // A slide deck has no real "middle of the scroll" - top-placed cards
      // get a slide before the photo grids (matching the web view), while
      // middle/end ones both just land after the grids in this format.
      const cards = stop.infoCards || [];
      const topCardSlides = cards
        .filter((c) => (c.placement || "top") === "top")
        .map((c) => infoCardSlide(c, strings))
        .join("\n");
      const laterCardSlides = cards
        .filter((c) => c.placement === "middle" || c.placement === "end")
        .map((c) => infoCardSlide(c, strings))
        .join("\n");

      // Only embeddable (allowlisted + a real /embed link) routes get their
      // own slide; a plain activity-page link wouldn't render inside an
      // iframe anyway, so it's skipped here rather than shown as a dead frame.
      const embedSlides = (stop.embeds || [])
        .filter((e) => isEmbeddable(e.url))
        .map(
          (e) => `
      <section>
        ${e.title ? `<h3 class="deck-embed-title">${escapeHtml(e.title)}</h3>` : ""}
        <iframe class="deck-embed-frame" src="${escapeHtml(e.url)}" allowfullscreen
                title="${escapeHtml(e.title || e.provider)}"></iframe>
      </section>`
        )
        .join("\n");

      // A plain <img>, not data-background-image: reveal's background layer
      // for *nested* (vertical-stack) slides doesn't reliably composite
      // under Playwright/headless Chrome - it stayed black in testing even
      // though every computed style checked out. A real element sidesteps
      // reveal's separate background system entirely.
      const featuredSlide = featured
        ? `
      <section class="img-slide">
        <img class="deck-featured-img" src="${escapeHtml(featured.fullUrl || featured.thumbUrl)}" alt="${escapeHtml(featured.caption || stop.heading)}">
        ${featured.caption ? `<p class="deck-caption-overlay">${escapeHtml(featured.caption)}</p>` : ""}
      </section>`
        : "";

      const gridSlides = chunk(gridPhotos, PHOTOS_PER_SLIDE)
        .map(
          (page) => `
      <section>
        <div class="deck-grid deck-grid-${page.length}">
          ${page
            .map(
              (p) => `<figure><img src="${escapeHtml(p.thumbUrl)}" alt="${escapeHtml(p.caption || stop.heading)}">${
                p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""
              }</figure>`
            )
            .join("\n")}
        </div>
      </section>`
        )
        .join("\n");

      return `<section>${textSlide}${topCardSlides}${embedSlides}${featuredSlide}${gridSlides}${laterCardSlides}</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${story.contentLanguage || "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(story.title)} — Presentation</title>
<link rel="stylesheet" href="/vendor/reveal/reset.css">
<link rel="stylesheet" href="/vendor/reveal/reveal.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${theme.fontImport}&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: ${theme.ink};
    --paper: ${theme.paper};
    --accent: ${theme.accent};
    --accent2: ${theme.accent2};
    --sand: ${theme.sand};
  }
  .reveal { color: var(--ink); font-family: ${theme.bodyFont}; }
  .reveal .slides { text-align: left; }
  .reveal .slides section:not(.bg-slide) { background: var(--paper); }
  .reveal h1, .reveal h2, .reveal h3 {
    font-family: ${theme.headingFont};
    text-transform: ${theme.headingCase};
    letter-spacing: ${theme.headingTracking};
    color: var(--accent);
  }
  .deck-number {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.4em; height: 1.4em; border-radius: 50%; margin-right: 0.3em;
    background: var(--accent); color: var(--paper); font-family: ${theme.bodyFont};
    font-size: 0.55em; vertical-align: middle;
  }
  .deck-dates { color: var(--accent2); opacity: 0.85; font-size: 0.5em; }
  .deck-narrative { font-size: 0.62em; line-height: 1.5; max-width: 30em; }
  .deck-quote {
    font-family: ${theme.headingFont};
    font-size: 0.85em; line-height: 1.3; color: var(--accent);
    border-left: 0.05em solid var(--accent); padding-left: 0.5em; margin: 0.6em 0 0;
  }
  .deck-caption-overlay {
    position: absolute; left: 0; right: 0; bottom: 0;
    margin: 0; padding: 0.6em 0.8em; font-size: 0.5em;
    background: linear-gradient(to top, rgba(0,0,0,0.75), transparent);
    color: #fff;
  }
  .deck-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem;
    width: 100%; height: 78vh;
  }
  .deck-grid-1, .deck-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .deck-grid figure { margin: 0; position: relative; overflow: hidden; border-radius: 6px; }
  .deck-grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .deck-grid figcaption {
    position: absolute; left: 0; right: 0; bottom: 0;
    margin: 0; padding: 0.4em 0.6em; font-size: 0.4em;
    background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
    color: #fff;
  }
  /* Scoped to the <section> specifically: reveal.js clones a slide's
     class list onto its own generated .slide-background <div>, so an
     unscoped ".bg-slide" rule would also hijack reveal's internal
     background layer and hide the image. */
  section.bg-slide {
    position: relative; height: 100%;
    display: flex !important; flex-direction: column; justify-content: flex-end;
  }
  section.bg-slide::before {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.25) 70%);
  }
  .deck-embed-title { margin: 0 0 0.4em 0; }
  .deck-card-hero { width: 100%; max-height: 32vh; object-fit: cover; border-radius: 8px; margin-bottom: 0.5em; display: block; }
  .info-card-link {
    display: inline-flex; align-items: center; justify-content: center;
    width: 0.9em; height: 0.9em; margin-left: 0.2em; font-size: 0.55em;
    border-radius: 50%; border: 0.08em solid var(--accent2);
    color: var(--accent2); text-decoration: none; vertical-align: middle;
  }
  .deck-facts {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.5em 1em; margin-top: 0.8em; font-size: 0.6em;
  }
  .deck-facts div { border-top: 1px solid var(--accent2); padding-top: 0.3em; }
  .deck-facts dt { text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.75; font-size: 0.85em; }
  .deck-facts dd { margin: 0.1em 0 0; font-weight: bold; }
  .deck-embed-frame { width: 100%; height: 80vh; border: none; border-radius: 8px; }
  .img-slide { position: relative; height: 100%; }
  .deck-featured-img {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  }
  .cover-slide h1, .cover-slide .deck-dates {
    position: relative; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,0.8);
  }
  .cover-slide h1 { font-size: 1.6em; }
  .cover-slide .deck-dates { font-size: 0.6em; }
</style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section class="bg-slide cover-slide" ${coverPhoto ? `data-background-image="${escapeHtml(coverPhoto)}" data-background-size="cover"` : ""}>
        <h1>${escapeHtml(story.title)}</h1>
        <p class="deck-dates">${tripDateRange(story.stops, strings.dateLocale)}</p>
      </section>
      ${story.intro ? `<section><p class="deck-narrative">${escapeHtml(story.intro)}</p></section>` : ""}
      ${stopSlides}
      ${story.outro ? `<section><p class="deck-narrative">${escapeHtml(story.outro)}</p></section>` : ""}
    </div>
  </div>
  <script src="/vendor/reveal/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      controls: true,
      progress: true,
      center: false,
      transition: 'slide',
      width: 1280,
      height: 800,
    });
  </script>
</body>
</html>`;
}
