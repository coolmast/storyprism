import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { getAlbumPhotos, getPhotosByDateRange } from "./photoprism.js";
import { buildItinerary } from "./itinerary.js";
import { planThemeStops, getStory, curatedIncluded } from "./stories.js";

// "Check for new photos": re-runs the query that created a story (stored as
// source_type/source_config, see db.js) and merges in whatever now matches
// but didn't before - almost always photos imported to PhotoPrism after the
// story was started, still within the same trip's date range or album.
//
// Deliberately additive only: a photo already in the story is never
// touched, even if it no longer matches the source (removed from an album,
// say) - same "nothing silently dropped" rule the yearbook mode already
// follows, just in the other direction ("nothing silently added twice, or
// silently removed"). A photo the user already excluded via the include
// toggle is still "in the story" as far as this is concerned (its row still
// exists), so it's never re-added or re-included behind their back.
//
// The hard part isn't finding new photos, it's putting them somewhere
// without disturbing the narrative/heading/reordering work already done on
// every *other* stop. Re-clustering the whole photo set from scratch (old +
// new) the way creation does would recompute stop boundaries from zero and
// scramble that mapping. Instead, a stop is only ever touched if a new
// photo actually belongs in it, and untouched stops get zero writes:
//   - chronological stories (albums/date_range): a new photo whose taken-at
//     falls inside an existing stop's [startedAt, endedAt] joins that stop;
//     anything left over is clustered on its own (buildItinerary, the same
//     function creation uses) and spliced in as new stops at the right
//     chronological position.
//   - "Nach Themen" stories: matched by theme_id instead of by time - each
//     stop created from a theme plan carries the id of the theme (or
//     "leftover-YYYY-MM" bucket) that produced it, so re-running the exact
//     same theme plan and matching by that id gives the same "append new
//     UIDs to a matched stop, insert a stop for a newly-qualifying theme"
//     behavior with no separate design needed.

const insertPhotoRow = db.prepare(`
  INSERT INTO stop_photos (id, stop_id, photo_uid, hash, width, height, position, caption, included, title, place_label)
  VALUES (@id, @stopId, @photoUid, @hash, @width, @height, @position, '', @included, @title, @placeLabel)
`);
const insertStopRow = db.prepare(`
  INSERT INTO stops (id, story_id, position, lat, lng, place_label, started_at, ended_at, heading, narrative, theme_id)
  VALUES (@id, @storyId, @position, @lat, @lng, @placeLabel, @startedAt, @endedAt, @heading, '', @themeId)
`);

async function mergeAlbumPhotos(albumUids) {
  const lists = await Promise.all(albumUids.map((uid) => getAlbumPhotos(uid)));
  const seen = new Set();
  const photos = [];
  for (const list of lists) {
    for (const p of list) {
      if (seen.has(p.uid)) continue;
      seen.add(p.uid);
      photos.push(p);
    }
  }
  return photos;
}

// Writes a stop's final, freshly-sorted photo list: an already-known uid
// (has an `existingRowId`) just gets repositioned, a new one gets a fresh
// row. `curate` applies the same "not everything included" pre-selection a
// freshly-created story's own stops get (curatedIncluded, stories.js) -
// used for a brand-new stop, which is in exactly that situation. A handful
// of photos trickling into an already-curated *existing* stop is a smaller,
// different event - those are simply included, matching how this feature
// was scoped.
function writeStopPhotos(stopId, sortedPhotos, { curate = false } = {}) {
  sortedPhotos.forEach((p, position) => {
    if (p.existingRowId) {
      db.prepare("UPDATE stop_photos SET position = ? WHERE id = ?").run(position, p.existingRowId);
    } else {
      insertPhotoRow.run({
        id: randomUUID(),
        stopId,
        photoUid: p.uid,
        hash: p.thumbHash,
        width: p.width || null,
        height: p.height || null,
        position,
        included: curate ? (curatedIncluded(sortedPhotos.length, position) ? 1 : 0) : 1,
        title: p.title || "",
        placeLabel: p.placeLabel || "",
      });
    }
  });
}

function insertNewStop(storyId, draft, position) {
  const stopId = randomUUID();
  insertStopRow.run({
    id: stopId,
    storyId,
    position,
    lat: draft.lat,
    lng: draft.lng,
    placeLabel: draft.placeCity || draft.placeLabel || null,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    heading: draft.placeCity || draft.placeLabel || "New section",
    themeId: draft.themeId || null,
  });
  writeStopPhotos(
    stopId,
    draft.photos.map((p) => ({ ...p })),
    { curate: true }
  );
}

