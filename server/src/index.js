import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { listAlbums, getAlbumPhotos, getPhotosByDateRange, thumbUrl } from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";
import {
  createStoryFromAlbum,
  createStoryFromDateRange,
  listStories,
  getStory,
  updateStory,
  deleteStory,
  getMatchingPhotosForPlace,
} from "./stories.js";
import { LANGUAGES, NATIVE_LANGUAGE_NAMES, languageName } from "./i18n.js";
import { getProvider } from "./ai/index.js";
import { renderStoryHtml } from "./render.js";
import { renderStoryDeck } from "./deck.js";
import { renderStoryPdf, renderDeckPdf } from "./pdf.js";
import { buildPdfHtml } from "./pdfDocument.js";
import { PDF_TEMPLATES } from "./pdfTemplates.js";
import { PDF_LAYOUT_PACKS } from "./pdfLayoutPacks.js";
import { PDF_PAPER_SIZES } from "./pdfPaperSizes.js";
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

app.get("/api/albums", async (req, res) => {
  try {
    res.json(await listAlbums());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/albums/:uid/itinerary", async (req, res) => {
  try {
    const photos = await getAlbumPhotos(req.params.uid);
    const withThumbs = photos.map((p) => ({
      ...p,
      thumbUrl: p.thumbHash ? thumbUrl(p.thumbHash) : null,
    }));
    res.json(buildItinerary(withThumbs));
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
    res.json(buildItinerary(withThumbs));
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
    const { albumUid, dateFrom, dateTo, title, contentLanguage } = req.body;
    if (albumUid) {
      return res.status(201).json(await createStoryFromAlbum(albumUid, contentLanguage));
    }
    if (dateFrom && dateTo) {
      return res
        .status(201)
        .json(await createStoryFromDateRange(dateFrom, dateTo, title, contentLanguage));
    }
    return res.status(400).json({ error: "albumUid or dateFrom/dateTo is required" });
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

app.post("/api/stories/:id/stops/:stopId/photos/:photoId/draft-caption", async (req, res) => {
  const story = getStory(req.params.id);
  const stop = story?.stops.find((s) => s.id === req.params.stopId);
  const photo = stop?.photos.find((p) => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: "Not found" });
  if (!photo.thumbUrl) return res.status(400).json({ error: "Photo has no image to look at" });

  try {
    const caption = await getProvider().draftCaption({
      photoUrl: photo.thumbUrl,
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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`story-builder server on :${port}`));
