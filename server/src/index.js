import "dotenv/config";
import express from "express";
import cors from "cors";
import { listAlbums, getAlbumPhotos, thumbUrl } from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";

const app = express();
app.use(cors());
app.use(express.json());

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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`story-builder server on :${port}`));
