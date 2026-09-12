# Story Builder

Turns a PhotoPrism album into an editable travel story: itinerary extraction
from photo GPS/time metadata, a map view, manual + AI-assisted captions,
embedded Strava/Komoot/Garmin routes, AI-suggested enriched place info cards,
an AI ghostwriter that interviews you and can reorganize your own existing
travel writing into the story, and export to a shareable single-page web
view, a reveal.js presentation, or a printable PDF (either format).

## Architecture

- `server/` — Node/Express API.
  - Talks to PhotoPrism's REST API (read-only, no auth needed on this
    instance) — `server/src/photoprism.js`. A story's source photos can
    come from a manually-curated album, one of PhotoPrism's auto-generated
    "moment" albums (country+year groupings), or an arbitrary date range
    across the whole library (`getPhotosByDateRange`) for a trip that
    doesn't fit either - crossing New Year's (splits across two yearly
    moments) or spanning several countries.
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
    ratios, not cropped squares) with a PhotoSwipe lightbox, an optional
    full-width "featured" photo per stop, and an optional pull quote. The
    per-mosaic shuffle-layout button only appears with `?preview=1` on the
    URL (what the editor's own "View story" link uses) - the plain
    `/story/:id` link, which is what you'd actually hand to family, is a
    finished, static page with no layout controls on it. The editor has
    its own "Copy share link" button so that link is one click away
    without needing to manually strip the query param off the preview URL.
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
  - Each stop can carry optional, AI-suggested "info cards" (place name,
    subtitle, a short summary, and a handful of facts) — candidates come
    from PhotoPrism's own `PlaceLabel`s and auto-generated photo titles
    (`server/src/places.js`, zero extra API calls), or the user can name
    any place manually. Generating one is a web-search-backed AI call
    (`generateInfoCard`) that freely picks whatever facts actually fit the
    place (a national park gets area/flora, a museum gets founded
    year/collection) rather than a fixed schema per place type. Each card
    also has a `placement` (`top`/`middle`/`end` — where it lands relative
    to the stop's photos) and an optional `heroPhotoHash`, picked from the
    stop's photos that matched the same place name/label used to generate
    the card (`getMatchingPhotosForPlace` in `stories.js`, reusing the
    exact place-matching logic from suggestion detection). It also tries
    to find the place's own official website (via the same web search),
    shown as a small icon-only external link next to the place name —
    validated as URL-shaped both when the AI returns it and again on
    save, since it's the one AI-generated field that becomes a clickable
    link. Every field on a generated card — place name, subtitle,
    summary, each fact's label/value, the website URL — is editable
    afterward in `InfoCards.jsx`, not just placement/hero-photo/removal:
    an AI card with one wrong detail should be a quick fix, not a reason
    to regenerate or delete the whole thing. A website URL typed without
    `https://` gets it added automatically on save rather than being
    silently dropped by the same validation that protects against a bad
    link.
  - Internationalization is two independent settings
    (`server/src/i18n.js`): the story's `contentLanguage` (English/German/
    Danish so far) drives everything AI-generated — captions, research,
    interview replies, info cards, notes-import — via a `language` param
    threaded through every provider call, plus the static chrome baked into
    the rendered output itself (dates, the shuffle button, the footer,
    PDF page-number label). It's stored per story and applied at render
    time in `render.js`/`deck.js`/`pdf.js`, entirely separate from the
    UI's own display language.
- `web/` — React (Vite) frontend: album picker + map (M1), story list +
  editor (M2/M3) with theme picker, drag-to-reorder photo grid,
  featured-photo/pull-quote controls, a per-stop AI interview panel
  (`InterviewPanel.jsx`), a per-stop route-embed manager
  (`RouteEmbeds.jsx`), a per-stop info-card manager (`InfoCards.jsx`,
  including the placement selector and hero-photo picker), and a
  story-level notes-import panel (`NotesImportPanel.jsx`), links out to
  view/present/PDF export (M4).
  - UI language is a separate concern from the story's content language:
    `web/src/i18n.jsx` is a small dictionary + React context
    (`LanguageProvider`/`useI18n`) covering every UI string, persisted to
    `localStorage` and defaulting from `navigator.language` when it
    matches a supported code. The content-language picker lives in
    `StoryEditor.jsx` next to the theme picker and is per-story, so (per
    the original ask) the UI can be in English while a story's AI text and
    exported output come out in German.

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
- [x] Enriched place info cards, suggested from PhotoPrism place labels and
      photo titles (free, already-fetched data), generated on request via
      web-search-backed AI with a flexible fact schema per place, with a
      placement choice (right after the heading / mid-gallery / near the
      end) and an optional hero photo picked from matching photos
- [x] Internationalization — UI language (English/German/Danish) and a
      story's content language are independent settings; content language
      drives AI output and the rendered output's own chrome (dates,
      footer, PDF page numbers)
