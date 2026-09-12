# Story Builder

Turns a PhotoPrism album into an editable travel story: itinerary extraction
from photo GPS/time metadata, a map view, manual + AI-assisted captions, and
export to a shareable web page (later: reveal.js deck, printable PDF/book).

## Architecture

- `server/` — Node/Express API. Talks to PhotoPrism's REST API (read-only,
  no auth needed on this instance), clusters photos into itinerary "stops"
  by time/distance gaps (`server/src/itinerary.js`).
- `web/` — React (Vite) frontend. Album picker, Leaflet map of the
  itinerary, stop list with thumbnails.
- Story content (captions, narrative text) and AI provider integration are
  not built yet — see task list below.

## Running locally

```
npm install
cp server/.env.example server/.env   # set PHOTOPRISM_BASE_URL if it differs
npm run dev --workspace server        # http://localhost:3001
npm run dev --workspace web           # http://localhost:5173 (proxies /api)
```

## Status

- [x] M0 — repo scaffold, PhotoPrism client
- [x] M1 — album browser, itinerary extraction, map + stop list
- [ ] M2 — story content model (SQLite) + manual caption/text editor, so it's
      usable by more than one person without a CLI
- [ ] M3 — AI assist (captions from photos, place research) behind a
      provider-agnostic interface — OpenAI first
- [ ] M4 — render story to a public single-page view, then reveal.js and
      PDF/book export
- [ ] Containerize (Dockerfiles + docker-compose) to run alongside PhotoPrism
      — deferred until the app does more than read-only browsing

## Notes

- PhotoPrism already geocodes photos (`PlaceLabel`/`PlaceCity`) and exposes
  `Lat`/`Lng`/`TakenAt` directly, so the itinerary logic doesn't need to
  touch EXIF itself.
- Itinerary clustering (`buildItinerary`) starts a new stop when there's
  both a >3h time gap and a >2km distance jump between consecutive geotagged
  photos; ungeotagged photos attach to whichever stop their timestamp falls
  into. Tune the constants in `server/src/itinerary.js` if stops come out
  too coarse/fine for road-trip albums.
