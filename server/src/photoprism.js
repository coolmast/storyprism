// PhotoPrism connection. Only PHOTOPRISM_BASE_URL is required - this project
// was built against a local instance with no login (PhotoPrism's "public"
// auth mode), and every function here degrades to that original
// unauthenticated behavior when the auth variables below are unset.
//
// For an instance that uses PhotoPrism's normal login (its "password" auth
// mode - e.g. someone else's own PhotoPrism, not this app's original one),
// set:
//   PHOTOPRISM_USERNAME     - the PhotoPrism user to sign in as
//   PHOTOPRISM_APP_PASSWORD - an "Application Password" created for that
//                             user (PhotoPrism web UI: Account ->
//                             Application Passwords) - NOT their normal
//                             login password, which app-level API clients
//                             shouldn't hold
// or, as an alternative to username+app password, a token obtained some
// other way:
//   PHOTOPRISM_API_TOKEN    - used as-is, no login request is made
const BASE_URL = process.env.PHOTOPRISM_BASE_URL;
const USERNAME = process.env.PHOTOPRISM_USERNAME;
const APP_PASSWORD = process.env.PHOTOPRISM_APP_PASSWORD;
const STATIC_TOKEN = process.env.PHOTOPRISM_API_TOKEN;

if (!BASE_URL) {
  throw new Error("PHOTOPRISM_BASE_URL is not set");
}
if (APP_PASSWORD && !USERNAME) {
  throw new Error("PHOTOPRISM_APP_PASSWORD is set but PHOTOPRISM_USERNAME is not");
}

// null until a session is established; PhotoPrism's `/api/v1/session`
// response shape has varied across versions, so both fields are read and
// both headers are sent below - harmless when a given server ignores one.
let session = STATIC_TOKEN ? { id: STATIC_TOKEN, token: STATIC_TOKEN } : null;

