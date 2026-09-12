import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "story-builder.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    album_uid TEXT NOT NULL,
    album_title TEXT NOT NULL,
    title TEXT NOT NULL,
    intro TEXT NOT NULL DEFAULT '',
    outro TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stops (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    lat REAL,
    lng REAL,
    place_label TEXT,
    started_at TEXT,
    ended_at TEXT,
    heading TEXT NOT NULL DEFAULT '',
    narrative TEXT NOT NULL DEFAULT '',
    research TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stop_photos (
    id TEXT PRIMARY KEY,
    stop_id TEXT NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    photo_uid TEXT NOT NULL,
    thumb_url TEXT,
    position INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    included INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_stops_story ON stops(story_id);
  CREATE INDEX IF NOT EXISTS idx_stop_photos_stop ON stop_photos(stop_id);
`);
