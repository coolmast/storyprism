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
import { renderStoryPdf } from "./pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(
  "/vendor/leaflet",
  express.static(path.join(__dirname, "../../node_modules/leaflet/dist"))
);

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

app.get("/story/:id", (req, res) => {
  const story = getStory(req.params.id);
  if (!story) return res.status(404).send("Story not found");
  res.type("html").send(renderStoryHtml(story));
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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`story-builder server on :${port}`));
