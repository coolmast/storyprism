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

function dateRange(start, end) {
  const opts = { day: "numeric", month: "long", year: "numeric" };
  const s = new Date(start).toLocaleDateString("en-GB", opts);
  const e = new Date(end).toLocaleDateString("en-GB", opts);
  return s === e ? s : `${s} &ndash; ${e}`;
}

function tripDateRange(stops) {
  if (stops.length === 0) return "";
  return dateRange(stops[0].startedAt, stops[stops.length - 1].endedAt);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// More than this on one printed page and photos get too small to be worth
// looking at (this only forces a page break in print/PDF - on screen the
// gallery still scrolls as one continuous masonry).
const PHOTOS_PER_PRINTED_PAGE = 6;

export function renderStoryHtml(story) {
  const includedByStop = story.stops.map((s) => s.photos.filter((p) => p.included));
  const coverPhoto = includedByStop.flat()[0]?.thumbUrl;
  const located = story.stops.filter((s) => s.lat != null);
  const mapPoints = located.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    label: s.heading,
    index: story.stops.indexOf(s) + 1,
  }));

  const stopsHtml = story.stops
    .map((stop, i) => {
      const photos = includedByStop[i];
      return `
    <section class="stop" id="stop-${i}">
      <div class="stop-head">
        <h2><span class="stop-number">${i + 1}</span>${escapeHtml(stop.heading)}</h2>
        <p class="stop-dates">${dateRange(stop.startedAt, stop.endedAt)}</p>
      </div>
      ${stop.narrative ? `<div class="narrative">${paragraphs(stop.narrative)}</div>` : ""}
      ${stop.research ? `<aside class="research"><p>${escapeHtml(stop.research)}</p></aside>` : ""}
      ${
        photos.length
          ? chunk(photos, PHOTOS_PER_PRINTED_PAGE)
              .map((pagePhotos, ci) => {
                const mosaicId = `mosaic-${i}-${ci}`;
                return `
      <div class="photo-mosaic-page">
        <div class="photo-mosaic" id="${mosaicId}">
          ${pagePhotos
            .map(
              (p) => `
            <figure>
              <a class="pswp-item" href="${escapeHtml(p.fullUrl || p.thumbUrl)}"
                 data-pswp-width="${p.width || 1600}" data-pswp-height="${p.height || 1200}"
                 target="_blank" rel="noreferrer">
                <img src="${escapeHtml(p.thumbUrl)}" alt="" width="${p.width || ""}" height="${p.height || ""}">
              </a>
              ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}
            </figure>`
            )
            .join("\n")}
        </div>
        <button class="shuffle-btn no-print" onclick="shuffleMosaic('${mosaicId}')">&#128256; Shuffle layout</button>
      </div>`;
              })
              .join("\n")
          : ""
      }
    </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(story.title)}</title>
<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
<link rel="stylesheet" href="/vendor/photoswipe/photoswipe.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #2b2420;
    --paper: #faf6f0;
    --terracotta: #c8703d;
    --teal: #2f6f6a;
    --sand: #e8dcc8;
    --line: #d8cbb5;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: "Source Serif 4", Georgia, serif;
    line-height: 1.6;
  }
  h1, h2 { font-family: "Playfair Display", Georgia, serif; }
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
    background: linear-gradient(to top, rgba(20,15,10,0.85), rgba(20,15,10,0.1) 60%);
  }
  .hero-text {
    position: relative;
    padding: 2.5rem;
    max-width: 900px;
  }
  .hero h1 { font-size: 3rem; margin: 0 0 0.4rem 0; }
  .hero .dates { opacity: 0.9; margin: 0; }
  main { max-width: 900px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  .intro, .outro { font-size: 1.15rem; color: #4a4038; }
  #map { height: 420px; border-radius: 10px; margin: 2rem 0; border: 1px solid var(--line); }
  .stop { border-top: 2px solid var(--sand); padding-top: 2rem; margin-top: 2rem; page-break-inside: avoid; }
  .stop-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .stop-head h2 { margin: 0; font-size: 1.8rem; display: flex; align-items: center; gap: 0.6rem; }
  .stop-number {
    display: inline-flex; align-items: center; justify-content: center;
    width: 2rem; height: 2rem; border-radius: 50%;
    background: var(--terracotta); color: white; font-size: 1rem; font-family: Georgia, serif;
  }
  .stop-dates { color: #6b5d4d; font-size: 0.95rem; white-space: nowrap; }
  .narrative p { margin: 0.6rem 0; }
  .research {
    background: var(--sand); border-left: 4px solid var(--teal);
    padding: 0.9rem 1.1rem; margin: 1rem 0; border-radius: 0 6px 6px 0; font-size: 0.95rem;
  }
  .photo-mosaic {
    column-count: 3; column-gap: 0.9rem; margin-top: 1.2rem;
  }
  @media (max-width: 700px) { .photo-mosaic { column-count: 2; } }
  .photo-mosaic figure { margin: 0 0 0.9rem; break-inside: avoid; }
  .photo-mosaic a { display: block; }
  .photo-mosaic img { width: 100%; height: auto; border-radius: 8px; display: block; cursor: zoom-in; }
  .photo-mosaic figcaption { font-size: 0.85rem; color: #6b5d4d; margin-top: 0.35rem; }
  .shuffle-btn {
    font: inherit; font-size: 0.85rem; margin-top: 0.8rem;
    padding: 0.35rem 0.9rem; border: 1px solid var(--terracotta); background: white;
    color: var(--terracotta); border-radius: 999px; cursor: pointer;
  }
  footer { text-align: center; color: #a1927c; font-size: 0.8rem; padding: 2rem; }
  @media print {
    .hero { min-height: 40vh; }
    #map { break-inside: avoid; }
    .stop { break-before: page; }
    .no-print { display: none; }
    .photo-mosaic { column-count: 3; }
    .photo-mosaic-page { break-after: page; }
    .photo-mosaic-page:last-of-type { break-after: auto; }
  }
</style>
</head>
<body>
  <div class="hero" ${coverPhoto ? `style="background-image:url('${escapeHtml(coverPhoto)}')"` : ""}>
    <div class="hero-text">
      <h1>${escapeHtml(story.title)}</h1>
      <p class="dates">${tripDateRange(story.stops)}</p>
    </div>
  </div>
  <main>
    ${story.intro ? `<div class="intro">${paragraphs(story.intro)}</div>` : ""}
    ${mapPoints.length ? `<div id="map"></div>` : ""}
    ${stopsHtml}
    ${story.outro ? `<div class="outro">${paragraphs(story.outro)}</div>` : ""}
    <footer>${escapeHtml(story.albumTitle)} &middot; built with Story Builder</footer>
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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      const latlngs = points.map(p => [p.lat, p.lng]);
      L.polyline(latlngs, { color: '#c8703d', weight: 3, dashArray: '6 8' }).addTo(map);
      points.forEach(p => {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'stop-icon',
            html: '<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#c8703d;color:#fff;font-weight:bold;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)">' + p.index + '</span>',
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
