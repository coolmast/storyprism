# Story Builder

Turns a PhotoPrism album into an editable travel story: itinerary extraction
from photo GPS/time metadata, a map view, manual + AI-assisted captions,
embedded Strava/Komoot/Garmin routes, an AI ghostwriter that interviews you
and can reorganize your own existing travel writing into the story, and
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
    wired up (vision captioning, web-search-backed place research, and a
    ghostwriter interview - see below).
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
  - A stop can carry route/activity embeds (Strava, Komoot, Garmin Connect)
    — `server/src/embeds.js` allowlists hosts and decides iframe vs. a
    link-out card, stored in the `stop_embeds` table.
  - Long-form travel notes (pasted, or a blog URL fetched and extracted via
    `server/src/article.js`'s Readability-based parser) can be handed to
    the AI, which reads all the story's stops and segments/rewrites the
    notes across the right ones (`organizeNotesIntoStory` in
    `server/src/ai/openaiProvider.js`).
- `web/` — React (Vite) frontend: album picker + map (M1), story list +
  editor (M2/M3) with theme picker, drag-to-reorder photo grid,
  featured-photo/pull-quote controls, a per-stop AI interview panel
  (`InterviewPanel.jsx`), a per-stop route-embed manager
  (`RouteEmbeds.jsx`), and a story-level notes-import panel
  (`NotesImportPanel.jsx`), links out to view/present/PDF export (M4).

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
- [x] AI ghostwriter interview — per-stop chat that asks follow-up
      questions about sensory/emotional detail (how it looked, sounded,
      smelled, felt, what it reminded them of), then drafts a rewritten
      narrative + pull quote suggestion from the conversation on request,
      iteratively (keep chatting, keep re-drafting)
- [x] Route/activity embeds (Strava, Komoot, Garmin Connect) per stop, and
      AI notes import that segments/rewrites your own long-form travel
      writing (pasted or a blog URL) across the right stops
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

- **Route embeds only iframe a URL that is both from an allowlisted host
  (strava.com, komoot.com/.de, garmin.com) and looks like the provider's
  actual embed link** (path or query contains "embed") — enforced
  server-side on save (`isAllowedEmbedHost` in `embeds.js`), not just in
  the UI. A plain activity/tour page URL is shown as a link-out card
  instead of an iframe, because most of those pages refuse to be framed
  (they'd just show blank or an error) — you need the specific "Embed"
  share link the service itself generates. Garmin Connect in particular
  doesn't have as well-known an embed format as Strava/Komoot; if their
  embed doesn't render, the link-out card is the honest fallback.
- **AI notes import will confidently write as if any text you give it is
  your own trip account** — tested it against a Wikipedia article (not a
  travel diary) and it happily produced a plausible-sounding first-person
  narrative from encyclopedia facts. That's expected LLM ghostwriting
  behavior, not a bug, but it means the feature is only as good as what
  you feed it: paste your own actual notes/blog post, not a reference
  page. One consolidated AI call sees all stops + the full notes text at
  once (not one call per stop) so it can match content to the *right*
  stop by place name and chronology and split a rambling multi-day post
  correctly — confirmed with a 3-paragraph test note spanning 3 stops,
  each paragraph landed on the correct one.
- **The ghostwriter interview's conversation is not persisted to the
  story** — it lives only in `InterviewPanel.jsx`'s component state, same
  as the other one-shot AI actions (draft-caption, research). Collapsing
  and reopening the panel within the same session continues where it left
  off; reloading the page starts fresh. This was a deliberate scope call
  to avoid a chat-history schema/migration for a first version — if you
  want the conversation to survive reloads or show up for a second editor
  (your wife), that needs a `stop_interviews` table and load/save wiring,
  not a small change.
- The interview is two separate AI calls by design, not one model deciding
  when to switch modes: `interviewTurn` only ever asks questions,
  `draftFromInterview` only ever synthesizes a rewrite, triggered by an
  explicit "Draft rewrite" button. This keeps the UI deterministic (a chat
  bubble vs. a proposed-rewrite card are rendered differently) instead of
  needing to parse free-form model output to guess which mode it's in.
- The draft prompt explicitly bans a few stock travel-writing phrases
  ("heart swelled", "wrapped around us like an embrace") because the first
  version leaned purple/brochure-y; asking for "plain, concrete detail...
  name the actual thing... rather than reaching for a simile" measurably
  improved it in testing. Worth revisiting if it drifts back that way.
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
