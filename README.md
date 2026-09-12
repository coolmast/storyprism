# Story Builder

Turns a PhotoPrism album into an editable travel story: itinerary extraction
from photo GPS/time metadata, a map view, manual + AI-assisted captions, and
export to a shareable single-page web view, a reveal.js presentation, or a
printable PDF (either format).

## Architecture

- `server/` — Node/Express API.
  - Talks to PhotoPrism's REST API (read-only, no auth needed on this
    instance) — `server/src/photoprism.js`.
  - Clusters photos into itinerary "stops" by time/distance gaps —
    `server/src/itinerary.js`.
  - Stores stories (per-stop headings, narrative, pull quotes, per-photo
    captions/order/include/feature flags) in SQLite — `server/src/db.js`,
    `server/src/stories.js`.
  - AI assist behind a provider interface (`server/src/ai/`); OpenAI is
    wired up (vision captioning + web-search-backed place research).
  - Visual identity is themeable (`server/src/themes.js`) — 4 presets
    (palette + font pairing + hero mood + a matching map basemap), selected
    per story and applied as CSS variables + a Google Fonts import at
    render time. Both the web view and the deck read from this one place.
  - Renders a story to a standalone HTML page (`server/src/render.js`,
    served at `/story/:id`) — a CSS-columns masonry gallery (real aspect
    ratios, not cropped squares) with a PhotoSwipe lightbox, a per-stop
    shuffle button, an optional full-width "featured" photo per stop, and
    an optional pull quote.
  - Renders the same content as a reveal.js presentation
    (`server/src/deck.js`, served at `/story/:id/present`) — a title
    slide, then per-stop nested slides (text+quote → featured photo
    full-bleed → photo grids), then an outro. No map here; reveal's
    fixed-size slides don't suit an interactive Leaflet map.
  - Exports both to PDF via headless Chrome (`server/src/pdf.js`): the web
    view at `/api/stories/:id/export/pdf` (cover page, page numbers, 6
    photos/page cap) and the deck at `/api/stories/:id/export/deck-pdf`
    (reveal.js's own built-in print-pdf mode, one slide per page).
- `web/` — React (Vite) frontend: album picker + map (M1), story list +
  editor (M2/M3) with theme picker, drag-to-reorder photo grid, and
  featured-photo/pull-quote controls, links out to view/present/PDF export
  (M4).

## Running locally

```
npm install
cp server/.env.example server/.env   # set PHOTOPRISM_BASE_URL, OPENAI_API_KEY
npm run dev --workspace server        # http://localhost:3001
npm run dev --workspace web           # http://localhost:5173 (proxies /api, /story)
```

Both servers bind to all interfaces, so on the LAN they're also reachable at
this machine's IP (e.g. `http://192.168.42.213:5174` for the frontend) —
useful for a second person to use the editor from their own device.

## Status

- [x] M0 — repo scaffold, PhotoPrism client
- [x] M1 — album browser, itinerary extraction, map + stop list
- [x] M2 — story content model (SQLite) + manual caption/text editor
- [x] M3 — AI assist (photo captions, place research) via OpenAI, behind a
      provider interface so Anthropic (or another provider) can be added
      as a second adapter later without touching the routes/UI
- [x] M4 — single-page story view (`/story/:id`) + PDF export
- [x] Design pass — 4 selectable themes, featured/hero photo per stop,
      pull quotes, PDF cover page + page numbers, PDF pagination capped
      at 6 photos/page
- [x] reveal.js presentation export (`/story/:id/present`) + its own PDF
      export, drag-and-drop photo reordering in the editor, and
      theme-matched map basemaps
- [ ] Containerize (Dockerfiles + docker-compose) to run alongside PhotoPrism
      — deferred until this has been used for real and the deployment shape
      (same host as PhotoPrism? synced elsewhere?) is clearer
- [ ] Table of contents / running chapter markers in the PDF — the cover
      page and page numbers cover the basics; a real TOC needs a
      multi-pass render (page numbers aren't known until the first pass
      completes) and wasn't worth it yet
- [ ] Sharing a story off the PhotoPrism LAN — the view/PDF/deck all embed
      PhotoPrism image URLs directly; taking a story off-network would need
      downloading and re-embedding the images

## Notes

- **Found and fixed a real bug while testing drag-and-drop**: Express's
  default JSON body limit is 100kb, and a story with 100+ photos serializes
  to several hundred KB. Every save from the *actual editor* on a
  realistically-sized story was silently failing with a 413 — the request
  never reached the route handler. Earlier verification during development
  used small hand-crafted API payloads that stayed under the limit, which
  is why this wasn't caught immediately. Fixed by raising the limit to 20mb
  in `index.js`; re-verified with a UI-driven save (theme + heading + pull
  quote + featured caption) confirmed via a fresh API fetch afterward. If
  you ever see edits not sticking, this class of bug (silent server-side
  rejection before your route code runs) is the first thing to suspect —
  check the server log, not just the browser.
- PhotoPrism already geocodes photos (`PlaceLabel`/`PlaceCity`) and exposes
  `Lat`/`Lng`/`TakenAt` directly, so the itinerary logic doesn't need to
  touch EXIF itself.
- Itinerary clustering (`buildItinerary`) starts a new stop when there's
  both a >3h time gap and a >2km distance jump between consecutive geotagged
  photos; ungeotagged photos attach to whichever stop their timestamp falls
  into. Tune the constants in `server/src/itinerary.js` if stops come out
  too coarse/fine for road-trip albums.
- A stop can have 50-100+ photos; creating a story pre-selects a spread of
  ~20 per stop as "included" so the editor starts curated instead of a wall
  of caption boxes. The rest are one click away under "N more photos".
- Gallery images use PhotoPrism's `fit_*` sizes (scaled, real aspect ratio)
  rather than `tile_*` (center-cropped square) — that's what makes the
  masonry layout actually vary instead of showing a uniform grid of crops.
  The lightbox opens `fit_2048` for a sharper full view.
- Drag-to-reorder (`IncludedPhotoGrid.jsx`, using sortablejs with
  `forceFallback: true` for consistent mouse/touch behavior) only reorders
  *included* photos; excluded ones keep their relative order, appended
  after. The new order is written back as each photo's `position` on save.
- Adding a 5th theme is a single new entry in `THEMES` in `themes.js` —
  render.js, deck.js, the editor's theme picker, and the `/api/themes`
  endpoint all read from that one object, nothing else to touch. Each
  theme also picks its own map basemap (OSM standard, or CARTO
  Voyager/Positron/Dark Matter — all free, no API key) to match its mood.
- The PDF caps each printed page at 6 photos (`PHOTOS_PER_PRINTED_PAGE` in
  `render.js`) so they stay a legible size — more than that on an A4 page
  and they get too small to be worth printing. A stop's featured photo
  doesn't count against this cap; it gets its own full-width treatment.
  This only affects print/PDF; the on-screen story view still scrolls as
  one continuous masonry.
- The PDF's cover page is just the hero section forced onto its own page
  in print (`break-after: page`); page numbers come from Chromium's
  print `footerTemplate`, which is why they appear on the cover too —
  Chromium's header/footer templates apply uniformly to every page, there
  is no per-page opt-out.
- The deck's featured-photo slide renders as a plain `<img>`, not
  reveal.js's `data-background-image`: reveal's background layer for
  *nested* (vertical-stack) slides didn't reliably composite under
  Playwright/headless Chrome during testing — it stayed black even though
  every computed style checked out correctly. A real `<img>` element
  sidesteps reveal's separate background-layer system entirely and is more
  robust. The top-level cover slide still uses `data-background-image`
  (confirmed working there) since it isn't nested.
- Photo `alt` text uses the caption when set, falling back to the stop
  heading, in both the web view and the deck.
- Known flakiness in this dev environment (not a code issue per se): the
  backend intermittently crashes with a native-module assertion in
  `better-sqlite3` on startup under this box's Node 24.20.0 build —
  usually recovers after 1-2 restarts. Root-caused one instance of it this
  session to a stray duplicate `server/node_modules/better-sqlite3`
  (left over from before the npm workspace was unified) shadowing the
  correct hoisted copy with a corrupted build; deleting it and reinstalling
  fixed that occurrence. If it recurs, check for stray nested
  `node_modules` before assuming it's the same underlying flakiness.
