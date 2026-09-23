const EARTH_RADIUS_M = 6371000;
const NEW_STOP_TIME_GAP_MS = 3 * 60 * 60 * 1000; // 3h with no photos -> likely moved on
const NEW_STOP_DISTANCE_M = 2000; // >2km from the running stop centroid -> new stop

export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Groups a time-ordered list of photos into itinerary "stops" using gaps in
// time and distance between consecutive geotagged photos. Photos without
// GPS are attached to whichever stop their timestamp falls into.
export function buildItinerary(photos) {
  const sorted = [...photos].sort(
    (a, b) => new Date(a.takenAt) - new Date(b.takenAt)
  );

  const stops = [];
  let current = null;

  for (const photo of sorted) {
    const hasGps = photo.lat !== 0 && photo.lng !== 0;

    if (current && hasGps && current.lat != null) {
      const timeGap = new Date(photo.takenAt) - current.lastTakenAt;
      const dist = haversine(current.lat, current.lng, photo.lat, photo.lng);
      if (timeGap > NEW_STOP_TIME_GAP_MS && dist > NEW_STOP_DISTANCE_M) {
        current = null;
      }
    }

    if (!current) {
      current = {
        photos: [],
        lat: hasGps ? photo.lat : null,
        lng: hasGps ? photo.lng : null,
        placeLabel: photo.placeLabel,
        placeCity: photo.placeCity,
        startedAt: photo.takenAt,
        lastTakenAt: new Date(photo.takenAt),
      };
      stops.push(current);
    }

    current.photos.push(photo);
    current.lastTakenAt = new Date(photo.takenAt);
    current.endedAt = photo.takenAt;
    if (hasGps && current.lat == null) {
      current.lat = photo.lat;
      current.lng = photo.lng;
      current.placeLabel = photo.placeLabel;
      current.placeCity = photo.placeCity;
    }
  }

  return stops.map((s, i) => ({
    index: i,
    lat: s.lat,
    lng: s.lng,
    placeLabel: s.placeLabel,
    placeCity: s.placeCity,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    photoCount: s.photos.length,
    photos: s.photos,
  }));
}