// Renumbers every stop's `position` to match `order` (a mix of existing
// stop ids and freshly-planned stop drafts) and inserts the drafts. Cheap
// and safe to do unconditionally, even for stops nothing else changed on -
// it only ever rewrites an integer column, never anything the user edited.
function applyStopOrder(storyId, order) {
  order.forEach((entry, position) => {
    if (entry.existingId) {
      db.prepare("UPDATE stops SET position = ? WHERE id = ?").run(position, entry.existingId);
    } else {
      insertNewStop(storyId, entry.draft, position);
    }
  });
}

// Shared by "check for new photos" (re-runs the story's *stored* themes
// list unchanged) and addThemeToStory (re-runs it with one theme just
// appended) - either way, this is "given this exact theme list, make the
// story's stops match it," never touching a stop nothing in the list
// affects.
async function reconcileThemePlan(storyId, config, existingStops, existingRows) {
  let newPhotoCount = 0;
  const touchedStopIds = new Set();
  let newStopCount = 0;

  const freshGroups = await planThemeStops(config);
  const existingByThemeId = new Map(existingStops.filter((s) => s.themeId).map((s) => [s.themeId, s]));
  const rowsByStop = new Map();
  for (const r of existingRows) {
    if (!rowsByStop.has(r.stopId)) rowsByStop.set(r.stopId, new Set());
    rowsByStop.get(r.stopId).add(r.photoUid);
  }

  const order = existingStops.map((s) => ({ existingId: s.id }));
  const commit = db.transaction(() => {
    freshGroups.forEach((group, i) => {
      const match = existingByThemeId.get(group.themeId);
      if (match) {
        const known = rowsByStop.get(match.id) || new Set();
        const fresh = group.photos.filter((p) => !known.has(p.uid));
        if (fresh.length === 0) return;
        newPhotoCount += fresh.length;
        touchedStopIds.add(match.id);
        // Appended after the stop's existing photos, not re-sorted in
        // among them: a theme stop's photo set can be an evenly-sampled
        // subset capped at MAX_THEME_STOP_PHOTOS (stories.js), and
        // re-running that sample against a now-larger candidate pool can
        // legitimately pick different representative photos than last
        // time - reconciling the *whole* set against that shifting sample
        // risked quietly reshuffling or dropping already-placed photos.
        // Only ever adding whatever's genuinely new to *this* stop keeps
        // every existing photo and its position exactly as the user left
        // it, at the cost of a still-growing theme not always surfacing
        // every single new import the moment it lands (only whichever
        // ones this run's sample happens to surface) - an honest
        // limitation, not silent data loss.
        fresh.forEach((p, i) => {
          insertPhotoRow.run({
            id: randomUUID(),
            stopId: match.id,
            photoUid: p.uid,
            hash: p.thumbHash,
            width: p.width || null,
            height: p.height || null,
            position: known.size + i,
            included: 1,
            title: p.title || "",
            placeLabel: p.placeLabel || "",
          });
        });
        return;
      }
      // A theme that just now cleared the photo threshold, or a month
      // that just got its first photo - insert after whichever earlier
      // theme (in the plan's own order) already has a stop, so it lands
      // somewhere sensible relative to the user's current arrangement
      // rather than always at the very end.
      newStopCount += 1;
      newPhotoCount += group.photos.length;
      let anchorId = null;
      for (let j = i - 1; j >= 0; j--) {
        const m = existingByThemeId.get(freshGroups[j].themeId);
        if (m) {
          anchorId = m.id;
          break;
        }
      }
      const at = anchorId ? order.findIndex((e) => e.existingId === anchorId) + 1 : 0;
      order.splice(at, 0, { draft: group });
    });
    applyStopOrder(storyId, order);
  });
  commit();
  return { newPhotoCount, updatedStopCount: touchedStopIds.size, newStopCount };
}

function loadExistingStopState(storyId) {
  const existingStops = db
    .prepare("SELECT id, started_at as startedAt, ended_at as endedAt, theme_id as themeId FROM stops WHERE story_id = ? ORDER BY position")
    .all(storyId);
  const existingRows = db
    .prepare(
      `SELECT sp.id, sp.photo_uid as photoUid, sp.stop_id as stopId
       FROM stop_photos sp JOIN stops st ON st.id = sp.stop_id
       WHERE st.story_id = ?`
    )
    .all(storyId);
  return { existingStops, existingRows };
}

