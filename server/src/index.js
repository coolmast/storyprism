import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import {
  listAlbums,
  getAlbumPhotos,
  getPhotosByDateRange,
  thumbUrl,
  initPhotoPrism,
  fetchThumbBuffer,
  fetchOriginalBuffer,
} from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";
import { findContentThemeCandidates, findPersonThemeCandidates, detectTripClusters } from "./photoThemes.js";
import {
  createStoryFromAlbums,
  createStoryFromDateRange,
  createStoryFromThemePlan,
  listStories,
  getStory,
  updateStory,
  deleteStory,
  getMatchingPhotosForPlace,
} from "./stories.js";
import { checkStoryUpdates, addThemeToStory } from "./storyUpdate.js";
import { LANGUAGES, NATIVE_LANGUAGE_NAMES, languageName } from "./i18n.js";
import { getProvider } from "./ai/index.js";
import { renderStoryHtml } from "./render.js";
import { renderStoryDeck } from "./deck.js";
import { renderStoryPdf, renderDeckPdf } from "./pdf.js";
import { buildPdfHtml } from "./pdfDocument.js";
import { PDF_TEMPLATES } from "./pdfTemplates.js";
import { PDF_LAYOUT_PACKS } from "./pdfLayoutPacks.js";
import { PDF_PAPER_SIZES } from "./pdfPaperSizes.js";
import { BOOK_PRODUCTS } from "./photobook/products.js";
import { BOOK_LAYOUT_PACKS } from "./photobook/bookLayoutPacks.js";
import { SPREAD_LAYOUTS, BOOK_FONTS, CEWE_FONTS, CEWE_FONT_FOR, DEFAULT_TITLE_FONT, DEFAULT_BODY_FONT } from "./photobook/spreadLayouts.js";
import { buildBookPreviewHtml } from "./photobook/bookPreview.js";
import { startBookExport, getBookJob } from "./photobook/bookExport.js";
import { attachInsights } from "./photoInsights.js";
import { THEMES } from "./themes.js";
import { fetchArticleText } from "./article.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
// Default 100kb is nowhere near enough: a story with 100+ photos per stop
// serializes to several hundred KB (each photo carries thumb/full URLs,
// dimensions, caption, flags). Saving silently 413'd before this fix.
app.use(express.json({ limit: "20mb" }));
app.use(
  "/vendor/leaflet",
  express.static(path.join(__dirname, "../../node_modules/leaflet/dist"))
);
app.use(
  "/vendor/photoswipe",
  express.static(path.join(__dirname, "../../node_modules/photoswipe/dist"))
);
app.use(
  "/vendor/reveal",
  express.static(path.join(__dirname, "../../node_modules/reveal.js/dist"))
);

// Every photo URL this app ever sends to a browser points here, never at
// PhotoPrism directly (see the comment at the top of photoprism.js) - the
// client only needs to reach this server, which is the thing that's
// actually exposed publicly (story.sensing-the-world.de); PhotoPrism itself
// can stay LAN-only. Long, immutable cache lifetime: a given hash+size (or
// hash, for the original) never changes content.
function sendPhotoError(res, err) {
  // "Invalid photo hash/size" is our own input validation (a malformed
  // request); anything else is PhotoPrism/network failing.
  res.status(err.message.startsWith("Invalid photo") ? 400 : 502).json({ error: err.message });
}

app.get("/api/photo/t/:hash/:size", async (req, res) => {
  try {
    const { buffer, contentType } = await fetchThumbBuffer(req.params.hash, req.params.size);
    res.set("Content-Type", contentType).set("Cache-Control", "public, max-age=31536000, immutable").send(buffer);
  } catch (err) {
    sendPhotoError(res, err);
  }
});

app.get("/api/photo/dl/:hash", async (req, res) => {
  try {
    const { buffer, contentType } = await fetchOriginalBuffer(req.params.hash);
    res.set("Content-Type", contentType).set("Cache-Control", "public, max-age=31536000, immutable").send(buffer);
  } catch (err) {
    sendPhotoError(res, err);
  }
});

