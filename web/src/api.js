export async function fetchAlbums() {
  const res = await fetch("/api/albums");
  if (!res.ok) throw new Error("Failed to load albums");
  return res.json();
}

export async function fetchItinerary(albumUid) {
  const res = await fetch(`/api/albums/${albumUid}/itinerary`);
  if (!res.ok) throw new Error("Failed to load itinerary");
  return res.json();
}