- [x] Two more story sources beyond manually-curated albums: PhotoPrism's
      auto-generated "moment" albums (country+year), and an arbitrary
      custom date range across the whole library for trips that cross
      New Year's or span several countries/moments
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

- **Found a real data-loss bug making info cards editable: `getStory()`
  never sent `heroPhotoHash` back to the client, only the `heroPhotoUrl`
  derived from it.** `updateStory`'s save path reads `heroPhotoHash`
  back from whatever the client sends for each card - since the client
  never had it (only the derived URL), saving *any* stop silently wiped
  the hero photo off *every* info card in it, unless that exact photo
  had just been picked in that same editing session. This was latent
  since the hero-photo feature shipped (nothing before now exercised
  "load a story that already has a hero photo, edit something unrelated,
  save" in one sitting) and became likely to actually bite once cards
  became more editable - more fields to tweak means more saves against
  data loaded earlier. Fixed by returning `heroPhotoHash` alongside
  `heroPhotoUrl`. Reproduced by accident while testing (a real card's
  hero photo vanished after an unrelated save), confirmed the mechanism
  by reading the code, then re-verified with a deliberate repro: edit an
  unrelated field (the story intro), save, check the hero photo is still
  there. It wasn't, before the fix; was, after.
- **The database has no migration framework** (`db.js` is just
  `CREATE TABLE IF NOT EXISTS`, a no-op against an already-created
  table) — that was fine while every schema change happened before any
  real story existed, but stopped being fine once real stories did.
  Adding `stop_info_cards.website_url` while the user already had real
  trip data in the table would have silently broken every info-card
  insert ("no such column") without an actual migration step. Added a
  small `ensureColumn(table, column, definition)` helper in `db.js`
  (checks `PRAGMA table_info`, `ALTER TABLE ... ADD COLUMN` if missing)
  — idempotent, safe to call unconditionally on every startup, and this
  is now the pattern for any future column addition rather than editing
  the `CREATE TABLE` statement and hoping. Verified by checking the
  live database before and after: both real stories and their existing
  info cards were untouched, and the new column appeared with the
  right default for old rows.
- **The web-search tool leaks citations into prose as markdown links**
  if you let it — testing `generateInfoCard` surfaced a summary ending
  in `... 100,000 visitors. ([site.com](https://site.com/...))`, which
  would render as literal, unrendered markdown in the HTML output since
  `escapeHtml` doesn't interpret it. Fixed at the prompt level (told
  explicitly that the summary is prose-only and the separate
  `websiteUrl` field is the only place a link belongs) and again
  defensively server-side (`stripCitations` strips the pattern from
  subtitle/summary/fact text regardless of whether the prompt actually
  worked) — the fact that a documented instruction still needed a
  code-level backstop is the general lesson here, not specific to this
  one field.
