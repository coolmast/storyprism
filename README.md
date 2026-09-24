# Story Builder

Turns a PhotoPrism album into an editable travel story: itinerary extraction
from photo GPS/time metadata, a map view, manual + AI-assisted captions,
embedded Strava/Komoot/Garmin routes, AI-suggested enriched place info cards,
an AI ghostwriter that interviews you and can reorganize your own existing
travel writing into the story, and export to a shareable single-page web
view, a reveal.js presentation, or a printable PDF (either format).

## Architecture

- `server/` — Node/Express API.
  - Talks to PhotoPrism's REST API, read-only — `server/src/photoprism.js`.
    Only `PHOTOPRISM_BASE_URL` is required (this project's own instance runs
    with auth off); `PHOTOPRISM_USERNAME`/`PHOTOPRISM_APP_PASSWORD` (or a
    pre-obtained `PHOTOPRISM_API_TOKEN`) let it talk to someone else's
    PhotoPrism that requires login instead, so the same app can be pointed
    at a different instance per deployment purely via `.env` — see
    `server/.env.example`. A story's source photos can come from one or
    several manually-curated albums and/or PhotoPrism auto-generated
    "moment" albums (country+year groupings) at once - merged and
    deduplicated by photo UID before itinerary-clustering, since the same
    photo can easily appear in more than one selected album/moment - or
    from an arbitrary date range across the whole library
    (`getPhotosByDateRange`) for a trip that doesn't fit either - crossing
    New Year's (splits across two yearly moments) or spanning several
    countries.
  - **"Yearbook" mode (`server/src/photoThemes.js`)**: a fourth way to start
    a story, for when the natural grouping for a date range (e.g. a whole
    year) isn't one chronological trip but a mix of recurring themes - "all
    the zoo photos," "every visit to the grandparents regardless of
    location," one whole vacation as its own section. Creating one
    (`createStoryFromThemePlan`) only asks for the book's overall date range
    (and a title) - it starts out completely **empty**, with that range
    remembered as `source_config.from`/`.to`. Every section is cherry-picked
    afterward, one at a time, in the editor's own "Add section" panel
    (`ThemeSectionPanel.jsx`, inside Story settings) rather than picked
    upfront on the creation page - seeing the book actually fill in section
    by section (and being able to stop whenever it's enough) works better
    than committing to a whole plan before seeing any of it. Each click on a
    suggested chip, a hand-typed date sub-range, or a custom search calls
    `POST /api/stories/:id/theme-sections`, which appends that one theme to
    `source_config.themes` and reconciles the story against the new (one
    theme longer) list right away - `addThemeToStory` in
    `server/src/storyUpdate.js`, sharing the exact same `reconcileThemePlan`
    machinery "check for new photos" uses (see below), just called with a
    longer `themes` list instead of the stored one unchanged.
    The panel suggests candidates from data PhotoPrism already computes for
    free: content themes from its Labels ("Zoo", "Dining", "Camping", ...;
    `all=true` is required to see location-derived ones like "Zoo" at all -
    PhotoPrism's default listing hides negative-priority labels), person
    themes from its named Subjects (face recognition - works regardless of
    where/when a photo was taken), and trip themes from a home-distance-based
    clustering (most common rough location = "home"; contiguous-in-time
    photos far from it = a trip) that's independent of the regular per-stop
    itinerary clustering. A trip cluster's title (`tripTitle`) prefers its
    single most-photographed city, but falls back to the cluster's dominant
    *country* (`Intl.DisplayNames`) once no city reaches a real majority - a
    multi-town trip (a road trip, island-hopping) can have one country
    clearly dominate even though no single city does, and titling by raw
    per-city count alone crowns whichever place got the most photos, which is
    easily a transit stop rather than the destination (a three-week Italy
    trip through dozens of towns, that also passed through one Danish ferry
    port, got titled after the ferry port - its own concentrated photo
    burst outnumbered any single Italian town's, even though nearly the
    whole trip was in Italy).
    Alongside the suggested candidates, the panel offers two more ways to add
    a section no suggestion covers: a hand-defined custom date sub-range
    (e.g. "3 days around a birthday in March" - not detected, just a title +
    from/to date typed in, handled identically to a detected trip theme end
    to end, same `type: "trip"` shape and date-range photo lookup, the only
    difference is where the from/to came from), and a free-text PhotoPrism
    search (`type: "query"`, e.g. `person:Anne person:Peter`, or any other
    tag/filter combination PhotoPrism's own search syntax accepts - see
    `getPhotosByQuery` in `photoprism.js`) for a person combination or tag
    that never made it into the suggestions. Candidate discovery only ever
    asks PhotoPrism "does this candidate clear N photos" (`count=N` + the
    `X-Count` response header, which reports how many rows a request
    actually returned, not an independent total - so getting a true "at
    least N" signal means requesting exactly N) rather than fetching full
    photo data for every candidate; a candidate already added to the story
    is filtered out of the panel's suggestions so it can't be added twice.
    A theme's own section is capped at `MAX_THEME_STOP_PHOTOS` (120, evenly
    sampled across the theme's date span) - a popular label or a long trip
    can otherwise match hundreds of photos, and Saal export sends a book's
    entire draft in one request, so an uncapped section risked tripping a
    reverse proxy's request-size limit (see "Exposing the dev server
    through a reverse proxy" below). The overflow isn't dropped, just not
    under that one heading: a photo can also end up in more than one added
    theme (duplicated on purpose - e.g. a beach photo during a vacation can
    be both the trip and a "Beach" theme), and since a cherry-picked book has
    no automatic catch-all otherwise, the panel's own "Add remaining photos"
    button explicitly adds one - a `{type: "leftover"}` pseudo-theme that
    tells `planThemeStops` to also compute the chronological tail (whatever
    no *added* theme has claimed), grouped one section per calendar month
    (`groupLeftoverByMonth` in `stories.js`) rather than the regular flow's
    finer-grained `buildItinerary` clustering, which is tuned for telling
    apart the legs of one trip, not for a whole year - applied across a full
    year of an active family's everyday photos it turned every separate
    outing in the same home city into its own stop (100+ for one real
    range). Unlike the theme-stop cap, this leftover tail is never capped -
    there's no further fallback tier for an overflowing month to land in, so
    capping it would silently drop photos instead of just moving them.
    `getPhotosByDateRange` (and every other photo listing call) pages
    through PhotoPrism's results (`fetchAllPages`) rather than fetching a
    single fixed-size page - PhotoPrism's `count` is a hard per-request
    ceiling it silently truncates to with no error, which one real yearbook
    query surfaced concretely: a busy year has more than 3,000 photos, so
    "oldest 3,000" stopped in April even though a whole-year range had been
    selected, and a trip actually in the truncated tail (each added theme's
    own date span - a spring trip to Italy, in the same real example) never
    appeared as a candidate at all. A story created under the old "pick
    everything upfront" model still works unchanged (view/edit/export/"check
    for new photos"), and also gains the new "Add section" panel as a bonus,
    since it already has `source_type: "theme_plan"` and a non-empty
    `source_config.themes`.
  - **The browser never talks to PhotoPrism directly.** Every photo URL this
    app hands out (`thumbUrl`/`fullUrl` on a story's photos, info-card hero
    photos, ...) is a path on this server, `/api/photo/t/:hash/:size` or
    `/api/photo/dl/:hash`, which fetches the bytes from PhotoPrism itself
    (authenticated the same way as everything else) and streams them back -
    `photoprism.js`'s `fetchThumbBuffer`/`fetchOriginalBuffer`, routed in
    `index.js`. This is what makes exposing this app itself at a public
    domain work while PhotoPrism stays LAN-only, as it should. Code that
    needs actual photo bytes server-side (the Saal photobook export, AI
    captioning, face/object detection) calls those fetch functions directly
    rather than requesting its own proxy URL over HTTP.
  - Clusters photos into itinerary "stops" by time/distance gaps —
    `server/src/itinerary.js`.
  - Stores stories (per-stop headings, narrative, pull quotes, per-photo
    captions/order/include/feature flags) in SQLite — `server/src/db.js`,
    `server/src/stories.js`.
  - **"Check for new photos"** (`server/src/storyUpdate.js`): re-runs the
    query that created a story - the album UID(s), date range, or theme plan
    are persisted at creation as `source_type`/`source_config` specifically
    for this - and merges in whatever now matches PhotoPrism but didn't
    before, almost always photos imported after the story was started but
    still within the same trip's window. Additive only (a photo that no
    longer matches, e.g. removed from an album, is left exactly where it
    is; a photo the user excluded via the include toggle is still "known,"
    so it's never silently re-included), and a stop is only ever touched if
    a new photo actually belongs in it - re-clustering the whole photo set
    from scratch the way creation does would scramble the mapping to
    already-written narrative/heading edits on every *other* stop. A
    chronological story (albums/date range) matches a new photo to an
    existing stop by its taken-at falling inside that stop's
    `[startedAt, endedAt]`; anything left over is clustered on its own
    (`buildItinerary`, the same function creation uses) and spliced in as
    new stops at the right chronological position. A "Nach Themen" story
    matches by `theme_id` instead - a column set on each stop at creation
    time to the id of the theme (or `leftover-YYYY-MM` bucket) that
    produced it - so re-running the exact same theme plan and matching by
    that id gives an equivalent "append new photos to a matched stop,
    insert a stop for a theme that just cleared the photo threshold"
    result. A brand-new stop gets the same curated (not-everything-included)
    pre-selection a freshly-created story's own stops get
    (`curatedIncluded`); a few new photos landing in an *existing* stop are
    simply included, a smaller and different event. Stories from before
    this shipped have an empty `source_type` and just don't get the button.
    The matching/reconciliation logic for a "Nach Themen" story
    (`reconcileThemePlan`) is factored out specifically so the editor's "Add
    section" panel (see "Yearbook" mode above) can call the exact same code
    with one theme appended to the list, instead of duplicating it.
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
  - **The story PDF (`/api/stories/:id/export/pdf`) is a real print-design
    system, not a screenshot of the web view**, modeled on a hand-made
    square photobook. Photo placement is **aspect-ratio aware**
    (`server/src/pdfLayoutEngine.js`): a "guillotine" collage enumerates
    every way to split a page's photos side by side / stacked (in story
    order) and picks the arrangement whose combined aspect ratio best
    matches the page, so each photo is shown at its own proportions instead
    of being cropped into a fixed grid cell; a card layout places 1-3
    shadowed "prints" at native aspect over a full-bleed background photo.
    Page templates (`server/src/pdfTemplates.js`) build on that: background
    + photo cards, mosaic on a blurred backdrop, scattered prints on paper,
    clean gallery grid, dense edge-to-edge mosaic, 2/3 photos + caption,
    adaptive single photo (full-bleed if the shape fits the page, otherwise
    whole photo on a blurred copy of itself), cover collage, opening page
    with a translucent text band, text/chapter page and info-card page.
    Each template has a `fit(photos, pageShape)` score; the planner
    (`server/src/pdfPlanner.js`) chooses template *and* photo count page by
    page from those scores, weighted by the chosen layout pack
    (`server/src/pdfLayoutPacks.js`: Photobook, Classic, Gallery/airy,
    Mosaic/dense — each with its own cover, stop opening, template mix and
    title font; Photobook uses a handwritten font), with variety penalties
    so the same look doesn't repeat. A per-stop manual override pins one
    template. Paper sizes (`server/src/pdfPaperSizes.js`: A4 portrait/
    landscape, US Letter, 21 cm square, 30 cm square) set a real `@page`
    size and the page box; type is in `rem` scaled to the page.
    `server/src/pdfDocument.js` builds the document for the PDF export
    (`server/src/pdf.js`, headless Chrome, `preferCSSPageSize: true`), the
    standalone `GET /story/:id/pdf-preview` and the editor's **live PDF
    preview** (`POST /api/stories/:id/pdf-preview` renders the *unsaved*
    draft; `web/src/PdfLivePreview.jsx` shows it in a side drawer / full
    screen on a phone, re-rendering ~0.5 s after any edit, with pack/paper
    switches and per-stop layout pickers right inside the preview).
  - **Photobook → Saal Design Software** (`server/src/photobook/`): the
    story is planned as a lay-flat *spread* book (`bookPlanner.js`) — cover,
    optional intro, per stop a chapter opener (photo across the spread, story
    on a translucent panel) or a title on the first photo spread, photo
    spreads, info-card spreads, outro, blank padding to the product minimum.
    Spread layouts (`spreadLayouts.js`: background + photo cards, two page
    backgrounds + cards, mosaic on both pages, hero page + gallery, scattered
    prints, full-spread panorama) are chosen per spread *and* per photo count
    by scoring the actual photo shapes, reusing the aspect-true geometry of
    `pdfLayoutEngine.js` — which spread layout wins for a given photo count
    is a weighted competition, and the weights are the book's **layout pack**
    (`bookLayoutPacks.js`; same 4 named packs and ids as the PDF export's own
    `pdfLayoutPacks.js`, but as a weight table over *this* pipeline's spread
    templates rather than a port of the PDF pack's page templates — the two
    pipelines plan different canvases, a lay-flat/glued spread with a fold
    vs. a single printed page, and reusing the existing content-aware
    templates needed no writer changes at all, since `saalSvg.js`/
    `ceweExport.js` only ever read a spread's plain element list, never which
    template produced it). A per-stop layout pin (`bookLayoutOverride`) still
    overrides the pack for that one stop. `saalSvg.js` renders every spread either as Saal's
    own SVG dialect or as a browser preview from the same element list, so
    the editor's live "Photobook" preview (`bookPreview.js`) is exactly what
    gets exported. Export jobs (`bookExport.js`) plan the book once and hand
    it to the chosen product's vendor writer; `exportShared.js` fetches
    originals from PhotoPrism, auto-orients and downscales them (backgrounds
    ≤ 6000 px, prints ≤ 3400 px, HEIC falls back to the 2048 px JPEG).
    `saalExport.js` writes `project.xml` + SVGs and streams a `.sswprm`
    (`sswContainer.js`); `ceweExport.js` writes the same planned spreads as a
    CEWE FOTOWELT `.mcfx`. Products (`products.js`): Saal 28×28 square, A4
    portrait, A4 landscape; CEWE Groß Hardcover (A4 portrait), Groß Panorama
    Hardcover (A4 landscape), XL Hardcover (29×29 square). See "Saal project
    format" and "CEWE project format" below.
  - The deck's own PDF (`/api/stories/:id/export/deck-pdf`, reveal.js's
    built-in print-pdf mode) is unrelated and untouched by the above.
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
  editor (M2/M3) with a theme/content-language/PDF-layout picker (now
  behind a "Story settings" modal, not inline - see below), drag-to-reorder
  photo grid *and* drag-to-reorder sections themselves (same sortablejs
  pattern, a dedicated `.stop-drag-handle` per section so dragging doesn't
  fight the section's own inputs/buttons), featured-photo/pull-quote
  controls, a per-stop AI interview panel (`InterviewPanel.jsx`), a
  per-stop route-embed manager (`RouteEmbeds.jsx`), a per-stop info-card
  manager (`InfoCards.jsx`,
  including the placement selector and hero-photo picker), and a
  story-level notes-import panel (`NotesImportPanel.jsx`), links out to
  view/present/PDF export (M4).
  - UI language is a separate concern from the story's content language:
    `web/src/i18n.jsx` is a small dictionary + React context
    (`LanguageProvider`/`useI18n`) covering every UI string, persisted to
    `localStorage` and defaulting from `navigator.language` when it
    matches a supported code. The content-language picker lives in the
    editor's "Story settings" modal and is per-story, so (per the original
    ask) the UI can be in English while a story's AI text and exported
    output come out in German.
  - Design tokens + dark mode (`web/src/theme.css`): every color/radius/
    shadow this app's own UI uses (not the exported story/deck/PDF output,
    which has its own separate `server/src/themes.js` system) is a CSS
    custom property. Dark mode follows `prefers-color-scheme` by default,
    with a manual System/Light/Dark override (`ThemeToggle.jsx`, a
    `data-theme` attribute on `<html>`, `localStorage`, applied
    synchronously in `index.html` before the stylesheet loads so there's
    no flash of the wrong theme).
  - App shell (`App.jsx`/`App.css`): a fixed sidebar (branding + nav) and
    sticky topbar on desktop, collapsing below 860px into a bottom tab bar
    with the topbar gaining a back button on routes with a parent (the
    editor, back to the library) - one breakpoint for the whole shell.
  - Shared component kit (`web/src/ui/`): Card, StatusPill, Chip,
    SegmentedControl, Toggle, ProgressBar, Modal (native `<dialog>`,
    bottom sheet on mobile / centered on desktop), Toast (+
    `ToastProvider`/`useToast`, `aria-live`), Skeleton, EmptyState,
    ErrorState - used to move rarely-changed settings (theme, content
    language, PDF layout pack/paper size) and export actions (view,
    share link, present, download PDF/slides) out of the editor's
    always-visible toolbar into "Story settings" and "Share & Export"
    modals, and to replace native `confirm()` dialogs (deleting a story,
    removing a section) and ad hoc inline feedback (a toolbar button
    relabeling itself for 2 seconds after copying a link) with Modal/Toast.
  - The New Story album picker groups albums by year (newest first,
    collapsed except the most recent year) rather than one flat
    alphabetical list of every album/PhotoPrism "moment" at once -
    `AlbumList.jsx`. PhotoPrism only fills in `Year` for its own
    auto-generated "moment" albums, so manually-curated albums fall back
    to a year-shaped substring in the title (matches this library's
    "`<Place> <Year>`" naming almost everywhere); anything with neither
    lands in a trailing "No date" group instead of being dropped.

