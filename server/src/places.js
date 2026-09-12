// PhotoPrism auto-generates a photo Title from whatever it's most confident
// about: a recognized person's name, a specific named place/landmark (from
// reverse geocoding to a POI, e.g. "Ladonien" or "Kullamannens Grav"), or a
// generic scene/content label ("Portrait", "Landscape") when nothing more
// specific was found. The title's first "/"-separated segment carries that.
// This list is the common generic content labels we've seen in practice -
// not exhaustive (PhotoPrism's classifier has ~2000 possible labels), but
// filters most of the noise cheaply. Person names mostly slip through this
// and just show up as an occasional odd suggestion chip the user can
// ignore - simpler and more honest than trying to guess who's a person.
const GENERIC_LABELS = new Set(
  [
    "portrait",
    "people",
    "person",
    "moment",
    "outdoor",
    "indoor",
    "landscape",
    "nature",
    "seashore",
    "animal",
    "architecture",
    "bike",
    "bicycle",
    "farm",
    "camping",
    "food",
    "vehicle",
    "car",
    "building",
    "interior",
    "group",
    "sunset",
    "sunrise",
    "beach",
    "forest",
    "mountain",
    "lake",
    "river",
    "sky",
    "water",
    "tree",
    "plant",
    "flower",
    "cloud",
    "night",
    "snow",
    "winter",
    "summer",
    "selfie",
    "family",
    "travel",
    "vacation",
    "holiday",
  ].map((s) => s.toLowerCase())
);

function titleSubject(title) {
  return (title || "").split("/")[0].trim();
}

// "Strandbaden, Höganäs, Sweden" -> "Strandbaden"; "Höganäs, Sweden" ->
// "Höganäs". Takes the most specific (first) part of a PlaceLabel so it
// merges with the same name however it turned up (title subject or place
// label), instead of "Höganäs" and "Höganäs, Sweden" showing as two chips.
function primaryName(label) {
  return label.split(",")[0].trim();
}

// photos: [{ title, placeLabel, placeCity }] for a stop's included photos.
// Returns place-name candidates worth suggesting an info card for, ranked
// by how often they show up, broadest (the stop's own place) first.
export function suggestPlacesForStop(photos) {
  const counts = new Map(); // lowercase key -> { name, count }

  function bump(name) {
    if (!name) return;
    const key = primaryName(name);
    if (!key || key.length < 2) return;
    const lower = key.toLowerCase();
    const existing = counts.get(lower);
    if (existing) existing.count += 1;
    else counts.set(lower, { name: key, count: 1 });
  }

  for (const p of photos) {
    bump(p.placeLabel);
    const subject = titleSubject(p.title);
    // Titles combine multiple people with "&"/"," - not a place either way.
    if (subject && !GENERIC_LABELS.has(subject.toLowerCase()) && !/[,&]/.test(subject)) {
      bump(subject);
    }
  }

  const minCount = photos.length >= 5 ? 2 : 1;
  return [...counts.values()]
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .map((c) => c.name)
    .slice(0, 6);
}