- **PhotoPrism has no photo-count for "moment" albums**: manually-curated
  albums (`type=album`) have a real `PhotoCount`, but moments (`type=moment`)
  are a saved search filter (e.g. `country:au year:2019`), not a static
  membership list, so PhotoPrism always reports `PhotoCount: 0` for them.
  Rather than compute a real count (94 moments × a full photo-search
  round-trip just to render the picker isn't worth the latency), the count
  badge is simply omitted for that group in `AlbumList.jsx`.
- **Custom date-range stories aren't backed by any one PhotoPrism album**,
  so `album_uid` is stored as an empty string rather than made nullable -
  the schema has no migration mechanism (`CREATE TABLE IF NOT EXISTS` only),
  and `album_uid` is only ever used to look the source album back up, which
  a date-range story has no reason to do. `album_title`/`title` default to
  `Trip {from} – {to}` unless the user typed one.
- **PhotoPrism's `before` date filter is exclusive**: `before=2022-01-05`
  returns photos up to but not including Jan 5. `getPhotosByDateRange`
  bumps the user's "to" date by one day internally so picking "to: Jan 5"
  in the UI actually includes that whole day - confirmed by querying a
  range spanning New Year's (`after=2021-12-28&before=2022-01-05` vs. the
  bumped `...&before=2022-01-06`) and checking which dates came back.
- **Info card suggestions come from data already fetched, not extra
  PhotoPrism calls**: PhotoPrism's per-photo `PlaceLabel` (bulk list
  response) ranges from broad ("Mölle, Sweden") to specific ("Strandbaden,
  Höganäs, Sweden"), and its auto-generated photo `Title` (also in the bulk
  response) sometimes surfaces a genuinely specific named landmark PhotoPrism
  recognized - confirmed against the real Kullaberg album, where several
  photos are titled "Ladonien" (an actual art installation/micronation on
  the peninsula), distinct from the broader place labels. `places.js`
  merges both sources, dedupes "Höganäs" vs. "Höganäs, Sweden" by taking
  each label's first comma-segment, filters a denylist of ~40 common
  PhotoPrism content labels (Portrait, Outdoor, Landscape, ...), and drops
  single-occurrence candidates when a stop has ≥5 photos. It does **not**
  filter out person names (PhotoPrism sometimes titles a photo after a
  recognized face) - building a reliable person-vs-place classifier wasn't
  worth it for a suggestion the user just ignores if it's clearly a name.
  Checked whether the photo folder Path added anything too (the user's own
  suggestion) - for this library it's just `HandyPeter/2022/06`
  (uploader/date), no place signal, so it wasn't used; worth revisiting for
  a library organized into named folders per place.
- **Info card facts are deliberately schema-free**: the AI is told to
  figure out what kind of place it is and pick 3-5 facts that actually fit
  (verified in testing: a nature reserve got Established/Area/Highest
  Point/Flora/Visitor Center; a micronation/art site got
  Established/Area/Notable Sculptures) rather than forcing every place
  through the same fixed fields. Facts are stored as a JSON blob
  (`stop_info_cards.facts`) rather than a normalized table, since they're
  never queried independently of their card.
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
  theme picks its own map mood via a CSS filter applied to Leaflet's tile
  pane (grayscale, sepia, inverted-for-dark, or none) rather than a
  different tile provider per theme — see the next note for why.
- **CARTO's free basemap tiles now require an API key we don't have**:
  `basemaps.cartocdn.com` (used for the Voyager/Positron/Dark Matter
  basemaps on 3 of the 4 themes) still returns `200 image/png` for
  unauthenticated requests, but with an "API KEY REQUIRED" watermark
  baked into the tile image itself - not an error, so it wasn't obvious
  from the network tab, just a map that looked broken/empty. Found via a
  real user report ("empty frame below the top image"); confirmed by
  actually looking at the rendered map rather than trusting a 200 status.
  Fixed by switching every theme to plain OpenStreetMap tiles (the one
  raster source still reliably free with no key) and faking each theme's
  basemap mood with a CSS `filter` on `map.getPane('tilePane')` instead -
  grayscale for the light/minimal look, sepia for the vintage-postcard
  tint, `invert(1) hue-rotate(180deg)` for a dark-mode look (a standard
  trick for getting a dark basemap out of light OSM tiles). Verified by
  screenshotting the map on all 4 themes after the fix - **but this
  wasn't the bug the user was actually hitting** (see next note); it was
  a real, separate problem found along the way, just not the reported one.