// Trivial same-origin page for renderStoryPdf (pdf.js) to navigate to before
// calling page.setContent(): setContent() only overwrites the *content* of
// whatever page is already loaded, so navigating here first (instead of
// leaving Chromium on about:blank) gives that document a real origin -
// this server's own - and makes the relative /api/photo/... URLs inside the
// generated PDF HTML resolve correctly.
app.get("/__pdf-base", (req, res) => res.type("html").send("<!doctype html><title>.</title>"));

app.get("/api/themes", (req, res) => {
  res.json(
    Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label, swatch: t.swatch }))
  );
});

app.get("/api/languages", (req, res) => {
  res.json(LANGUAGES.map((code) => ({ code, label: NATIVE_LANGUAGE_NAMES[code] })));
});

app.get("/api/pdf-layouts", (req, res) => {
  res.json({
    templates: Object.entries(PDF_TEMPLATES).map(([id, t]) => ({
      id,
      label: t.label,
      photoSlots: t.photoSlots,
      hasText: t.hasText,
      selectable: t.selectable,
    })),
    packs: Object.entries(PDF_LAYOUT_PACKS).map(([id, p]) => ({ id, label: p.label })),
    paperSizes: Object.entries(PDF_PAPER_SIZES).map(([id, p]) => ({ id, label: p.label })),
  });
});

// Saal's own fonts, if extracted locally (tools/extract_saal_fonts.py) -
// used by the book preview to render with the exact glyphs Saal prints.
app.use(
  "/api/saal-fonts",
  express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/saal-fonts"), {
    index: false,
    maxAge: "7d",
    setHeaders: (res) => res.set("Access-Control-Allow-Origin", "*"),
  })
);

app.get("/api/book-products", (req, res) => {
  res.json({
    products: Object.entries(BOOK_PRODUCTS).map(([id, p]) => ({ id, label: p.label, vendor: p.vendor || "saal" })),
    packs: Object.entries(BOOK_LAYOUT_PACKS).map(([id, p]) => ({ id, label: p.label })),
    layouts: Object.entries(SPREAD_LAYOUTS).map(([id, l]) => ({ id, label: l.label })),
    fonts: BOOK_FONTS.map((f) => ({ name: f.name, kind: f.kind, google: f.google })),
    ceweFonts: CEWE_FONTS.map((f) => ({ name: f.name, kind: f.kind })),
    ceweFontFor: CEWE_FONT_FOR,
    defaultFonts: { title: DEFAULT_TITLE_FONT, body: DEFAULT_BODY_FONT },
  });
});

