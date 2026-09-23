async function json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const fetchAlbums = () => fetch("/api/albums").then(json);
export const fetchItinerary = (albumUids) =>
  fetch(`/api/albums/itinerary?uids=${albumUids.map(encodeURIComponent).join(",")}`).then(json);
export const fetchItineraryByDate = (from, to) =>
  fetch(`/api/itinerary/by-date?from=${from}&to=${to}`).then(json);

export const fetchThemeCandidates = (from, to) =>
  fetch(`/api/theme-candidates?from=${from}&to=${to}`).then(json);

export const fetchThemes = () => fetch("/api/themes").then(json);
export const fetchLanguages = () => fetch("/api/languages").then(json);
export const fetchPdfLayouts = () => fetch("/api/pdf-layouts").then(json);
export const fetchPdfPreviewHtml = (id, story) =>
  fetch(`/api/stories/${id}/pdf-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story }),
  }).then(async (res) => {
    if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
    return res.text();
  });

export const fetchStories = () => fetch("/api/stories").then(json);
export const fetchStory = (id) => fetch(`/api/stories/${id}`).then(json);

export const createStory = (payload) =>
  fetch("/api/stories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(json);

export const saveStory = (id, data) =>
  fetch(`/api/stories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(json);

export const deleteStory = (id) =>
  fetch(`/api/stories/${id}`, { method: "DELETE" }).then(json);

export const draftCaption = (storyId, stopId, photoId) =>
  fetch(`/api/stories/${storyId}/stops/${stopId}/photos/${photoId}/draft-caption`, {
    method: "POST",
  }).then(json);

export const researchPlace = (storyId, stopId) =>
  fetch(`/api/stories/${storyId}/stops/${stopId}/research`, {
    method: "POST",
  }).then(json);

export const interviewTurn = (storyId, stopId, history) =>
  fetch(`/api/stories/${storyId}/stops/${stopId}/interview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history }),
  }).then(json);

export const draftFromInterview = (storyId, stopId, history) =>
  fetch(`/api/stories/${storyId}/stops/${stopId}/interview/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history }),
  }).then(json);

export const importNotes = (storyId, { text, url }) =>
  fetch(`/api/stories/${storyId}/import-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, url }),
  }).then(json);

export const generateInfoCard = (storyId, stopId, placeName) =>
  fetch(`/api/stories/${storyId}/stops/${stopId}/info-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeName }),
  }).then(json);

export const fetchMatchingPhotos = (storyId, stopId, placeName) =>
  fetch(
    `/api/stories/${storyId}/stops/${stopId}/places/${encodeURIComponent(placeName)}/photos`
  ).then(json);

export const fetchBookProducts = () => fetch("/api/book-products").then(json);
export const fetchBookPreviewHtml = (id, story) =>
  fetch(`/api/stories/${id}/book-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story }),
  }).then(async (res) => {
    if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
    return res.text();
  });
export const startBookExport = (id, story) =>
  fetch(`/api/stories/${id}/book-export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story }),
  }).then(json);
export const fetchBookExport = (jobId) => fetch(`/api/book-exports/${jobId}`).then(json);
