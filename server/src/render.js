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

function paragraphs(text) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
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

function photoFigure(p, fallbackAlt) {
  return `
    <figure>
      <a class="pswp-item" href="${escapeHtml(p.fullUrl || p.thumbUrl)}"
         data-pswp-width="${p.width || 1600}" data-pswp-height="${p.height || 1200}"
         target="_blank" rel="noreferrer">
        <img src="${escapeHtml(p.thumbUrl)}" alt="${escapeHtml(p.caption || fallbackAlt)}" width="${p.width || ""}" height="${p.height || ""}">
      </a>
      ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}
    </figure>`;
}

function embedBlock(embed, strings) {
  if (isEmbeddable(embed.url)) {
    return `
    <div class="route-embed">
      ${embed.title ? `<p class="route-embed-title">${escapeHtml(embed.title)}</p>` : ""}
      <div class="route-embed-frame">
        <iframe src="${escapeHtml(embed.url)}" loading="lazy" allowfullscreen
                title="${escapeHtml(embed.title || embed.provider)}"></iframe>
      </div>
    </div>`;
  }
  return `
    <a class="route-embed-link" href="${escapeHtml(embed.url)}" target="_blank" rel="noreferrer">
      ${strings.viewOn(embed.title || embed.provider, embed.provider)}
    </a>`;
}

