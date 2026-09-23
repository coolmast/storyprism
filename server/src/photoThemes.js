// "Yearbook" story creation: instead of the usual single chronological
// itinerary, group a date range's photos into theme-based sections a user
// picks from suggested candidates - content (PhotoPrism Labels: "Zoo",
// "Dining", ...), people (PhotoPrism named Subjects: works regardless of
// where/when a photo of that person was taken), and trips (a detected
// multi-day cluster away from home, using the same distance logic as the
// regular itinerary clustering, just applied across a whole date range
// instead of within one). See the "Content-aware Fotolayout" note for how
// PhotoPrism Labels are already used elsewhere in this app.
import { haversine } from "./itinerary.js";
import { listLabels, listPersonSubjects, countPhotosByLabel, countPhotosBySubject } from "./photoprism.js";

// Structural/generic PhotoPrism labels that describe *how* a photo looks
// (or that apply to nearly everything), not a distinct theme worth its own
// section.
const CONTENT_LABEL_BLOCKLIST = new Set([
  "people",
  "portrait",
  "architecture",
  "building",
  "moment",
  "indoor",
  "document",
  "sign",
  "photography",
  "screenshot",
  "text",
  "plate",
  "info",
  "store",
  "shop",
  "office",
  "computer",
  "electronics",
]);

const MIN_GLOBAL_LABEL_COUNT = 5; // skip near-empty labels before even probing
const MIN_CANDIDATE_PHOTOS = 5; // a candidate needs at least this many matches in-range to be worth suggesting
const DISPLAY_SAMPLE_SIZE = 200; // ranking/display pass for whichever candidates clear the line above
const MAX_CANDIDATES_PER_TYPE = 12;
const PROBE_CONCURRENCY = 8;

const HOME_GRID_DEGREES = 0.05; // ~5 km buckets, for finding the "home" location by simple majority
const AWAY_FROM_HOME_M = 60000; // farther than this from home counts as "away" (a trip), not a local errand
const TRIP_GAP_MS = 2 * 24 * 60 * 60 * 1000; // up to 2 days with no "away" photos still counts as the same trip
const MIN_TRIP_PHOTOS = 15;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function findContentThemeCandidates(from, to) {
  const labels = await listLabels();
  const candidates = labels.filter(
    (l) => l.photoCount >= MIN_GLOBAL_LABEL_COUNT && !CONTENT_LABEL_BLOCKLIST.has(l.slug)
  );
  // Pass 1 (cheap, every candidate): does it clear the minimum at all?
  const passed = await mapWithConcurrency(candidates, PROBE_CONCURRENCY, async (l) => ({
    ...l,
    aboveMin: (await countPhotosByLabel(l.slug, from, to, MIN_CANDIDATE_PHOTOS)) >= MIN_CANDIDATE_PHOTOS,
  }));
  const survivors = passed.filter((l) => l.aboveMin);
  // Pass 2 (only the survivors): a real number worth showing/ranking by.
  const ranked = await mapWithConcurrency(survivors, PROBE_CONCURRENCY, async (l) => ({
    ...l,
    scopedCount: await countPhotosByLabel(l.slug, from, to, DISPLAY_SAMPLE_SIZE),
  }));
  return ranked
    .sort((a, b) => b.scopedCount - a.scopedCount)
    .slice(0, MAX_CANDIDATES_PER_TYPE)
    .map((l) => ({
      id: `label-${l.slug}`,
      type: "content",
      slug: l.slug,
      title: l.name,
      photoCount: l.scopedCount,
    }));
}

export async function findPersonThemeCandidates(from, to) {
  const subjects = await listPersonSubjects();
  const candidates = subjects.filter((s) => s.photoCount >= MIN_GLOBAL_LABEL_COUNT);
  const passed = await mapWithConcurrency(candidates, PROBE_CONCURRENCY, async (s) => ({
    ...s,
    aboveMin: (await countPhotosBySubject(s.uid, from, to, MIN_CANDIDATE_PHOTOS)) >= MIN_CANDIDATE_PHOTOS,
  }));
  const survivors = passed.filter((s) => s.aboveMin);
  const ranked = await mapWithConcurrency(survivors, PROBE_CONCURRENCY, async (s) => ({
    ...s,
    scopedCount: await countPhotosBySubject(s.uid, from, to, DISPLAY_SAMPLE_SIZE),
  }));
  return ranked
    .sort((a, b) => b.scopedCount - a.scopedCount)
    .slice(0, MAX_CANDIDATES_PER_TYPE)
    .map((s) => ({
      id: `subject-${s.uid}`,
      type: "person",
      subjectUid: s.uid,
      title: s.name,
      photoCount: s.scopedCount,
    }));
}

function findHomeCoord(geotaggedPhotos) {
  const buckets = new Map();
  for (const p of geotaggedPhotos) {
    const key = `${Math.round(p.lat / HOME_GRID_DEGREES)}:${Math.round(p.lng / HOME_GRID_DEGREES)}`;
    const bucket = buckets.get(key) || { count: 0, latSum: 0, lngSum: 0 };
    bucket.count += 1;
    bucket.latSum += p.lat;
    bucket.lngSum += p.lng;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return best ? { lat: best.latSum / best.count, lng: best.lngSum / best.count } : null;
}

function tripTitle(photos) {
  const counts = new Map();
  for (const p of photos) {
    const name = p.placeCity || p.placeCountry;
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = name;
  }
  return best || "Trip";
}

// Operates on an already-fetched photo list (no extra PhotoPrism calls) -
// finds the most common rough location across the whole range ("home"),
// then groups the photos far enough from it into contiguous-in-time
// clusters. Each surviving cluster is one trip candidate.
export function detectTripClusters(photos) {
  const geotagged = photos.filter((p) => (p.lat !== 0 || p.lng !== 0) && p.takenAt);
  if (geotagged.length === 0) return [];
  const home = findHomeCoord(geotagged);
  if (!home) return [];

  const away = geotagged
    .filter((p) => haversine(home.lat, home.lng, p.lat, p.lng) > AWAY_FROM_HOME_M)
    .sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));

  const clusters = [];
  let current = null;
  for (const photo of away) {
    const t = new Date(photo.takenAt).getTime();
    if (current && t - current.lastTakenAtMs > TRIP_GAP_MS) current = null;
    if (!current) {
      current = { photos: [], lastTakenAtMs: t };
      clusters.push(current);
    }
    current.photos.push(photo);
    current.lastTakenAtMs = t;
  }

  return clusters
    .filter((c) => c.photos.length >= MIN_TRIP_PHOTOS)
    .map((c, i) => ({
      id: `trip-${i}`,
      type: "trip",
      title: tripTitle(c.photos),
      from: c.photos[0].takenAt.slice(0, 10),
      to: c.photos[c.photos.length - 1].takenAt.slice(0, 10),
      photoCount: c.photos.length,
    }));
}
