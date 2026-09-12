# Story Builder

Turns a PhotoPrism album into an editable travel story: itinerary extraction
from photo GPS/time metadata, a map view, manual + AI-assisted captions, and
export to a shareable single-page web view or a printable PDF.

## Architecture

- `server/` — Node/Express API.
  - Talks to PhotoPrism's REST API (read-only, no auth needed on this
    instance) — `server/src/photoprism.js`.
  - Clusters photos into itinerary "stops" by time/distance gaps —
    `server/src/itinerary.js`.
  - Stores stories (per-stop headings, narrative text, per-photo captions
    and include/exclude) in SQLite — `server/src/db.js`, `server/src/stories.js`.
  - AI assist behind a provider interface (`server/src/ai/`); OpenAI is
    wired up (vision captioning + web-search-backed place research).
  - Renders a story to a standalone HTML page (`server/src/render.js`,
    served at `/story/:id`) and to PDF via headless Chrome
    (`server/src/pdf.js`, served at `/api/stories/:id/export/pdf`). The
    page is a CSS-columns masonry gallery (real aspect ratios, not
    cropped squares) with a PhotoSwipe lightbox and a per-stop shuffle
    button to try a different random layout.
  - Visual identity is themeable (`server/src/themes.js`) — 4 presets
    (palette + font pairing + hero mood), selected per story and applied
    as CSS variables + a matching Google Fonts import at render time.
  - Editorial variety per stop: one photo can be marked "featured" and
    renders full-width above the masonry, and a stop can carry an optional
    pull quote rendered in large themed type.
- `web/` — React (Vite) frontend: album picker + map (M1), story list +
  editor (M2/M3), links out to the view/PDF export (M4), theme picker and
  featured-photo/pull-quote controls in the editor.

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
- [ ] reveal.js deck export — not built; the content model (`getStory`)
      already has everything a slide renderer would need, so this is a
      new template in `server/src/render.js`-style, not a data-model change
- [ ] Drag-and-drop manual photo reordering — currently chronological order
      + per-page-load "shuffle" only; a deliberate manual order would need
      a small drag library in the editor and a `position` write-back
- [ ] Map tile style options (currently one OSM style regardless of theme)
- [ ] Containerize (Dockerfiles + docker-compose) to run alongside PhotoPrism
      — deferred until this has been used for real and the deployment shape
      (same host as PhotoPrism? synced elsewhere?) is clearer

## Notes

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
- The story view/PDF embed PhotoPrism thumbnail URLs directly, so they only
  work on the same network as PhotoPrism (or via VPN). Sharing a story with
  someone off-network would need downloading/embedding the images instead —
  not built, since it wasn't needed yet.
- The PDF caps each printed page at 6 photos (`PHOTOS_PER_PRINTED_PAGE` in
  `render.js`) so they stay a legible size — more than that on an A4 page
  and they get too small to be worth printing. A stop's featured photo
  doesn't count against this cap; it gets its own full-width treatment.
  This only affects print/PDF; the on-screen story view still scrolls as
  one continuous masonry.
- Adding a 5th theme is a single new entry in `THEMES` in `themes.js` —
  render.js, the editor's theme picker, and the `/api/themes` endpoint all
  read from that one object, nothing else to touch.
- The PDF's cover page is just the hero section forced onto its own page
  in print (`break-after: page`); page numbers come from Chromium's
  print `footerTemplate`, which is why they appear on the cover too —
  Chromium's header/footer templates apply uniformly to every page, there
  is no per-page opt-out.
- Known flakiness in this dev environment (not a code issue per se): the
  backend intermittently crashes with a native-module assertion in
  `better-sqlite3` on startup under this box's Node 24.20.0 build — a
  restart (`npm run dev --workspace server`) always recovers. Worth
  revisiting if it also happens on your normal machine; try Node 20/22 LTS
  if so.