function infoCardBlock(card) {
  return `
    <div class="info-card">
      ${card.heroPhotoUrl ? `<img class="info-card-hero" src="${escapeHtml(card.heroPhotoUrl)}" alt="${escapeHtml(card.placeName)}">` : ""}
      <div class="info-card-header">
        <h3>${escapeHtml(card.placeName)}</h3>
        ${card.subtitle ? `<p class="info-card-subtitle">${escapeHtml(card.subtitle)}</p>` : ""}
      </div>
      ${card.summary ? `<p class="info-card-summary">${escapeHtml(card.summary)}</p>` : ""}
      ${
        card.facts?.length
          ? `<dl class="info-card-facts">
        ${card.facts
          .map(
            (f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`
          )
          .join("\n")}
      </dl>`
          : ""
      }
    </div>`;
}

// More than this on one printed page and photos get too small to be worth
// looking at (this only forces a page break in print/PDF - on screen the
// gallery still scrolls as one continuous masonry). The featured photo, if
// any, doesn't count against this - it gets its own full-width treatment.
const PHOTOS_PER_PRINTED_PAGE = 6;

function photoGroup(photos, groupKey, stopHeading, strings) {
  if (!photos.length) return "";
  return chunk(photos, PHOTOS_PER_PRINTED_PAGE)
    .map((pagePhotos, ci) => {
      const mosaicId = `mosaic-${groupKey}-${ci}`;
      return `
      <div class="photo-mosaic-page">
        <div class="photo-mosaic" id="${mosaicId}">
          ${pagePhotos.map((p) => photoFigure(p, stopHeading)).join("\n")}
        </div>
        <button class="shuffle-btn no-print" onclick="shuffleMosaic('${mosaicId}')">${strings.shuffleLayout}</button>
      </div>`;
    })
    .join("\n");
}

export function renderStoryHtml(story) {
  const theme = getTheme(story.theme);
  const strings = getStrings(story.contentLanguage);
  const includedByStop = story.stops.map((s) => s.photos.filter((p) => p.included));
  const featuredByStop = includedByStop.map((photos) => photos.find((p) => p.featured));
  const coverPhoto = (featuredByStop.find(Boolean) || includedByStop.flat()[0])?.thumbUrl;
  const located = story.stops.filter((s) => s.lat != null);
  const mapPoints = located.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    label: s.heading,
    index: story.stops.indexOf(s) + 1,
  }));

  const stopsHtml = story.stops
    .map((stop, i) => {
      const featured = featuredByStop[i];
      const gridPhotos = featured
        ? includedByStop[i].filter((p) => p.id !== featured.id)
        : includedByStop[i];

      const cards = stop.infoCards || [];
      const topCards = cards.filter((c) => (c.placement || "top") === "top");
      const middleCards = cards.filter((c) => c.placement === "middle");
      const endCards = cards.filter((c) => c.placement === "end");

      // A "middle" card splits the photo grid in two, so it visually lands
      // partway through the stop's photos rather than always at the top or
      // bottom - each half paginates independently for print.
      const photosHtml = middleCards.length
        ? (() => {
            const mid = Math.ceil(gridPhotos.length / 2);
            return (
              photoGroup(gridPhotos.slice(0, mid), `${i}a`, stop.heading, strings) +
              middleCards.map(infoCardBlock).join("\n") +
              photoGroup(gridPhotos.slice(mid), `${i}b`, stop.heading, strings)
            );
          })()
        : photoGroup(gridPhotos, `${i}`, stop.heading, strings);

      return `
    <section class="stop" id="stop-${i}">
      <div class="stop-head">
        <h2><span class="stop-number">${i + 1}</span>${escapeHtml(stop.heading)}</h2>
        <p class="stop-dates">${dateRange(stop.startedAt, stop.endedAt, strings.dateLocale)}</p>
      </div>
      ${stop.narrative ? `<div class="narrative">${paragraphs(stop.narrative)}</div>` : ""}
      ${stop.pullQuote ? `<blockquote class="pull-quote">${escapeHtml(stop.pullQuote)}</blockquote>` : ""}
      ${topCards.map(infoCardBlock).join("\n")}
      ${
        featured
          ? `<figure class="featured-photo">
        <a class="pswp-item" href="${escapeHtml(featured.fullUrl || featured.thumbUrl)}"
           data-pswp-width="${featured.width || 1600}" data-pswp-height="${featured.height || 1200}"
           target="_blank" rel="noreferrer">
          <img src="${escapeHtml(featured.thumbUrl)}" alt="${escapeHtml(featured.caption || stop.heading)}">
        </a>
        ${featured.caption ? `<figcaption>${escapeHtml(featured.caption)}</figcaption>` : ""}
      </figure>`
          : ""
      }
      ${stop.research ? `<aside class="research"><p>${escapeHtml(stop.research)}</p></aside>` : ""}
      ${(stop.embeds || []).map((e) => embedBlock(e, strings)).join("\n")}
      ${photosHtml}
      ${endCards.map(infoCardBlock).join("\n")}
    </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${story.contentLanguage || "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(story.title)}</title>
<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
<link rel="stylesheet" href="/vendor/photoswipe/photoswipe.css">
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
    --line: ${theme.line};
    --heading-font: ${theme.headingFont};
    --body-font: ${theme.bodyFont};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--body-font);
    line-height: 1.6;
  }
  h1, h2 {
    font-family: var(--heading-font);
    text-transform: ${theme.headingCase};
    letter-spacing: ${theme.headingTracking};
  }
  .hero {
    min-height: 60vh;
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: flex-end;
    color: white;
    position: relative;
  }
  .hero::after {
    content: "";
    position: absolute;
    inset: 0;
    background: ${theme.heroScrim};
  }
  .hero-text {
    position: relative;
    padding: 2.5rem;
    max-width: 900px;
  }
  .hero h1 { font-size: 3rem; margin: 0 0 0.4rem 0; }
  .hero .dates { opacity: 0.9; margin: 0; font-family: var(--body-font); }
  main { max-width: 900px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  .intro, .outro { font-size: 1.15rem; }
  .intro, .outro, .stop-dates, footer { color: var(--ink); opacity: 0.75; }
  #map { height: 420px; border-radius: 10px; margin: 2rem 0; border: 1px solid var(--line); }
  .stop { border-top: 2px solid var(--sand); padding-top: 2rem; margin-top: 2rem; page-break-inside: avoid; }
  .stop-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .stop-head h2 { margin: 0; font-size: 1.8rem; display: flex; align-items: center; gap: 0.6rem; }
  .stop-number {
    display: inline-flex; align-items: center; justify-content: center;
    width: 2rem; height: 2rem; border-radius: 50%; flex: none;
    background: var(--accent); color: var(--paper); font-size: 1rem; font-family: var(--body-font);
  }
  .stop-dates { font-size: 0.95rem; white-space: nowrap; }
  .narrative p { margin: 0.6rem 0; }
  .pull-quote {
    font-family: var(--heading-font);
    font-size: 1.7rem; line-height: 1.35;
    color: var(--accent);
    border: none; margin: 1.4rem 0; padding: 0 0 0 1.2rem;
    border-left: 4px solid var(--accent);
  }
  .research {
    background: var(--sand); border-left: 4px solid var(--accent2);
    padding: 0.9rem 1.1rem; margin: 1rem 0; border-radius: 0 6px 6px 0; font-size: 0.95rem;
  }
  .info-card {
    border: 1px solid var(--line); border-radius: 10px;
    padding: 1.1rem 1.3rem; margin: 1.2rem 0; background: var(--sand); overflow: hidden;
  }
  .info-card-hero {
    display: block; width: calc(100% + 2.6rem); margin: -1.1rem -1.3rem 1rem;
    max-height: 280px; object-fit: cover;
  }
  .info-card-header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  .info-card-header h3 { margin: 0; font-family: var(--heading-font); }
  .info-card-subtitle { margin: 0; font-style: italic; color: var(--accent2); font-size: 0.9rem; }
  .info-card-summary { margin: 0.6rem 0; }
  .info-card-facts {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.7rem 1.2rem; margin: 0.8rem 0 0;
  }
  .info-card-facts div { border-top: 1px solid var(--line); padding-top: 0.35rem; }
  .info-card-facts dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.7; }
  .info-card-facts dd { margin: 0.15rem 0 0; font-weight: bold; }
  .route-embed { margin: 1.2rem 0; }
  .route-embed-title { font-weight: bold; margin: 0 0 0.4rem 0; }
  .route-embed-frame {
    position: relative; width: 100%; padding-top: 65%;
    border-radius: 10px; overflow: hidden; border: 1px solid var(--line);
  }
  .route-embed-frame iframe {
    position: absolute; inset: 0; width: 100%; height: 100%; border: none;
  }
  .route-embed-link {
    display: inline-block; margin: 1.2rem 0; padding: 0.6rem 1rem;
    border: 1px solid var(--accent); border-radius: 8px;
    color: var(--accent); text-decoration: none; font-weight: bold;
  }
  .featured-photo { margin: 1.4rem 0; }
  .featured-photo img {
    width: 100%; max-height: 560px; object-fit: cover; border-radius: 10px; display: block; cursor: zoom-in;
  }
  .featured-photo figcaption { font-size: 0.9rem; opacity: 0.75; margin-top: 0.5rem; }
  .photo-mosaic {
    column-count: 3; column-gap: 0.9rem; margin-top: 1.2rem;
  }
  @media (max-width: 700px) { .photo-mosaic { column-count: 2; } }
  .photo-mosaic figure { margin: 0 0 0.9rem; break-inside: avoid; }
  .photo-mosaic a { display: block; }
  .photo-mosaic img { width: 100%; height: auto; border-radius: 8px; display: block; cursor: zoom-in; }
  .photo-mosaic figcaption { font-size: 0.85rem; opacity: 0.75; margin-top: 0.35rem; }
  .shuffle-btn {
    font: inherit; font-size: 0.85rem; margin-top: 0.8rem;
    padding: 0.35rem 0.9rem; border: 1px solid var(--accent); background: transparent;
    color: var(--accent); border-radius: 999px; cursor: pointer;
  }
  footer { text-align: center; font-size: 0.8rem; padding: 2rem; }
  @media print {
    .hero { min-height: 90vh; break-after: page; }
    #map { break-inside: avoid; }
    .stop { break-before: page; }
    .no-print { display: none; }
    .photo-mosaic { column-count: 3; }
    .photo-mosaic-page { break-after: page; }
    .photo-mosaic-page:last-of-type { break-after: auto; }
    .featured-photo img { max-height: 320px; }
  }
</style>
</head>
<body>
  <div class="hero" ${coverPhoto ? `style="background-image:url('${escapeHtml(coverPhoto)}')"` : ""}>
    <div class="hero-text">
      <h1>${escapeHtml(story.title)}</h1>
      <p class="dates">${tripDateRange(story.stops, strings.dateLocale)}</p>
    </div>
  </div>
  <main>
    ${story.intro ? `<div class="intro">${paragraphs(story.intro)}</div>` : ""}
    ${mapPoints.length ? `<div id="map"></div>` : ""}
    ${stopsHtml}
    ${story.outro ? `<div class="outro">${paragraphs(story.outro)}</div>` : ""}
    <footer>${strings.builtWith(escapeHtml(story.albumTitle))}</footer>
  </main>
  <script src="/vendor/leaflet/leaflet.js"></script>
  <script src="/vendor/photoswipe/umd/photoswipe.umd.min.js"></script>
  <script src="/vendor/photoswipe/umd/photoswipe-lightbox.umd.min.js"></script>
  <script>
    const lightbox = new PhotoSwipeLightbox({
      gallery: 'main',
      children: 'a.pswp-item',
      pswpModule: PhotoSwipe,
    });
    lightbox.init();

    function shuffleMosaic(id) {
      const el = document.getElementById(id);
      const figures = Array.from(el.children);
      for (let i = figures.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [figures[i], figures[j]] = [figures[j], figures[i]];
      }
      figures.forEach((f) => el.appendChild(f));
    }
  </script>
  <script>
    const points = ${JSON.stringify(mapPoints)};
    if (points.length && document.getElementById('map')) {
      const map = L.map('map', { scrollWheelZoom: false });
      L.tileLayer('${theme.mapTiles.url}', {
        attribution: '${theme.mapTiles.attribution}'
      }).addTo(map);
      // Gives each theme its own basemap mood (light/dark/warm) without
      // depending on a keyed tile provider - see the comment above
      // OSM_STANDARD in themes.js for why this replaced per-theme CARTO URLs.
      ${theme.mapFilter ? `map.getPane('tilePane').style.filter = '${theme.mapFilter}';` : ""}
      const latlngs = points.map(p => [p.lat, p.lng]);
      L.polyline(latlngs, { color: '${theme.accent}', weight: 3, dashArray: '6 8' }).addTo(map);
      points.forEach(p => {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'stop-icon',
            html: '<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${theme.accent};color:${theme.paper};font-weight:bold;border:2px solid ${theme.paper};box-shadow:0 1px 4px rgba(0,0,0,.3)">' + p.index + '</span>',
            iconSize: [26, 26],
          })
        }).bindPopup(p.label).addTo(map);
      });
      map.fitBounds(latlngs, { padding: [30, 30] });
    }
  </script>
</body>
</html>`;
}