// Adds one theme to a "Nach Themen" story's source_config.themes and
// reconciles the story against the new (longer) list via the same
// reconcileThemePlan checkStoryUpdates uses - the only difference from a
// plain "check for new photos" run is that the list being re-run against is
// one theme longer than what's currently stored. Idempotent on theme.id: an
// "Add remaining" click after an earlier one, or a double-submit, just
// re-reconciles the same list instead of appending a duplicate.
export async function addThemeToStory(storyId, theme) {
  const raw = db.prepare("SELECT * FROM stories WHERE id = ?").get(storyId);
  if (!raw) throw new Error("Story not found");
  if (raw.source_type !== "theme_plan") throw new Error("This story isn't a yearbook, so it can't have theme sections added.");
  const config = JSON.parse(raw.source_config || "{}");

  if (!config.themes.some((t) => t.id === theme.id)) {
    config.themes = [...config.themes, theme];
    db.prepare("UPDATE stories SET source_config = ? WHERE id = ?").run(JSON.stringify(config), storyId);
  }

  const { existingStops, existingRows } = loadExistingStopState(storyId);
  const result = await reconcileThemePlan(storyId, config, existingStops, existingRows);

  if (result.newPhotoCount > 0) {
    db.prepare("UPDATE stories SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), storyId);
  }

  return { summary: result, story: getStory(storyId) };
}

export async function checkStoryUpdates(storyId) {
  const raw = db.prepare("SELECT * FROM stories WHERE id = ?").get(storyId);
  if (!raw) throw new Error("Story not found");
  if (!raw.source_type) throw new Error("This story wasn't created from a saved search, so it can't check for new photos.");
  const config = JSON.parse(raw.source_config || "{}");

  const { existingStops, existingRows } = loadExistingStopState(storyId);
  const existingUidToRow = new Map(existingRows.map((r) => [r.photoUid, r]));

  let newPhotoCount = 0;
  let updatedStopCount = 0;
  let newStopCount = 0;
  const touchedStopIds = new Set();

  if (raw.source_type === "theme_plan") {
    const result = await reconcileThemePlan(storyId, config, existingStops, existingRows);
    newPhotoCount = result.newPhotoCount;
    updatedStopCount = result.updatedStopCount;
    newStopCount = result.newStopCount;
  } else {
    const candidates =
      raw.source_type === "albums" ? await mergeAlbumPhotos(config.albumUids) : await getPhotosByDateRange(config.from, config.to);
    const candidateByUid = new Map(candidates.map((p) => [p.uid, p]));

    const newByStop = new Map();
    const unassignedNew = [];
    for (const photo of candidates) {
      if (existingUidToRow.has(photo.uid)) continue;
      const t = new Date(photo.takenAt).getTime();
      const hit = existingStops.find(
        (s) => s.startedAt && s.endedAt && t >= new Date(s.startedAt).getTime() && t <= new Date(s.endedAt).getTime()
      );
      if (hit) {
        if (!newByStop.has(hit.id)) newByStop.set(hit.id, []);
        newByStop.get(hit.id).push(photo);
      } else {
        unassignedNew.push(photo);
      }
    }

    const newStopDrafts = unassignedNew.length ? buildItinerary(unassignedNew) : [];
    newStopCount = newStopDrafts.length;

    const order = existingStops.map((s) => ({ existingId: s.id, startedAt: s.startedAt }));
    for (const draft of newStopDrafts) {
      newPhotoCount += draft.photos.length;
      const t = new Date(draft.startedAt).getTime();
      let at = order.length;
      for (let i = 0; i < order.length; i++) {
        if (order[i].startedAt && new Date(order[i].startedAt).getTime() > t) {
          at = i;
          break;
        }
      }
      order.splice(at, 0, { draft, startedAt: draft.startedAt });
    }

    const run = db.transaction(() => {
      for (const [stopId, newPhotos] of newByStop) {
        newPhotoCount += newPhotos.length;
        touchedStopIds.add(stopId);
        // Reconstruct the stop's full intended order from `candidates`,
        // which - unlike the stored rows - still has every photo's taken-at.
        // A previously-known photo that dropped out of the source entirely
        // (removed from its album, say) keeps whatever position it already
        // had rather than being force-fit into this resort; rare enough,
        // and non-destructive, not to be worth a special case beyond that.
        const oldUids = existingRows.filter((r) => r.stopId === stopId).map((r) => r.photoUid).filter((u) => candidateByUid.has(u));
        const merged = [
          ...oldUids.map((uid) => ({ ...candidateByUid.get(uid), existingRowId: existingUidToRow.get(uid).id })),
          ...newPhotos,
        ].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
        writeStopPhotos(stopId, merged);
      }
      applyStopOrder(storyId, order);
    });
    run();
    updatedStopCount = touchedStopIds.size;
  }

  if (newPhotoCount > 0) {
    db.prepare("UPDATE stories SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), storyId);
  }

  return {
    summary: { newPhotoCount, updatedStopCount, newStopCount },
    story: getStory(storyId),
  };
}
