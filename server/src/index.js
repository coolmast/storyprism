import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { listAlbums, getAlbumPhotos, thumbUrl } from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";
import {
  createStoryFromAlbum,
  listStories,
  getStory,
  updateStory,
  deleteStory,
} from "./stories.js";
import { getProvider } from "./ai/index.js";
import { renderStoryHtml } from "./render.js";
import { renderStoryDeck } from "./deck.js";
import { renderStoryPdf, renderDeckPdf } from "./pdf.js";
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

app.get("/api/stories", (req, res) => {
  res.json(listStories());
});

app.post("/api/stories", async (req, res) => {
  try {
    const { albumUid } = req.body;
    if (!albumUid) return res.status(400).json({ error: "albumUid is required" });
    res.status(201).json(await createStoryFromAlbum(albumUid));
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
      stops: story.stops.map((s) => ({
        id: s.id,
        heading: s.heading || s.placeLabel || "Stop",
        dateRange: new Date(s.startedAt).toLocaleDateString(),
        narrative: s.narrative,
        captions: s.photos.filter((p) => p.included && p.caption).map((p) => p.caption),
      })),
    });
    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get("/story/:id", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).send("Story not found");
  res.type("html").send(renderStoryHtml(story));
});

app.get("/story/:id/present", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).send("Story not found");
  res.type("html").send(renderStoryDeck(story));
});

app.get("/api/stories/:id/export/pdf", async (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).json({ error: "Not found" });

  try {
    const pdf = await renderStoryPdf(`http://localhost:${port}/story/${story.id}`);
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
