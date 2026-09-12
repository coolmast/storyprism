const BASE_URL = process.env.PHOTOPRISM_BASE_URL;

if (!BASE_URL) {
  throw new Error("PHOTOPRISM_BASE_URL is not set");
}

async function ppFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`PhotoPrism request failed: ${res.status} ${path}`);
  }
  return res.json();
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
// several country moments). PhotoPrism's "before" bound is exclusive of the
// date itself, so bump it by a day to make the user's "to" date inclusive of
// that whole day.
export async function getPhotosByDateRange(from, to, { count = 3000 } = {}) {
  const beforeDate = new Date(`${to}T00:00:00Z`);
  beforeDate.setUTCDate(beforeDate.getUTCDate() + 1);
  const before = beforeDate.toISOString().slice(0, 10);

  const photos = await ppFetch(
    `/api/v1/photos?after=${from}&before=${before}&count=${count}&order=oldest&merged=true`
  );
  return photos.map(mapPhoto);
}

// "fit_*" sizes scale to fit within a box, preserving the original aspect
// ratio; "tile_*" sizes are center-cropped squares. We want real aspect
// ratios for a varied, masonry-style gallery, so fit_* is the default.
export function thumbUrl(hash, size = "fit_720") {
  return `${BASE_URL}/api/v1/t/${hash}/public/${size}`;
}