app.get("/api/albums", async (req, res) => {
  try {
    res.json(await listAlbums());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// A live preview's map pin and stop-list card only ever show a handful of
// thumbnails per stop (ItineraryMap: the first photo; StopList: the first
// four) - `photoCount` already carries the true total separately, so
// sending literally every photo in every stop over the network here is
// pure waste. Harmless for a small album, but getPhotosByDateRange no
// longer silently truncates a busy range (see fetchAllPages) - so a wide
// "Eigener Zeitraum"/"Nach Themen" range can now correctly gather
// thousands of real photos, and without this trim a preview response can
// balloon to multiple megabytes of photo metadata never actually rendered,
// slow enough on a real mobile connection to look like the preview simply
// never showed up.
const PREVIEW_PHOTO_SAMPLE = 4;
function trimForPreview(stops) {
  return stops.map((s) => ({ ...s, photos: s.photos.slice(0, PREVIEW_PHOTO_SAMPLE) }));
}

// One or several albums/moments, merged - the New Story picker's live
// preview (map + stop list) for the current selection, before a story is
// actually created. Dedupes by photo UID so a photo present in more than
// one selected album isn't clustered twice.
app.get("/api/albums/itinerary", async (req, res) => {
  try {
    const uids = String(req.query.uids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (uids.length === 0) return res.json([]);

    const photoLists = await Promise.all(uids.map((uid) => getAlbumPhotos(uid)));
    const seen = new Set();
    const photos = [];
    for (const list of photoLists) {
      for (const p of list) {
        if (seen.has(p.uid)) continue;
        seen.add(p.uid);
        photos.push(p);
      }
    }
    const withThumbs = photos.map((p) => ({
      ...p,
      thumbUrl: p.thumbHash ? thumbUrl(p.thumbHash) : null,
    }));
    res.json(trimForPreview(buildItinerary(withThumbs)));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/itinerary/by-date", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    }
    const photos = await getPhotosByDateRange(from, to);
    const withThumbs = photos.map((p) => ({
      ...p,
      thumbUrl: p.thumbHash ? thumbUrl(p.thumbHash) : null,
    }));
    res.json(trimForPreview(buildItinerary(withThumbs)));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// "Yearbook" mode's suggestion step - see photoThemes.js. Trip detection
// reuses the same photo list the regular date-range preview already
// fetches, so this is one extra full fetch plus a bounded set of cheap
// (count=1) label/subject probes, not per-photo work.
app.get("/api/theme-candidates", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    }
    const [contentThemes, peopleThemes, rangePhotos] = await Promise.all([
      findContentThemeCandidates(from, to),
      findPersonThemeCandidates(from, to),
      getPhotosByDateRange(from, to),
    ]);
    res.json({
      contentThemes,
      peopleThemes,
      tripThemes: detectTripClusters(rangePhotos),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/stories", (req, res) => {
  res.json(listStories());
});

app.post("/api/stories", async (req, res) => {
  try {
    const { albumUids, dateFrom, dateTo, title, contentLanguage, themePlan } = req.body;
    if (Array.isArray(albumUids) && albumUids.length > 0) {
      return res.status(201).json(await createStoryFromAlbums(albumUids, title, contentLanguage));
    }
    if (themePlan) {
      return res
        .status(201)
        .json(await createStoryFromThemePlan({ ...themePlan, title, contentLanguage }));
    }
    if (dateFrom && dateTo) {
      return res
        .status(201)
        .json(await createStoryFromDateRange(dateFrom, dateTo, title, contentLanguage));
    }
    return res.status(400).json({ error: "albumUids, themePlan, or dateFrom/dateTo is required" });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/stories/:id", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });
  res.json(story);
});

app.put("/api/stories/:id", (req, res) => {
  const story = updateStory(req.params.id, req.body);
  if (!story) return res.status(404).json({ error: "Not found" });
  res.json(story);
});

app.delete("/api/stories/:id", (req, res) => {
  const ok = deleteStory(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Re-runs the query that created this story (see storyUpdate.js) and merges
// in whatever now matches but didn't before - photos imported to PhotoPrism
// after the story was started. Additive only, and only ever touches a stop
// that actually gained something.
app.post("/api/stories/:id/check-updates", async (req, res) => {
  try {
    const result = await checkStoryUpdates(req.params.id);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Cherry-picking one section into a "Nach Themen" story that started out
// empty (just its date range - see createStoryFromThemePlan). `theme` is one
// of the same shapes /api/theme-candidates suggests (trip/content/person),
// or a hand-typed { type: "query", query, title } free-text search, or the
// { type: "leftover" } marker for "add whatever nothing else has claimed" -
// planThemeStops (stories.js) is what actually understands each shape.
app.post("/api/stories/:id/theme-sections", async (req, res) => {
  try {
    const { theme } = req.body;
    if (!theme || !theme.id || !theme.type) {
      return res.status(400).json({ error: "theme (with id and type) is required" });
    }
    const result = await addThemeToStory(req.params.id, theme);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/stories/:id/stops/:stopId/photos/:photoId/draft-caption", async (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  const photo = stop?.photos.find((p) => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: "Not found" });
  if (!photo.hash) return res.status(400).json({ error: "Photo has no image to look at" });

  try {
    const caption = await getProvider().draftCaption({
      photoHash: photo.hash,
      place: stop.heading || stop.placeLabel,
      date: stop.startedAt,
      storyTitle: story.title,
      language: languageName(story.contentLanguage),
    });
    res.json({ caption });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/stories/:id/stops/:stopId/research", async (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  if (!stop) return res.status(404).json({ error: "Not found" });

  try {
    const research = await getProvider().researchPlace({
      place: stop.heading || stop.placeLabel || "this place",
      storyTitle: story.title,
      dateRange: new Date(stop.startedAt).toLocaleDateString(),
      language: languageName(story.contentLanguage),
    });
    res.json({ research });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/stories/:id/stops/:stopId/interview", async (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  if (!stop) return res.status(404).json({ error: "Not found" });

  try {
    const reply = await getProvider().interviewTurn({
      heading: stop.heading || stop.placeLabel || "this stop",
      dateRange: new Date(stop.startedAt).toLocaleDateString(),
      narrative: stop.narrative,
      captions: stop.photos.filter((p) => p.included && p.caption).map((p) => p.caption),
      research: stop.research,
      history: Array.isArray(req.body.history) ? req.body.history : [],
      language: languageName(story.contentLanguage),
    });
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/stories/:id/stops/:stopId/interview/draft", async (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  if (!stop) return res.status(404).json({ error: "Not found" });

  try {
    const result = await getProvider().draftFromInterview({
      heading: stop.heading || stop.placeLabel || "this stop",
      narrative: stop.narrative,
      captions: stop.photos.filter((p) => p.included && p.caption).map((p) => p.caption),
      research: stop.research,
      history: Array.isArray(req.body.history) ? req.body.history : [],
      language: languageName(story.contentLanguage),
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/stories/:id/import-notes", async (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });

  try {
    let notesText = (req.body.text || "").trim();
    if (!notesText && req.body.url) {
      const article = await fetchArticleText(req.body.url);
      notesText = article.text;
    }
    if (!notesText) {
      return res.status(400).json({ error: "Paste some notes or provide a URL" });
    }

    const suggestions = await getProvider().organizeNotesIntoStory({
      storyTitle: story.title,
      notesText,
      language: languageName(story.contentLanguage),
      stops: story.stops.map((s) => ({
        id: s.id,
        heading: s.heading || s.placeLabel || "Stop",
        dateRange: new Date(s.startedAt).toLocaleDateString(),
        narrative: s.narrative,
        captions: s.photos.filter((p) => p.included && p.caption).map((p) => p.caption),
        // The stop's heading alone can miss a specific named place the
        // notes mention - e.g. a stop headed "Lerkil" whose actual photos
        // are of the "Särö Västerskog" nature reserve nearby. Info-card
        // place names and place-suggestion chips both come from real photo
        // place labels, so they're a much better signal than the heading
        // for "does this stop actually cover the place this paragraph is
        // about" - found via a real mismatch during testing.
        placeNames: [...new Set([...(s.suggestedPlaces || []), ...(s.infoCards || []).map((c) => c.placeName)])],
      })),
    });
    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/stories/:id/stops/:stopId/info-cards", async (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  if (!stop) return res.status(404).json({ error: "Not found" });

  const placeName = (req.body.placeName || "").trim();
  if (!placeName) return res.status(400).json({ error: "placeName is required" });

  try {
    const card = await getProvider().generateInfoCard({
      placeName,
      context: stop.heading !== placeName ? `near ${stop.heading}` : "",
      language: languageName(story.contentLanguage),
    });
    res.json({ placeName, ...card });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/stories/:id/stops/:stopId/places/:placeName/photos", (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  if (!stop) return res.status(404).json({ error: "Not found" });
  res.json(getMatchingPhotosForPlace(stop.id, req.params.placeName));
});

app.get("/story/:id", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).send("Story not found");
  res.type("html").send(renderStoryHtml(story, { editMode: req.query.preview === "1" }));
});

app.get("/story/:id/present", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).send("Story not found");
  res.type("html").send(renderStoryDeck(story));
});

// Serves the exact HTML that export/pdf below converts to a PDF - lets the
// user (or the editor's "Preview PDF layout" link) eyeball the page
// templates in an ordinary browser tab, including trying a different pack/
// paper size via query params before committing to it, without generating
// an actual PDF file each time.
app.get("/story/:id/pdf-preview", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).send("Story not found");
  res.type("html").send(buildPdfHtml(story, { pack: req.query.pack, paperSize: req.query.paperSize, preview: true }));
});

// Live preview for the editor: renders the *unsaved* draft the editor
// posts, so changing the pack, paper size or a stop's layout shows up
// immediately instead of after a save + PDF export round trip. Nothing is
// persisted here.
app.post("/api/stories/:id/pdf-preview", (req, res) => {
  const draft = req.body?.story;
  if (!draft || !Array.isArray(draft.stops)) return res.status(400).send("Missing story draft");
  const stops = draft.stops.map((s) => ({
    ...s,
    photos: Array.isArray(s.photos) ? s.photos : [],
    infoCards: Array.isArray(s.infoCards) ? s.infoCards : [],
    embeds: Array.isArray(s.embeds) ? s.embeds : [],
  }));
  try {
    res.type("html").send(buildPdfHtml({ ...draft, stops }, { editor: true }));
  } catch (err) {
    console.error(err);
    res.status(500).send(String(err.message || err));
  }
});

// The editor posts its (possibly unsaved) draft for both the book preview
// and the Saal export, so what gets exported is exactly what was previewed.
function draftFromBody(body) {
  const draft = body?.story;
  if (!draft || !Array.isArray(draft.stops)) return null;
  return {
    ...draft,
    stops: draft.stops.map((s) => ({
      ...s,
      photos: (Array.isArray(s.photos) ? s.photos : []).map((p) => ({
        ...p,
        // Drafts loaded before photo hashes were exposed only carry URLs.
        hash: p.hash || (p.thumbUrl || "").match(/\/t\/([0-9a-f]+)\//)?.[1] || null,
      })),
      infoCards: Array.isArray(s.infoCards) ? s.infoCards : [],
      embeds: Array.isArray(s.embeds) ? s.embeds : [],
    })),
  };
}

app.post("/api/stories/:id/book-preview", async (req, res) => {
  const story = draftFromBody(req.body);
  if (!story) return res.status(400).send("Missing story draft");
  try {
    // Faces, labels and capture times from PhotoPrism (cached after the
    // first preview) drive the content-aware layout decisions.
    await attachInsights(story);
    res.type("html").send(buildBookPreviewHtml(story));
  } catch (err) {
    console.error(err);
    res.status(500).send(String(err.message || err));
  }
});

app.post("/api/stories/:id/book-export", async (req, res) => {
  const story = draftFromBody(req.body) || getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });
  await attachInsights(story);
  const job = startBookExport(story);
  res.json({ jobId: job.id });
});

app.get("/api/book-exports/:jobId", (req, res) => {
  const job = getBookJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Unknown export" });
  const { id, status, stage, done, total, error, size, numPages, fileName } = job;
  res.json({ id, status, stage, done, total, error, size, numPages, fileName });
});

app.get("/api/book-exports/:jobId/download", (req, res) => {
  const job = getBookJob(req.params.jobId);
  if (!job || job.status !== "done") return res.status(404).json({ error: "Export not ready" });
  res.download(job.path, job.fileName);
});

app.get("/api/stories/:id/export/pdf", async (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });

  try {
    const pdf = await renderStoryPdf(story, { pack: req.query.pack, paperSize: req.query.paperSize });
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${story.title.replace(/[^\w -]/g, "")}.pdf"`)
      .send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stories/:id/export/deck-pdf", async (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });

  try {
    const pdf = await renderDeckPdf(`http://localhost:${port}/story/${story.id}/present`);
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="${story.title.replace(/[^\w -]/g, "")} - slides.pdf"`)
      .send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Logs into PhotoPrism (if PHOTOPRISM_USERNAME/PHOTOPRISM_APP_PASSWORD are
// set) and fetches its preview/download tokens before accepting requests -
// see photoprism.js. Never rejects; a broken PhotoPrism connection is
// logged there and shouldn't stop this server from starting.
await initPhotoPrism();

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`story-builder server on :${port}`));
