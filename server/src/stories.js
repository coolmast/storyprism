import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { listAlbums, getAlbumPhotos, thumbUrl } from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";

const insertStory = db.prepare(`
  INSERT INTO stories (id, album_uid, album_title, title, intro, outro, created_at, updated_at)
  VALUES (@id, @albumUid, @albumTitle, @title, '', '', @now, @now)
`);
const insertStop = db.prepare(`
  INSERT INTO stops (id, story_id, position, lat, lng, place_label, started_at, ended_at, heading, narrative)
  VALUES (@id, @storyId, @position, @lat, @lng, @placeLabel, @startedAt, @endedAt, @heading, '')
`);
const insertPhoto = db.prepare(`
  INSERT INTO stop_photos (id, stop_id, photo_uid, hash, width, height, position, caption, included)
  VALUES (@id, @stopId, @photoUid, @hash, @width, @height, @position, '', @included)
`);

export async function createStoryFromAlbum(albumUid) {
  const albums = await listAlbums();
  const album = albums.find((a) => a.uid === albumUid);
  if (!album) throw new Error("Album not found");

  const photos = await getAlbumPhotos(albumUid);
  const stops = buildItinerary(photos);

  const storyId = randomUUID();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    insertStory.run({ id: storyId, albumUid, albumTitle: album.title, title: album.title, now });

    stops.forEach((stop, i) => {
      const stopId = randomUUID();
      insertStop.run({
        id: stopId,
        storyId,
        position: i,
        lat: stop.lat,
        lng: stop.lng,
        placeLabel: stop.placeCity || stop.placeLabel || null,
        startedAt: stop.startedAt,
        endedAt: stop.endedAt,
        heading: stop.placeCity || stop.placeLabel || `Stop ${i + 1}`,
      });
      // Stops from a real trip can have 50-100+ photos; defaulting all of
      // them to "included" would make the editor an unusable wall of
      // caption boxes. Pre-select a spread across the stop's time range so
      // the story starts curated, and let the user add more.
      const CURATED_PER_STOP = 20;
      const step = Math.max(1, Math.floor(stop.photos.length / CURATED_PER_STOP));

      stop.photos.forEach((p, j) => {
        insertPhoto.run({
          id: randomUUID(),
          stopId,
          photoUid: p.uid,
          hash: p.thumbHash,
          width: p.width || null,
          height: p.height || null,
          position: j,
          included: j % step === 0 ? 1 : 0,
        });
      });
    });
  });
  tx();

  return getStory(storyId);
}

export function listStories() {
  return db
    .prepare(
      `SELECT s.id, s.album_uid as albumUid, s.album_title as albumTitle, s.title,
              s.updated_at as updatedAt,
              (SELECT COUNT(*) FROM stops WHERE story_id = s.id) as stopCount
       FROM stories s ORDER BY s.updated_at DESC`
    )
    .all();
}

export function getStory(id) {
  const story = db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  if (!story) return null;

  const stops = db
    .prepare("SELECT * FROM stops WHERE story_id = ? ORDER BY position")
    .all(id);

  const photoStmt = db.prepare(
    "SELECT * FROM stop_photos WHERE stop_id = ? ORDER BY position"
  );

  return {
    id: story.id,
    albumUid: story.album_uid,
    albumTitle: story.album_title,
    title: story.title,
    intro: story.intro,
    outro: story.outro,
    createdAt: story.created_at,
    updatedAt: story.updated_at,
    stops: stops.map((s) => ({
      id: s.id,
      position: s.position,
      lat: s.lat,
      lng: s.lng,
      placeLabel: s.place_label,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      heading: s.heading,
      narrative: s.narrative,
      research: s.research,
      photos: photoStmt.all(s.id).map((p) => ({
        id: p.id,
        photoUid: p.photo_uid,
        thumbUrl: p.hash ? thumbUrl(p.hash, "fit_720") : null,
        fullUrl: p.hash ? thumbUrl(p.hash, "fit_2048") : null,
        width: p.width,
        height: p.height,
        position: p.position,
        caption: p.caption,
        included: !!p.included,
      })),
    })),
  };
}

const updateStoryStmt = db.prepare(
  "UPDATE stories SET title = @title, intro = @intro, outro = @outro, updated_at = @now WHERE id = @id"
);
const updateStopStmt = db.prepare(
  "UPDATE stops SET heading = @heading, narrative = @narrative, research = @research WHERE id = @id AND story_id = @storyId"
);
const updatePhotoStmt = db.prepare(
  "UPDATE stop_photos SET caption = @caption, included = @included WHERE id = @id AND stop_id = @stopId"
);
const touchStoryStmt = db.prepare("UPDATE stories SET updated_at = @now WHERE id = @id");

export function updateStory(id, data) {
  const existing = getStory(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    updateStoryStmt.run({
      id,
      title: data.title ?? existing.title,
      intro: data.intro ?? existing.intro,
      outro: data.outro ?? existing.outro,
      now,
    });

    for (const stop of data.stops ?? []) {
      updateStopStmt.run({
        id: stop.id,
        storyId: id,
        heading: stop.heading ?? "",
        narrative: stop.narrative ?? "",
        research: stop.research ?? "",
      });
      for (const photo of stop.photos ?? []) {
        updatePhotoStmt.run({
          id: photo.id,
          stopId: stop.id,
          caption: photo.caption ?? "",
          included: photo.included === false ? 0 : 1,
        });
      }
    }
    touchStoryStmt.run({ id, now });
  });
  tx();

  return getStory(id);
}

export function deleteStory(id) {
  return db.prepare("DELETE FROM stories WHERE id = ?").run(id).changes > 0;
}