async function login() {
  if (STATIC_TOKEN || !USERNAME) return;
  const res = await fetch(`${BASE_URL}/api/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: APP_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `PhotoPrism login failed: ${res.status} (check PHOTOPRISM_USERNAME/PHOTOPRISM_APP_PASSWORD)`
    );
  }
  const data = await res.json();
  session = { id: data.id || data.session_id || null, token: data.access_token || data.token || null };
}

function authHeaders() {
  if (!session) return {};
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.id) headers["X-Session-ID"] = session.id;
  return headers;
}

async function ppRequest(path, { retry = true } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (res.status === 401 && retry && USERNAME && !STATIC_TOKEN) {
    // Session expired (or this is the very first request and login() at
    // startup failed transiently) - log in again once and retry.
    await login();
    return ppRequest(path, { retry: false });
  }
  if (!res.ok) {
    throw new Error(`PhotoPrism request failed: ${res.status} ${path}`);
  }
  return res;
}

async function ppFetch(path, opts) {
  return (await ppRequest(path, opts)).json();
}

// PhotoPrism reports a search's *total* match count in this header even when
// `count=1` is requested - lets theme discovery (photoThemes.js) cheaply ask
// "how many photos match this label/subject in this date range" for dozens
// of candidates without ever fetching their actual photo lists.
async function ppFetchCount(path) {
  const res = await ppRequest(path);
  return Number(res.headers.get("x-count") || 0);
}

// PhotoPrism's "before" bound is exclusive of the date itself, so bump it by
// a day to make a user-facing "to" date inclusive of that whole day.
function inclusiveBefore(to) {
  const beforeDate = new Date(`${to}T00:00:00Z`);
  beforeDate.setUTCDate(beforeDate.getUTCDate() + 1);
  return beforeDate.toISOString().slice(0, 10);
}

// Called once at server startup: logs in if credentials are configured, and
// warms the preview/download tokens PhotoPrism needs for image requests
// (see fetchThumbBuffer/fetchOriginalBuffer below) so those stay plain,
// synchronous-looking calls instead of every photo request needing its own
// extra round trip first. Never throws - a misconfigured or unreachable
// PhotoPrism shouldn't prevent the server itself from starting, just leave
// photo access broken (loudly logged) until it's fixed and the server
// restarted.
export async function initPhotoPrism() {
  try {
    if (USERNAME && !STATIC_TOKEN) {
      await login();
      console.log(`PhotoPrism: logged in as ${USERNAME} at ${BASE_URL}`);
    }
    const config = await ppFetch("/api/v1/config");
    if (config.previewToken) previewToken = config.previewToken;
    if (config.downloadToken) downloadTokenCached = config.downloadToken;
  } catch (err) {
    console.error(
      `PhotoPrism setup failed (${err.message}) - photo browsing/import will not work until PHOTOPRISM_* in .env is fixed and the server restarted.`
    );
  }
}

// PhotoPrism has manually-curated "album" entries plus several auto-generated
// types (moment, month, folder, state, ...). We only surface "moment" here
// alongside manual albums - it's the one that's actually useful as a story
// starting point (a "Sweden 2022"-style country+year grouping); the others
// are either too broad (month/state) or too granular (one per folder) to be
// a sane album picker entry.
function mapAlbum(a, type) {
  return {
    uid: a.UID,
    title: a.Title,
    description: a.Description,
    photoCount: a.PhotoCount,
    year: a.Year,
    month: a.Month,
    day: a.Day,
    thumb: a.Thumb,
    type,
  };
}

export async function listAlbums({ count = 200 } = {}) {
  const [albums, moments] = await Promise.all([
    ppFetch(`/api/v1/albums?count=${count}&type=album`),
    ppFetch(`/api/v1/albums?count=${count}&type=moment`),
  ]);
  return [
    ...albums.map((a) => mapAlbum(a, "album")),
    ...moments.map((a) => mapAlbum(a, "moment")),
  ];
}

function mapPhoto(p) {
  return {
    uid: p.UID,
    title: p.Title,
    takenAt: p.TakenAt,
    lat: p.Lat,
    lng: p.Lng,
    placeLabel: p.PlaceLabel !== "Unknown" ? p.PlaceLabel : null,
    placeCity: p.PlaceCity !== "Unknown" ? p.PlaceCity : null,
    placeCountry: p.PlaceCountry,
    caption: p.Caption || "",
    width: p.Width,
    height: p.Height,
    thumbHash: p.Files?.[0]?.Hash ?? null,
  };
}

export async function getAlbumPhotos(albumUid, { count = 1000 } = {}) {
  const photos = await ppFetch(
    `/api/v1/photos?album=${albumUid}&count=${count}&order=oldest&merged=true`
  );
  return photos.map(mapPhoto);
}

// A custom snapshot across the whole library by date, for trips that don't
// fit a single album or PhotoPrism "moment" - e.g. one spanning New Year's
// (splits across two yearly moments) or a multi-country trip (splits across
// several country moments).
export async function getPhotosByDateRange(from, to, { count = 3000 } = {}) {
  const before = inclusiveBefore(to);
  const photos = await ppFetch(
    `/api/v1/photos?after=${from}&before=${before}&count=${count}&order=oldest&merged=true`
  );
  return photos.map(mapPhoto);
}

// --- Theme-based grouping (server/src/photoThemes.js) -----------------
//
// PhotoPrism already tags every photo with content Labels ("Zoo", "Dining",
// "Camping", ...) and, for anyone with face recognition set up, named
// Subjects ("Grandma", regardless of where/when the photo was taken) - see
// the "Story Builder — Content-aware Fotolayout" note for how Labels are
// already used for face-safe layout. Neither was ever surfaced to the photo
// *picker* before; these functions do that, cheaply: listLabels/
// listPersonSubjects fetch PhotoPrism's global catalogs (one request each,
// independent of how many photos exist), and countPhotosByLabel/
// countPhotosBySubject probe a single candidate against a date range using
// only the X-Count header - no photo data is transferred until a candidate
// is actually chosen.

export async function listLabels({ count = 500 } = {}) {
  // Without all=true, PhotoPrism only returns a curated subset (roughly:
  // labels with a non-negative Priority) and silently drops
  // location-derived ones - which is exactly where a label like "Zoo" (a
  // clear, meaningful theme) lives, since it comes from matching GPS
  // coordinates to a known place rather than image classification.
  const labels = await ppFetch(`/api/v1/labels?count=${count}&all=true`);
  return labels.map((l) => ({ slug: l.Slug, name: l.Name, photoCount: l.PhotoCount }));
}

export async function listPersonSubjects({ count = 300 } = {}) {
  const subjects = await ppFetch(`/api/v1/subjects?count=${count}`);
  return subjects
    .filter((s) => s.Type === "person")
    .map((s) => ({ uid: s.UID, name: s.Name, photoCount: s.PhotoCount }));
}

// PhotoPrism's X-Count header is capped at (and only ever equal to) however
// many rows this particular request actually returned - it's "how many did
// you give me", not an independent SELECT COUNT(*), so `count=1` always
// reports back 0 or 1 and never anything higher. To learn "does this
// candidate clear N photos", request `count=N` itself: a scoped total of N
// or more comes back as exactly N (the ceiling this call asked for), and
// anything less comes back as its real, true value.
export async function countPhotosByLabel(slug, from, to, sampleSize) {
  return ppFetchCount(
    `/api/v1/photos?label=${slug}&after=${from}&before=${inclusiveBefore(to)}&count=${sampleSize}`
  );
}

export async function countPhotosBySubject(uid, from, to, sampleSize) {
  return ppFetchCount(
    `/api/v1/photos?subject=${uid}&after=${from}&before=${inclusiveBefore(to)}&count=${sampleSize}`
  );
}

export async function getPhotosByLabel(slug, from, to, { count = 500 } = {}) {
  const photos = await ppFetch(
    `/api/v1/photos?label=${slug}&after=${from}&before=${inclusiveBefore(to)}&count=${count}&order=oldest&merged=true`
  );
  return photos.map(mapPhoto);
}

export async function getPhotosBySubject(uid, from, to, { count = 500 } = {}) {
  const photos = await ppFetch(
    `/api/v1/photos?subject=${uid}&after=${from}&before=${inclusiveBefore(to)}&count=${count}&order=oldest&merged=true`
  );
  return photos.map(mapPhoto);
}

// Full photo details (used for face markers, labels, capture time - see
// photoInsights.js), authenticated the same way as everything else here.
export async function getPhotoDetails(uid) {
  return ppFetch(`/api/v1/photos/${uid}`);
}

// Everything below is about photo *bytes*, not metadata, and the browser
// must never talk to PhotoPrism directly for them: a client only reachable
// on this server's LAN (the whole point of self-hosting PhotoPrism) can't
// load an <img src> pointing at it from an outside network, which is
// exactly what broke when this app was exposed at a public domain. So
// every photo URL this app ever hands to the browser is a path on *this*
// server (see the /api/photo/* routes in index.js); PhotoPrism's own
// base URL and tokens are used only in the functions below, which always
// run here, never in the browser.

// "fit_*" sizes scale to fit within a box, preserving the original aspect
// ratio; "tile_*" sizes are center-cropped squares. We want real aspect
// ratios for a varied, masonry-style gallery, so fit_* is the default.
export function thumbUrl(hash, size = "fit_720") {
  return `/api/photo/t/${hash}/${size}`;
}

// Original file download for print exports.
export function originalUrl(hash) {
  return `/api/photo/dl/${hash}`;
}

// The token segment PhotoPrism's own image routes need isn't a session
// credential - it's a long-lived, instance-wide value handed out via
// /api/v1/config (warmed by initPhotoPrism above). "public" is the value an
// instance actually uses in PhotoPrism's public/no-login mode, and remains
// the safe default here until/unless a real token is fetched.
let previewToken = "public";
let downloadTokenCached = "public";

async function fetchPhotoBytes(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`PhotoPrism image request failed: ${res.status} ${path}`);
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

// PhotoPrism hashes are 40-char sha1 hex; reject anything else before it
// goes into a URL path segment sent to PhotoPrism (this input reaches here
// straight from a request path param - see the /api/photo/* routes).
const HASH_RE = /^[0-9a-f]{4,64}$/;
const SIZE_RE = /^(fit|tile)_\d{2,4}$/;

// Fetches thumbnail/preview bytes for `hash` at `size` (a PhotoPrism size
// token, e.g. "fit_720") - the actual work behind the GET /api/photo/t/...
// route, and also used server-side wherever photo bytes are needed directly
// (face/object detection, AI captioning, the Saal photobook export).
export async function fetchThumbBuffer(hash, size = "fit_720") {
  if (!HASH_RE.test(hash)) throw new Error("Invalid photo hash");
  if (!SIZE_RE.test(size)) throw new Error("Invalid photo size");
  return fetchPhotoBytes(`/api/v1/t/${hash}/${previewToken}/${size}`);
}

// Fetches the original (full-resolution) file for `hash` - behind
// GET /api/photo/dl/... and the Saal export's print-quality downloads.
export async function fetchOriginalBuffer(hash) {
  if (!HASH_RE.test(hash)) throw new Error("Invalid photo hash");
  return fetchPhotoBytes(`/api/v1/dl/${hash}?t=${downloadTokenCached}`);
}
