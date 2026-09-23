import { db } from "./db.js";
import { detectFaces } from "./faceDetect.js";
import { detectObjects, saliencyGrid, importanceGrid, GRID } from "./photoAnalysis.js";

// Facts about a photo that make a printed layout smarter, read from
// PhotoPrism's photo details and cached in SQLite (they don't change once
// PhotoPrism has indexed a photo):
//   faces    - face boxes {x, y, w, h} relative to the displayed image (0..1),
//              from PhotoPrism's face markers, or - when PhotoPrism found none
//              - from our own detector (faceDetect.js) run on the thumbnail
//   faceSource - "photoprism" | "yunet" | null
//   objects  - detected subjects {x, y, w, h, label, score} (NanoDet)
//   importance - { grid: GRID, cells: [0..255] } what matters where in the
//              photo (faces + bodies, subjects, saliency), see photoAnalysis.js
//   labels   - lower-case label names ("landscape", "people", ...)
//   takenAt  - capture time in ms (for burst detection)
//   quality  - PhotoPrism's quality score (higher is better)
const BASE_URL = process.env.PHOTOPRISM_BASE_URL;
const REFRESH_MS = 30 * 24 * 3600 * 1000;
// Bump when the stored shape changes so old cache rows are recomputed.
const VERSION = 3;

const getStmt = db.prepare("SELECT data, fetched_at FROM photo_insights WHERE photo_uid = ?");
const putStmt = db.prepare(
  "INSERT INTO photo_insights (photo_uid, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(photo_uid) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at"
);

function parse(details) {
  const primary = (details.Files || []).find((f) => f.Primary) || (details.Files || [])[0] || {};
  const faces = (primary.Markers || [])
    .filter((m) => m.Type === "face" && !m.Invalid && m.W > 0 && m.H > 0)
    .map((m) => ({ x: m.X, y: m.Y, w: m.W, h: m.H }));
  return {
    faces,
    faceCount: Math.max(details.Faces || 0, faces.length),
    labels: (details.Labels || []).map((l) => (l.Label?.Name || "").toLowerCase()).filter(Boolean),
    takenAt: details.TakenAt ? Date.parse(details.TakenAt) : null,
    quality: details.Quality ?? null,
  };
}

async function fetchInsight(uid, thumbUrl) {
  const res = await fetch(`${BASE_URL}/api/v1/photos/${uid}`);
  if (!res.ok) throw new Error(`PhotoPrism ${res.status} for ${uid}`);
  const insight = { v: VERSION, ...parse(await res.json()), faceSource: null, objects: [], importance: null };
  if (insight.faces.length) insight.faceSource = "photoprism";
  if (!thumbUrl) return insight;
  try {
    const img = Buffer.from(await (await fetch(thumbUrl)).arrayBuffer());
    if (!insight.faces.length) {
      insight.faces = (await detectFaces(img)).map(({ x, y, w, h }) => ({ x, y, w, h }));
      insight.faceSource = "yunet";
    }
    insight.faceCount = Math.max(insight.faceCount, insight.faces.length);
    insight.objects = await detectObjects(img);
    insight.importance = {
      grid: GRID,
      cells: importanceGrid({ faces: insight.faces, objects: insight.objects, saliency: await saliencyGrid(img) }),
    };
  } catch (err) {
    console.warn("photo analysis failed:", uid, err.message);
  }
  return insight;
}

// Cached insights for `uids`, fetching missing/stale ones (a handful at a
// time). Failures are skipped - layout just falls back to shape-only rules.
// `photos`: [{ photoUid, thumbUrl }].
export async function loadInsights(photos) {
  const out = new Map();
  const missing = [];
  const seen = new Set();
  for (const p of photos) {
    const uid = p.photoUid;
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const row = getStmt.get(uid);
    const data = row ? JSON.parse(row.data) : null;
    if (data?.v === VERSION && Date.now() - Date.parse(row.fetched_at) < REFRESH_MS) out.set(uid, data);
    else missing.push(p);
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, missing.length) }, async () => {
      while (next < missing.length) {
        const { photoUid: uid, thumbUrl } = missing[next++];
        try {
          const insight = await fetchInsight(uid, thumbUrl);
          putStmt.run(uid, JSON.stringify(insight), new Date().toISOString());
          out.set(uid, insight);
        } catch (err) {
          console.warn("photo insight failed:", err.message);
        }
      }
    })
  );
  return out;
}

// Attaches `insights` to every included photo of a story (in place).
export async function attachInsights(story) {
  const photos = story.stops.flatMap((s) => s.photos.filter((p) => p.included));
  const map = await loadInsights(photos);
  photos.forEach((p) => {
    p.insights = map.get(p.photoUid) || null;
  });
  return story;
}