- **The real cause of the "empty frame" report: `web/vite.config.js`'s
  dev proxy never forwarded `/vendor`** (only `/api` and `/story`), so
  Leaflet, PhotoSwipe, and reveal.js's static assets 404'd whenever a
  story/deck was opened at the frontend dev server's own origin - exactly
  what "View story ↗"/"Present ↗" do, and exactly how the user's phone
  reached it. `L` and `PhotoSwipeLightbox` ended up `undefined`,
  throwing early and silently killing map init *and* the photo lightbox,
  with nothing in the rendered HTML to show for it - a totally empty
  box, not even Leaflet's zoom controls or attribution line. The first
  fix attempt (the CARTO note above) genuinely fixed a real bug, but
  missed this one entirely because verification loaded the story page
  directly from the backend (`:3001`), which has no proxy step to skip -
  bypassing the exact failure the user's screenshot showed. Lesson: when
  a report comes from a specific URL/origin, reproduce from that same
  origin, not whichever one happens to be more convenient to hit
  directly. Fixed by adding `'/vendor': 'http://localhost:3001'` to the
  proxy config; confirmed by reproducing the failure first (0 `/vendor`
  requests succeeding, `ReferenceError: L is not defined`) and then
  re-running the identical check clean after the fix.
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
- The deck's info-card slide renders correctly but visibly more compact
  than the main per-stop text slide - confirmed the content and theme
  colors are right, but couldn't get a clean apples-to-apples font-size
  comparison via reveal.js's nested-slide DOM (its "present" class marks
  both the horizontal stack wrapper and the active vertical slide at once,
  which made programmatic measurement unreliable). Worth a follow-up
  design pass if the deck's info-card slide bothers you visually; the web
  view and PDF don't have this issue.
- **Every JSON-returning AI function is told to keep field names in
  English and translate only the values**: without that instruction the
  model translated JSON keys too when asked to respond in German/Danish,
  which would have broken every caller that reads e.g. `card.summary` by
  name. Verified in testing — German output correctly kept `subtitle`/
  `summary`/`facts[].label` as keys while translating their contents (and
  the fact *labels themselves*, e.g. "Established year" → "Gründungsjahr",
  are values, not keys, so they do get translated, which is the point).
- **A slide deck has no real "middle of the scroll"**, so while the web
  view genuinely splits a stop's photo grid in half to slot a `middle`
  card between the two halves (`photoGroup` in `render.js`, reusing the
  existing print-pagination chunking for both halves), the deck
  (`deck.js`) just treats `middle` and `end` cards the same way — both
  land after all of a stop's grid slides. Documented as an intentional
  simplification specific to the deck format, not a bug.
- **`web/src/i18n.jsx` (not `.js`)**: it exports a React context provider
  with JSX in its body, so Vite's rolldown-based build refuses to parse it
  as plain `.js` ("JSX syntax is disabled") — caught immediately by
  running a production build (`npx vite build`) after writing it, before
  any manual testing. Any future i18n-adjacent frontend file that returns
  JSX needs the same `.jsx` extension.
- **Language-picker labels are native endonyms, not translated names**:
  `/api/languages` returns "Deutsch"/"Dansk", not "German"/"Danish" run
  through the current UI language — a language picker conventionally
  shows each option in its own language regardless of UI locale. Kept
  separate from `LANGUAGE_NAMES` (English names) in `server/src/i18n.js`,
  which is still what gets fed into AI prompts ("Respond in German.") —
  AI instruction wording and picker-label wording are different concerns
  that happened to share one lookup table before this split.
- Known flakiness in this dev environment (not a code issue per se): the
  backend intermittently crashes with a native-module assertion in
  `better-sqlite3` on startup under this box's Node 24.20.0 build —
  usually recovers after 1-2 restarts. Root-caused it *twice* this session
  to a stray duplicate `server/node_modules/better-sqlite3` (apparently
  recreated by some `npm install`/`npm rebuild` invocations even after
  being deleted once) shadowing the correct hoisted copy with a corrupted
  build; deleting `server/node_modules` entirely and restarting fixed it
  both times, immediately. If this recurs: `find . -maxdepth 2 -iname
  better-sqlite3 -type d` should show only the root copy — if it shows a
  `server/node_modules` one too, delete `server/node_modules` (not just
  the better-sqlite3 folder inside it) before assuming it's unrelated
  flakiness.
