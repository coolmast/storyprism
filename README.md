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
    (`server/src/pdf.js`, served at `/api/stories/:id/export/pdf`).
- `web/` — React (Vite) frontend: album picker + map (M1), story list +
  editor (M2/M3), links out to the view/PDF export (M4).

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
- [ ] reveal.js deck export — not built; the content model (`getStory`)
      already has everything a slide renderer would need, so this is a
      new template in `server/src/render.js`-style, not a data-model change
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
  ~6 per stop as "included" so the editor starts curated instead of a wall
  of caption boxes. The rest are one click away under "N more photos".
- The story view/PDF embed PhotoPrism thumbnail URLs directly, so they only
  work on the same network as PhotoPrism (or via VPN). Sharing a story with
  someone off-network would need downloading/embedding the images instead —
  not built, since it wasn't needed yet.
- The exported PDF paginates per-browser-print-engine, not per-story-design —
  a stop's last photo can land alone on an otherwise blank page if it
  doesn't fit the row above. Fine for a first cut; a real "book" layout
  would need explicit page-flow logic instead of relying on CSS
  `break-before`.
- Known flakiness in this dev environment (not a code issue per se): the
  backend intermittently crashes with a native-module assertion in
  `better-sqlite3` on startup under this box's Node 24.20.0 build — a
  restart (`npm run dev --workspace server`) always recovers. Worth
  revisiting if it also happens on your normal machine; try Node 20/22 LTS
  if so.
