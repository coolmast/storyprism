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

export async function listAlbums({ count = 200 } = {}) {
  const albums = await ppFetch(`/api/v1/albums?count=${count}&type=album`);
  return albums.map((a) => ({
    uid: a.UID,
    title: a.Title,
    description: a.Description,
    photoCount: a.PhotoCount,
    year: a.Year,
    month: a.Month,
    day: a.Day,
    thumb: a.Thumb,
  }));
}

export async function getAlbumPhotos(albumUid, { count = 1000 } = {}) {
  const photos = await ppFetch(
    `/api/v1/photos?album=${albumUid}&count=${count}&order=oldest&merged=true`
  );
  return photos.map((p) => ({
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
  }));
}

// "fit_*" sizes scale to fit within a box, preserving the original aspect
// ratio; "tile_*" sizes are center-cropped squares. We want real aspect
// ratios for a varied, masonry-style gallery, so fit_* is the default.
export function thumbUrl(hash, size = "fit_720") {
  return `${BASE_URL}/api/v1/t/${hash}/public/${size}`;
}