## Saal project format

Reverse-engineered from real projects of Saal Design Software 4.7.378 (no
public documentation exists) and verified by importing generated files into
the real software.

- **Container** (`.sswpm` internal, `.sswprm` export/share): a ZIP64 archive,
  all entries stored uncompressed, with the `PK` magic replaced by `SW` in
  local headers (`SW 03 04`), central directory headers (`SW 01 02`) and the
  ZIP64 end record (`SW 06 06`); locator and classic end record keep `PK`.
  All sizes live in ZIP64 extra fields (central extra = 28 bytes incl. a
  4-byte disk number). Our writer reproduces a Saal-written file byte for
  byte. Import in Saal: *Projekte → Projekt importieren* with a `.sswprm`.
- **`project.xml`**: `<multiProject>` with two `<project>`s — cover (2 pages)
  and inner block (`numPages`) — carrying the product ids (article,
  child article = paper, configurator article, article number), and a
  `<groups>` image list (`imageID`, file name, pixel size of the stored
  file). The export format drops `accountID` and `key`, so projects aren't
  bound to an account. Image ids are 32 hex chars; any unique value works.
- **One SVG per spread** (`<innerUid>/00.svg`, `02.svg`, … = pages 1/2, 3/4,
  …; cover `<coverUid>/0.svg` with `ws:pageType="cover"`), units 0.1 mm,
  spread incl. ~3 mm bleed (square: 5460×2760, A4 portrait 4260×2760, A4
  landscape 5660×1940). Cover width = base + 1 unit per page (spine).
  - photo: `<image>` at full placed size behind a `clipPath` rect (= the
    visible frame), `xlink:href="../images/<imageID>.jpg"`,
    `ws:inBackground="1"` for backgrounds, rotation via
    `transform="rotate(a, frameX, frameY)"`
  - print shadow: `ws:filterType="shadow"` + a fixed filter (offset 17.7,
    75 % black, blur 28.5) on a wrapping `<g>`
  - text: `<image ws:textData="…">` holding an Adobe TLF `<TextFlow>`; Saal
    renders it itself (the referenced PNG doesn't need to exist). Font used
    in the user's books: `Architects DaughterEmbedded`
  - translucent box: a Saal shape `rect` with `ws:color`, `opacity` and a
    rounded-rect `mask`
  - **fonts**: Saal ships each font as an LZMA-compressed Flash SWF
    (`fonts/files/*.sswa`, `ZWS` header) holding `DefineFont4` tags with
    the complete OpenType (CFF) fonts, one per style.
    `tools/extract_saal_fonts.py <Saal fonts/files dir>` extracts them to
    the git-ignored `server/data/saal-fonts/` (they're licensed with Saal);
    `node tools/saal_font_metrics.mjs` turns them into
    `server/src/photobook/bookFonts.json` (Saal family names + per-glyph
    advance widths). Text is sized by simulating line breaks with those
    widths, and the preview renders with the extracted fonts (served at
    `/api/saal-fonts`), falling back to Google Fonts
  - **text metrics** (measured with a calibration import): Saal lays text
    out with a fixed ~44 mm (440 units) inner margin on every side of the
    text element, so element boxes are written 440 units larger than the
    intended text area; a TLF `fontSize` unit renders as 4.15 units (~18 %
    bigger than a point); Architects Daughter averages ~0.59 em per
    character; line height 1.2 em; no paragraph spacing. Only
    `ws:textAreaMode="1"` keeps the box width - without it Saal widens the
    box into a single line off the page
  - **one background per spread**: `ws:inBackground="1"` images are always
    the whole-spread background; page-sized photos must be plain images
  - cover (spine) width isn't validated on import - Saal accepts and fixes
    it - but the page count's `childArticleID` is
- **Page counts are catalog articles.** Every page count of a book is its
  own `childArticleID`; a project whose child article doesn't match its
  `numPages` is rejected on import ("Projekt konnte nicht importiert
  werden", and an "Ungültiges Projekt" entry is left behind). The spine
  grows in steps (square: 64–68 pages → cover 5844, 70–74 → 5854, 76 →
  5864). Both come from projects Saal saved at that count and are kept per
  count in `products.js` (`pageVariants`); books are padded with blank
  spreads to the next known count, and an export needing more pages than
  the largest known count is refused. Found by bisecting ~20 test imports.
- `images/<imageID>.jpg` inside `.sswprm`: Saal stores downscaled working
  copies (median long edge ~2760 px); a 2048 px background shows as "gut",
  2048 px prints as "sehr gut".

## CEWE project format

Reverse-engineered from projects CEWE FOTOWELT 8.1.3 wrote (a near-empty
book, a filled one, and resaves at 26/46/86/202 pages) plus two generated
probes that the real software opened without complaint.

- **Container** (`.mcfx`): a plain SQLite database (`application_id`
  0x43455745, "CEWE") with one table
  `Files(Filename TEXT PRIMARY KEY, Data BLOB, LastModified INTEGER)`. It
  holds `data.mcf` (the project XML), `folderid.xml` (the project's folder
  UUID, same as the XML's `folderID`) and every photo as its own row.
  CEWE pads `data.mcf` with `0xFB` to a 4 MB block and keeps an empty
  padded `data.mcf~` backup slot - neither is required (the unpadded probe
  opened identically), and the software adds them itself on the next save.
- **XML** (`<fotobook>`): product via `art_id` + `productname` +
  URL-encoded `article_name`; `<articleConfig normalpages totalpages>`
  (`totalpages` = inner pages + 5). Page elements in order: back+front
  cover (`fullcover`, holds all cover areas), `spine`, the other
  `fullcover`, `emptypage` (inside front cover, left of page 1),
  `normalpage` 1..N, `emptypage`. Every page element's `bundlesize` is its
  whole sheet (the cover wrap, or a double page); a spread's areas all live
  on its *left* page's element, with the right page's element left empty.
- **Geometry**: 0.1 mm, origin at the trimmed top-left of the sheet (bleed
  is negative / beyond the size). An area is `<position left top width
  height rotation>`; rotation is in degrees clockwise around the area's
  center (the planner rotates around the top-left corner, so `ceweExport.js`
  moves the box accordingly). Photos: `<image filename="safecontainer:/<row
  name>"><cutout left top scale/>` - the image, scaled by `scale` (0.1 mm per
  pixel), is placed at area origin + `cutout.left/top` and clipped to the
  area, i.e. exactly the planner's `placePhoto()` cover-fit.
- **Text**: Qt rich text HTML (in CDATA or escaped), font sizes in pt -
  the planner's size unit × 4.15 / 3.528. CEWE only prints fonts on its
  `fonts-mac.xml` "good" list (plus its bundled ones) and substitutes
  anything else with a warning on open, so CEWE books are planned with
  their own font set: 16 macOS system fonts on that list
  (`ceweFonts.json`), measured from the real font files by
  `tools/cewe_font_metrics.mjs` (widths + natural line spacing; only the
  numbers are committed). For a CEWE product the font pickers offer these,
  and a Saal font chosen earlier maps to its closest CEWE counterpart (and
  back). CEWE's line height is a percentage of the font's natural line
  spacing, so each paragraph gets `1.2 em / lineSpacing` to land on the
  planner's 1.2 em pitch (e.g. Cochin 105 %, Futura 90 %).
- **Effects**: drop shadow is `<decoration><shadow …/></decoration>` (CEWE's
  own preset reused verbatim). Transparency has no XML attribute - CEWE
  bakes it into an RGBA PNG row - so translucent panels are exported as a
  solid RGBA PNG covering the panel's frame at 150 dpi (a smaller one trips
  CEWE's print-resolution warning even though it's a flat color).
- **Products** come from CEWE's article catalog (`products-<n>.xml` in the
  app's data folder): per article, page and cover size, bleed (3 mm inner,
  10 mm cover), page range (26–202, step 4) and spine parameters. Spine
  width = `base_width` + ⌊(pages − 26) / 16⌋ × `block_width` (7.5 +
  n × 1.249 mm for the three Hardcover Matt books used here) - matches the
  cover widths CEWE wrote at 26/46/86/202 pages to the 0.1 mm. The cover
  `bundlesize` must be a whole number (rounded): a fractional one (e.g.
  5599.98 at 58–73 pages, two spine blocks) makes CEWE discard the whole
  cover on open and later crash in its order check
  (`CWRegionMath::detectInnerPageRect`, null page rect). The cover
  sheet is back + spine + front, with the spine centered. Unlike Saal the
  books are glued, not lay-flat: page 1 is a single right page and the last
  page a single left page (both left blank), the spreads are 2–3 … (N−2)–(N−1).

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

### UI smoke test

With both servers running, `npm run smoke-test --workspace server` drives
the editor app end-to-end in headless Chrome (nav switching, the theme
toggle + its persistence across a reload, the album year-group accordion,
the Settings/Share & Export/delete/remove-section modals) at both the
desktop and mobile breakpoints, and asserts no console errors and no
horizontal overflow throughout. It creates one disposable story from
whichever real album has the fewest photos and deletes it again when done
(`server/scripts/ui-smoke-test.mjs`). Override the URLs it targets with
`SMOKE_FRONTEND_URL`/`SMOKE_BACKEND_URL` if either isn't on its default port
(Vite picks the next free port starting at 5173, so this is common when
something else is already running).

### Exposing the dev server through a reverse proxy

`npm run dev --workspace web` (what's actually run in production too, so
far - there's no separate `vite build` + static-serve step yet) runs Vite's
dev server, which rejects any request whose `Host` header it doesn't
recognize as localhost/a LAN address - a security feature, not a bug, that
otherwise blocks it being reached at all under a real domain
(`story.sensing-the-world.de` in this project's own deployment, behind mTLS
+ Authentik forward-auth). Allow it explicitly:

```
cp web/.env.example web/.env
echo "ALLOWED_HOSTS=story.example.com" >> web/.env
```

(`web/vite.config.js` reads `ALLOWED_HOSTS` via `loadEnv`; comma-separate
for more than one.) Restart the dev server after changing it - Vite doesn't
pick up `server.allowedHosts` changes on the fly.

A reverse proxy in front of this app also needs a generous request body-size
limit: the Saal book export and the PDF export both send the editor's entire
draft (every stop, every photo's metadata) in one request, and a large
"Yearbook" mode story (a full year, several theme sections) can be a few
megabytes even after capping individual theme sections - comfortably under
this app's own `express.json({ limit: "20mb" })` in `index.js`, but over a
typical reverse proxy default (nginx's `client_max_body_size` defaults to
1MB, which surfaces as an opaque "413 Request Entity Too Large" HTML page
from nginx itself, not from this app). Raise it to match, e.g.
`client_max_body_size 20m;`.

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
- [x] Manual control over the automatic itinerary clustering — split a
      stop into two at any photo, add a blank section anywhere, or remove
      one entirely, for when the time/distance clustering didn't group
      things the way the trip actually happened
- [x] A stop with everything removed from it (no photos, no narrative,
      no pull quote, no research, no embeds, no info cards) no longer
      renders as a dead heading on the finished page/deck
- [x] 10 themes (was 4) — added Ocean Blue, Midnight, Sunset, Sunrise,
      Adventure, and Nordic Mist; also re-differentiated Vintage Postcard
      from Coastal, which had ended up sharing a heading font and a very
      similar palette
- [ ] Containerize (Dockerfiles + docker-compose) to run alongside PhotoPrism
      — deferred until this has been used for real and the deployment shape
      (same host as PhotoPrism? synced elsewhere?) is clearer
- [x] Rebuilt the PDF export as a real print-design system: 8 page
      templates, 3 layout packs, 4 paper sizes/aspect ratios, automatic
      page-planning with a per-stop manual override, and a live
      `/pdf-preview` route for iterating on templates without generating an
      actual PDF each time — see the Architecture section above
- [x] PDF v3, photobook style: aspect-ratio-aware layout engine (no more
      landscape photos cropped into portrait cells), background + photo
      card / blurred-mosaic / scattered-prints templates, 4 clearly
      different packs (Photobook is the new default for new stories), 30 cm
      square paper, and a live PDF preview drawer in the editor that
      renders the unsaved draft
- [x] Photobook pipeline → Saal Design Software: spread-based book planner
      modeled on the user's own Saal books, live "Photobook" preview tab in
      the editor (product choice, per-stop spread layout override), and a
      one-click `.sswprm` export with all photos in print resolution that
      imports into Saal and stays fully editable there. Square 28×28, A4
      portrait and A4 landscape products
- [x] Per-spread pacing in the Photobook preview: − / + on every photo
      spread sets how many photos it holds (spreads before it keep their
      current counts and get pinned 📌, the rest of the stop re-paces
      automatically; "↺ Auto" per stop resets). Stored per stop as
      `stops.book_spread_counts` (JSON array), up to 10 photos per spread
      (max 6 per page)
- [x] Content-aware photobook layouts: per-photo insights (face boxes,
      labels, capture time, quality) from PhotoPrism, with our own YuNet
      face detector (`server/src/faceDetect.js`, onnxruntime) for photos
      PhotoPrism has no markers for (it found faces in 18 of 104 photos of
      the test story; with the detector 51); cached in `photo_insights`.
      Backgrounds prefer face-free scenery (labels), card arrangements /
      chapter panels / titles are chosen to cover the least face area, crops
      center on faces, and burst shots (≤ 3 s apart) are reduced to the
      best one (toggle "keep burst shots"). Test story: backgrounds with
      faces 21 → 5, covered faces 5 → 0, 11 burst shots dropped
- [x] Importance maps instead of face boxes (`server/src/photoAnalysis.js`):
      faces (+ the body below them), NanoDet-Plus object detection (people
      also from behind, animals, vehicles; run on the whole photo and on two
      overlapping halves so small people are found) and frequency-tuned
      saliency (the sun, a red jacket on grey rock) combine into a 24x24
      grid per photo. Card arrangements, chapter panels and titles minimize
      covered importance plus a margin term (so cards don't crowd people),
      faces weigh 4x, layouts whose best arrangement still covers something
      score lower, and face-free photos are cropped around their main
      subject. Test story vs. no content awareness: faces covered 5 -> 0,
      people covered 14 -> 0, covered importance 17.6 % -> 2.2 %
- [x] Info cards as a fact sheet: name, italic subtitle, accent rule,
      summary, facts in two balanced columns (uppercase label over bold
      value), website domain; shrinks as a whole to fit
- [x] Book text controls: heading/text size (80-160 %, per story);
      intro, each stop's story text, each info card and the outro can be
      removed from the book and re-added right in the preview (stored as
      flags on the story/stop/card; info card ids now survive saves); info
      cards grow into free space (up to 140 %, ~72 % of the page) and only
      shrink when needed; cover band and title boxes sized from measured
      text
- [ ] Nice-to-have: people names from face markers for captions; retakes
      minutes apart (perceptual hashes) - low priority per user
- [ ] More Saal fonts: only `Architects DaughterEmbedded` is confirmed to
      exist in Saal, so body text uses it too. Reading any other font name
      from a Saal project would unlock a separate body font
- [ ] Only some page counts are known (square 28×28: 64, 68, 70, 72, 74,
      76; A4 portrait/landscape: 30). Each further count needs its
      `childArticleID` + cover width from a project Saal saved at that count
      (or from Saal's local product catalog, if it can be found)
- [ ] Per-page control in the live preview (e.g. "shuffle this page",
      choose the background photo, move a photo to the next page) — today
      control is per stop (layout override) plus photo order/featured
- [ ] Page numbers and a table of contents in the PDF (user feedback: not
      missed so far, no page numbers looks cleaner) — the old pipeline
      had page numbers via Chromium's header/footer templates, but those
      need a page margin to render into, which conflicts with the new
      templates' full-bleed photo pages (zero `@page` margin). Dropped for
      now; worth a per-template opt-in (only the text-heavy templates
      reserve footer space) if this is missed in practice. A real TOC
      still needs a multi-pass render regardless (page numbers aren't
      known until the first pass completes)
- [ ] The PDF pipeline embeds full-resolution (`fit_2048`) photos on
      every page - a full story PDF is routinely 80-120MB (the photobook
      pack's blurred backdrops are rasterized by Chromium at print
      resolution, which adds to it even though they load the small
      thumbnails). A post-processing pass (Ghostscript/qpdf image
      recompression) is probably the real fix. Worth trying a smaller size (`fit_1600`?) now that there
      are dedicated full-bleed single-photo templates that would show the
      difference most, but wasn't tested this pass
- [x] Sharing a story off the PhotoPrism LAN: the view/PDF/deck/photobook
      used to embed PhotoPrism image URLs directly, so a client outside
      PhotoPrism's own network (this app's own domain,
      story.sensing-the-world.de, reached from outside via mTLS + Authentik
      forward-auth) couldn't load a single photo even though the app itself
      was reachable. Every photo URL sent to a browser is now a path on
      this server instead (`/api/photo/t/:hash/:size`,
      `/api/photo/dl/:hash`), which fetches from PhotoPrism server-side and
      streams the bytes back - see `photoprism.js`/`index.js`. PhotoPrism
      itself never needs to be reachable from outside its own LAN
- [x] Vite's dev server (what's actually run in production so far, not a
      `vite build`) rejects a `Host` header it doesn't recognize - exposing
      it under a real domain via a reverse proxy needs that domain
      allow-listed via `ALLOWED_HOSTS` in `web/.env` (`vite.config.js`,
      loaded with `loadEnv`) - see "Running locally" above
- [ ] PhotoPrism login (`PHOTOPRISM_USERNAME`/`PHOTOPRISM_APP_PASSWORD`) is
      written against PhotoPrism's documented `/api/v1/session` request
      shape but untested against a real password-protected instance (this
      project's own PhotoPrism runs with auth off) - the response field
      names it reads (`id`/`session_id`/`access_token`/`token`) and the
      request headers it sends (`Authorization: Bearer`, `X-Session-ID`)
      cover what's documented across PhotoPrism versions, but worth
      verifying against whichever version a real login-required instance
      turns out to run
- [x] Editor app UI overhaul: design tokens + dark mode, a responsive
      sidebar/topbar-on-desktop + bottom-tab-bar-on-mobile app shell, a
      shared component kit (Card/StatusPill/Chip/SegmentedControl/Toggle/
      ProgressBar/Modal/Toast/Skeleton/EmptyState/ErrorState), and using
      it to move the editor's rarely-touched settings and export actions
      into modals instead of an always-visible wall of buttons/pickers -
      see the Architecture section above. In progress; further
      decluttering of the New Story/Library screens and an accessibility
      pass may follow
- [x] Album picker grouped by year (newest first, collapsed except the
      current year) instead of one flat alphabetical list of every
      album/moment
- [x] Info card hero-photo picker falls back to every photo in the section
      when a manually-typed place name (as opposed to one picked from a
      suggestion chip) doesn't exactly match any photo's place metadata -
      previously left the picker permanently empty for any manually-added
      card
- [x] UI smoke test (`npm run smoke-test --workspace server`) - see
      "Running locally" above
- [x] Multi-select album/moment picker for a new story: pick any number of
      albums and/or moments (a checkbox per row, not exclusive selection),
      merged and deduplicated by photo UID into one itinerary before
      clustering. `POST /api/stories` takes `albumUids` (an array, replacing
      the old singular `albumUid`) and defaults an unselected title to the
      selected albums' titles joined with " + "
- [x] "Yearbook" mode: a new "Nach Themen" source alongside album/date-range
      for a story organized by recurring theme instead of chronology - pick
      a date range, get suggested content/person/trip candidates from
      PhotoPrism's own Labels/Subjects plus a home-distance trip detector,
      pick any mix, and get one section per chosen theme (photos duplicated
      across an overlap on purpose) followed by a normal chronological tail
      for everything else, plus any number of hand-defined custom date
      sub-ranges (a title + from/to date, e.g. "3 days around a birthday")
      alongside the suggested candidates, and a live map/stop-list preview
      that updates as themes are picked - matching the preview the other
      two sources already had. See the Architecture section above
      (`server/src/photoThemes.js`)
- [x] Drag-to-reorder for sections themselves, not just the photos inside
      one - a `.stop-drag-handle` per section, same sortablejs pattern as
      the photo grid
- [x] Fixed three "Yearbook" mode bugs a real full-year story hit at once:
      photo listing silently truncated to a single fixed-size page (a busy
      year has more than PhotoPrism's per-request cap, so a whole-year range
      only ever covered its earliest ~3,000 photos - through April, not
      September, and a real spring trip candidate in the truncated tail
      never showed up); trip-cluster titles picked by raw per-city photo
      count, mistitling a multi-town trip after a transit stop that
      happened to have a concentrated photo burst; and Saal export sending
      an uncapped theme section (hundreds of photos matching one popular
      label) tripped a reverse proxy's request-size limit. Fixed via proper
      pagination (`fetchAllPages`), a country-level title fallback
      (`tripTitle`), and a per-theme-section photo cap with overflow
      falling through to a monthly-grouped leftover tail - see the
      Architecture section above and "Exposing the dev server through a
      reverse proxy" for the remaining reverse-proxy-side config a very
      large yearbook may still need
- [x] CEWE FOTOWELT export (`.mcfx`) for the three formats matching the
      Saal ones, picked from the same product list (grouped by vendor) and
      planned by the same layout engine. Verified in CEWE Fotowelt 8.1.3 with
      a full generated book: cover, spreads, drop shadows, full-bleed
      photos and translucent text panels as planned, fonts mapped to
      CEWE-printable ones (no substitution warning), no crash
- [x] The Saal/CEWE photobook picked up the PDF export's 4 named layout
      packs (Photobook/Classic/Gallery/Mosaic) — same picker, same ids,
      now next to the product picker in the "Photobook" preview tab.
      `bookLayoutPacks.js` reuses `spreadLayouts.js`'s existing 6 templates
      with a different weight table per pack rather than porting the PDF
      pipeline's own page templates, so no vendor-writer changes were
      needed. A per-stop layout pin still wins over the story's pack
- [x] "Check for new photos" (`storyUpdate.js`) - re-runs a story's original
      album/date-range/theme-plan query and merges in anything imported to
      PhotoPrism since, without touching any stop nothing new landed in.
      Verified against disposable copies of real data (never the real
      stories): photos deleted from an existing stop reappear there, an
      entire deleted stop is correctly re-clustered and re-inserted at its
      right chronological position, and the same two cases for a "Nach
      Themen" story via `theme_id` matching (an existing theme stop, and a
      leftover month that previously had no photos at all). Stories from
      before this shipped have no stored source and don't show the button
- [x] A photo can be dragged straight into a *different* section's grid, not
      just reordered within one (`IncludedPhotoGrid.jsx` sharing one
      sortablejs `group` across every stop) - the fix for a photo whose EXIF
      timestamp is off enough that automatic clustering put it in the wrong
      stop entirely. Caught and fixed a real sortablejs+React crash along
      the way (only reproducible via an actual browser drag, not a same-list
      one): see "A photo can also be dragged straight into a *different*
      section's grid" below for the fix and how it's smoke-tested
- [x] Reworked "Nach Themen" creation from "pick every theme upfront, create
      a fully-populated book in one step" to "set the book's overall date
      range, start empty, cherry-pick sections one at a time in the editor."
      The New Story page (`ThemeStoryPicker.jsx`) is now just a title +
      from/to date picker; everything that used to live there (suggested
      theme chips, the custom date sub-range form, the live preview) moved
      into a new "Add section" panel in the editor's Story settings
      (`ThemeSectionPanel.jsx`), which also gained a free-text PhotoPrism
      search box (`type: "query"` - any search PhotoPrism's own syntax
      accepts, e.g. `person:Anne person:Peter`, for a person combination or
      tag no suggestion covers) and an explicit "Add remaining photos (by
      month)" button, replacing the old always-on chronological catch-all
      now that a cherry-picked book has no automatic one. Every "add"
      appends one theme to `source_config.themes` and reconciles
      immediately via the same `reconcileThemePlan` "check for new photos"
      already used (`addThemeToStory`, `storyUpdate.js`) - no separate
      preview/create step, and a story from before this shipped gains the
      new panel as a bonus once it's opened. `POST /api/theme-plan-preview`
      (the old creation-time live preview) was removed as dead code along
      with it. Verified end to end via disposable test stories (both a
      fresh empty book and an old-style pre-populated one) and the UI smoke
      test, which now drives this flow through the browser instead of the
      old one-step creation
- [x] A collapsed section can be removed directly (a trash-icon button next
      to its summary row, `StoryEditor.jsx`) - previously the remove control
      only existed in the expanded header, so removing one meant expanding
      it first
- [x] Editor photo grid: row-first flow (reading order) instead of CSS
      columns' column-first flow, and every card the same size - a
      `.photo-frame` fixed-aspect box per photo with `object-fit: contain`,
      so a portrait photo gets letterboxed rather than cropped or leaving a
      lopsided masonry (`IncludedPhotoGrid.jsx`/`App.css`)
- [x] Route embeds reworked to actually handle what Komoot/Strava hand out
      today, not just a plain `<iframe>` `src=`: Komoot's plain share link,
      `<iframe>` snippet, and `<a><img></a>` snippet all now work as pasted
      (re-derived into a canonical embed URL - see `embeds.js`), and
      Strava's current div+widget-script embed mechanism (its old
      iframe-able embed link no longer allows framing) is supported for the
      first time. See "Route embeds" further down for the mechanism per
      provider
- [x] Photobook: a route embed with a derivable static map image (Komoot's
      `image=1` endpoint) gets its own spread - the map contain-fit (not
      cropped) on one page, a few of the stop's own photos on the other so
      it doesn't read as an oddly empty page (`routeMapSpread` in
      `spreadLayouts.js`, wired into `bookPlanner.js`). The photos come out
      of that stop's normal photo pool first, so they don't also repeat in
      a later grid spread. Verified against both the Saal and CEWE export
      pipelines (a disposable story's real export, not just the preview) -
      `exportShared.js` fetches a non-PhotoPrism image directly
      (`photo.externalUrl`) the same way it fetches a PhotoPrism photo
- [x] Resolution-aware photobook layout: a low-res photo (PhotoPrism's own
      width/height metadata, below ~3 effective megapixels) is scored down
      sharply as a candidate for any full-bleed/full-spread/hero placement
      (`resolutionFitness` in `pdfLayoutEngine.js`, folded into
      `backdropScore`/`pickBackdrop`/the `panorama` layout's own background
      pick) rather than disqualified outright - it's still perfectly fine
      in a small multi-photo grid frame, which is where this pushes it
      instead. Verified by artificially downsizing one photo's reported
      resolution in an otherwise-identical group and confirming the chapter
      spread's chosen backdrop changed to a different, full-res photo

## Notes

- The book export and preview take the editor's *draft* (like the PDF live
  preview), so unsaved layout choices are exported exactly as previewed.
- `better-sqlite3` had to move to v12: installing `sharp` made npm fetch a
  v11 prebuilt binary that aborts the process on Node 24 whenever a
  prepared statement is garbage-collected
  (`RemoveEnvironmentCleanupHook … Assertion failed`).
- `SAAL_IMAGE_URL_BASE` (server `.env`) sets the local Saal library path
  recorded per photo in `project.xml`; real projects always carry one.

- **Two photo-and-caption templates (`duo-caption`, `photo-strip`) were
  wasting nearly half the page as blank white space** whenever the
  specific photos assigned to that page didn't happen to have a caption
  set - caught immediately by actually looking at rendered screenshots
  rather than trusting the code once it ran without errors. Captions are
  optional per photo, so "these particular 2 or 3 photos have none" is the
  common case, not an edge case. Fixed by having the template itself
  detect empty content and collapse its text zone to zero height via a
  `pdf-notext` modifier class, letting the photos expand to fill the page
  instead - the honest fallback is "this becomes a full-bleed photo
  layout," not "half the page is empty."
- **The per-stop manual-override `<select>` only offers templates with
  `photoSlots.min > 0`** — excluding `hero-pullquote`/`text-chapter`
  (opening-page-only, capacity 0) and `info-card-page` (renders an info
  card's fields, not raw photos). Turned out this didn't even need a
  server-side guard: `chunkPhotosWithPack`'s own candidate filter already
  requires `min > 0`, so a stray/manually-crafted override value outside
  that set just falls through to its existing `single-full-bleed` fallback
  rather than crashing - confirmed by tracing the fallback logic rather
  than assuming a client-side filter was the only thing preventing a
  runtime error accessing `card.placeName` on an undefined `infoCard`.
- **A featured photo (or narrative/pull quote) always gets its own opening
  page, independent of a stop's manual template override** - the override
  only steers the *rest* of the stop's photos. Otherwise pinning a stop to
  e.g. "4-Photo Grid" would have silently discarded whatever the user
  wrote for that stop, since none of the photo-grid templates have a text
  zone. Never let a layout choice silently drop content the user wrote.
- **The print-specific CSS this replaced (`@media print` in `render.js`)
  turned out to share a home with code that's still very much alive**:
  `PHOTOS_PER_PRINTED_PAGE`/`photoGroup()`'s chunking-into-groups-of-6 was
  originally written for both print pagination and the on-screen
  "each group gets its own shuffle button" feature - only the print half
  was dead after this rewrite. Renamed to `PHOTOS_PER_SHUFFLE_GROUP` and
  kept; only the actual `@media print` block and the now-pointless
  `no-print` class on the shuffle button were removed.
- **Splitting/adding sections needed `stops` to become upsertable, which
  they never were.** `updateStopStmt` was a plain `UPDATE ... WHERE id =
  @id`, silently affecting 0 rows for a client-generated stop id that
  doesn't exist in the database yet - fine as long as the editor could only
  ever edit stops that already existed, which stopped being true once it
  could create new ones (splitting a stop, adding a blank section).
  Replaced with `INSERT ... ON CONFLICT(id) DO UPDATE`, and added pruning
  (delete any stop for the story not present in the incoming array, guarded
  on a non-empty array so a bad payload can't wipe every stop) to support
  removing a section too. The same problem existed one level down:
  `updatePhotoStmt` matched `WHERE id = @id AND stop_id = @stopId`, so
  moving a photo to a different stop (exactly what a split does) would
  silently fail to move it, since the row's *current* stop_id never
  matched the *new* one being requested - fixed by matching on `id` alone
  (a photo's id is already globally unique) and moving `stop_id` into the
  `SET` clause.
- **A split can't recompute an accurate date range or map position for the
  new stop** - per-photo timestamp/GPS data is only used transiently while
  clustering the itinerary in `itinerary.js` and isn't persisted to
  `stop_photos` afterward, so there's nothing to recompute *from* once a
  story exists. The split half just inherits the original stop's dates/
  location as an approximation; the user can correct it, same as any other
  field. Worth persisting per-photo taken-at/lat/lng if this ever needs to
  be exact (e.g. an "auto re-split by time gap" feature).
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
- **Route embeds only ever render something for a URL from an allowlisted
  host** (strava.com, komoot.com/.de, garmin.com) — enforced server-side on
  save (`isAllowedEmbedHost` in `embeds.js`), not just in the UI. What
  actually renders depends on the provider (`embedKind` in `embeds.js`):
  - **Komoot**: any of the three things Komoot itself calls a "share" link
    works as pasted - the plain tour-page link, the whole `<iframe>` embed
    snippet, or the whole `<a><img></a>` embed snippet - `extractEmbedUrl`
    pulls the actual link out of a pasted snippet, and `komootEmbedUrl`
    re-derives a fresh, canonical `.../tour/:id/embed?share_token=...` URL
    from the tour id + share token every one of them carries, so a plain
    tour link (which used to render as a link-out card only) now becomes a
    real `<iframe>`. That same endpoint doubles as a static PNG generator
    with `image=1&hm=true` (`komootImageUrl`) - used to give the map its own
    spread in the photobook (see "Photobook" further down), no
    screenshotting needed.
  - **Strava**: their share-link/classic embed-iframe URLs no longer allow
    framing at all - the only thing that still works is their own
    placeholder-`<div data-embed-id data-token>` + a shared
    `<script src="strava-embeds.com/embed.js">` that replaces the div with
    a real iframe client-side. Paste the whole snippet Strava's share menu
    gives you; `extractEmbedUrl` pulls the activity id + token out of it
    (checked before the generic src=/href= extraction, since the snippet's
    only literal `src=` is the same generic widget script for every
    activity) into a URL of the app's own device
    (`.../activities/:id?embed_token=...`) that `stravaActivityInfo` reads
    back at render time. The widget script is included at most once per
    page (`hasStravaWidget` in `render.js`/`deck.js`), however many Strava
    embeds a story has.
  - **Garmin Connect**: doesn't have as well-known an embed format as
    Strava/Komoot - needs the specific "Embed" share link the service
    itself generates (path or query containing "embed"); anything else
    shows as a link-out card, since most activity/tour pages simply refuse
    to be framed (blank or an error instead of quietly failing).
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
- Sections themselves are drag-to-reorder too (`StoryEditor.jsx`, same
  sortablejs setup, `.stop-drag-handle`), not just the photos inside one -
  a real gap until now (only add/remove/split existed for sections). The
  Sortable instance is re-created whenever the number of stops changes,
  since it manages the section `<section>` elements as plain DOM nodes
  during a drag rather than through React state - stale after an
  add/remove/split otherwise.
- A photo can also be dragged straight into a *different* section's grid,
  not just reordered within one - the fix for the rare photo whose EXIF
  timestamp is off enough that automatic clustering put it in the wrong
  stop entirely. Every stop's grid shares one sortablejs `group` name so
  items can move between them; `onEnd` tells a same-stop reorder from a
  cross-stop move via `evt.from`/`evt.to`. The real trap: sortablejs
  physically relocates the dragged DOM node into the *other* grid's own
  React-rendered subtree, and React's next reconcile (triggered by the
  resulting state update) crashes trying to remove a child that's no
  longer where it left it ("Failed to execute 'removeChild'") - only
  reproducible via an actual drag in a real browser, not caught by the
  build or a same-list drag. Fixed the standard way for sortablejs across
  more than one React-owned list: put the node back where React last
  rendered it (`evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex])`)
  *before* handing the real move to React via state, so React's own
  reconcile - not sortablejs's raw DOM surgery - is what actually moves it.
  Clears the moved photo's `featured` flag (it was that flag *for the old
  stop*, unrelated to whichever stop it's joining, and leaving it set could
  silently unseat the new stop's own hero photo). Smoke-tested with a
  scroll-during-drag helper, since the target stop can be thousands of
  pixels below the source in a real yearbook - a plain single mouse-move
  doesn't reach it, and neither does repeating a `mouse.move` at an
  unchanged viewport coordinate after scrolling (the browser doesn't fire a
  new event just because the page moved under a stationary cursor).
- Adding a theme (10 now, up from 4) is a single new entry in `THEMES` in
  `themes.js` — render.js, deck.js, the editor's theme picker, and the
  `/api/themes` endpoint all read from that one object, nothing else to
  touch. Each theme picks its own map mood via a CSS filter applied to
  Leaflet's tile pane (grayscale, sepia, inverted-for-dark, or none)
  rather than a different tile provider per theme — see the next note for
  why. Deliberately conservative about the filters on the 6 newest themes
  (each reuses one of the same handful of filter patterns already proven
  to look right, rather than inventing a new hue-rotate value per theme)
  since a filter's actual effect on real OSM tiles isn't obvious from the
  numbers alone — verified all 6 with real screenshots rather than trusting
  the color math.
- **Notes-import could misattribute content to the wrong stop when a
  stop's heading doesn't mention the specific place the notes describe** —
  found via a real case where a paragraph about "Särö Västerskog" (only
  ever visible as an info-card place name, since the stop itself is headed
  "Lerkil") got matched to a different stop entirely. The AI only ever saw
  each stop's heading/narrative/captions, none of which necessarily
  contain the specific named place a note's paragraph is about. Fixed by
  also passing each stop's already-known place names (suggested places +
  info card place names — both ultimately from PhotoPrism's own photo
  place labels) and telling the model to prefer that list over the heading
  for this kind of matching. An improvement to the odds, not a guarantee —
  matching free text to the right stop is still a judgment call the model
  makes, just with better signal now.
- **A second, unrelated bug in the same feature: two suggestions for the
  same stop would "use" together.** `NotesImportPanel.jsx` tracked which
  suggestion had been applied, and its list `key`, both by `stopId` — fine
  when the AI never suggested two different drafts for one stop, which
  turned out not to be a safe assumption. Since two suggestions can share
  a `stopId`, keying either by it meant clicking "Use this" on one silently
  marked both as used. Switched both to the suggestion's array index,
  which is always unique regardless of how many suggestions target the
  same stop.
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
- PDF photo boxes still use `object-fit: cover`, but only to absorb the
  sliver of difference when a collage is stretched to fill its box (the
  engine only stretches when the arrangement already matches the box to
  within ~7-10%); otherwise the collage is centered at its native aspect
  and the backdrop/paper shows around it. The only intentionally cropped
  photos are full-bleed backgrounds, and those are chosen as the photo that
  survives a full-page crop best (a featured photo is preferred when its
  shape allows).
- Photo cards on a background photo are placed in page corners without
  knowing what's in the background, so a card can cover a face in it.
  Featured photos are preferred as backgrounds, so marking a scenic shot as
  featured is the lever for now.
- Stops without narrative get no separate opening page: their featured
  photo leads the first photo page, which carries the stop title (in the
  photobook pack, handwritten on the background, like the reference book).
  "Top" info cards come right after that title page.
- Live preview uses the 720px thumbnails for speed; the exported PDF uses
  the 2048px versions. Layout is identical because it depends only on the
  stored photo width/height.
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
- `renderStoryPdf` (`pdf.js`) generates the PDF from an HTML string via
  Playwright's `page.setContent()`, which only replaces the document's
  *markup* - left on the default `about:blank`, it has no real origin, so
  the relative `/api/photo/...` image URLs now used everywhere (see
  Architecture above) would have nothing to resolve against and every photo
  would silently fail to load. Fixed by `page.goto()`-ing a trivial page on
  this same server (`GET /__pdf-base`) first, *then* calling `setContent()`
  - the document keeps that origin, so the relative URLs resolve correctly.
  `renderDeckPdf` never had this problem: it already navigates to a real
  `/story/:id/present` URL rather than using `setContent()`.
