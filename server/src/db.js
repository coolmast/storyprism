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
    theme TEXT NOT NULL DEFAULT 'coastal',
    content_language TEXT NOT NULL DEFAULT 'en',
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
    research TEXT NOT NULL DEFAULT '',
    pull_quote TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stop_photos (
    id TEXT PRIMARY KEY,
    stop_id TEXT NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    photo_uid TEXT NOT NULL,
    hash TEXT,
    width INTEGER,
    height INTEGER,
    position INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    included INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    place_label TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stop_info_cards (
    id TEXT PRIMARY KEY,
    stop_id TEXT NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    place_name TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    facts TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL,
    placement TEXT NOT NULL DEFAULT 'top',
    hero_photo_hash TEXT,
    website_url TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stop_embeds (
    id TEXT PRIMARY KEY,
    stop_id TEXT NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stops_story ON stops(story_id);
  CREATE INDEX IF NOT EXISTS idx_stop_photos_stop ON stop_photos(stop_id);
  CREATE INDEX IF NOT EXISTS idx_stop_embeds_stop ON stop_embeds(stop_id);
  CREATE INDEX IF NOT EXISTS idx_stop_info_cards_stop ON stop_info_cards(stop_id);
`);

// "CREATE TABLE IF NOT EXISTS" above only helps on a brand-new database -
// once real stories exist (as they now do), adding a column to that
// statement is a no-op against the already-created table, and every insert
// referencing the new column would start failing with "no such column".
// This is the lightweight alternative to a real migration framework: add
// any new column that's missing from an existing table. Idempotent, so
// it's safe to call unconditionally on every startup.
function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("stop_info_cards", "website_url", "TEXT NOT NULL DEFAULT ''");
ensureColumn("stories", "pdf_layout_pack", "TEXT NOT NULL DEFAULT 'classic'");
ensureColumn("stories", "pdf_paper_size", "TEXT NOT NULL DEFAULT 'a4-portrait'");
// NULL means "automatic" - the story's pack decides this stop's photo
// layout. Non-NULL pins every photo page for this stop to one template.
ensureColumn("stops", "pdf_template_override", "TEXT");
ensureColumn("stories", "book_product", "TEXT NOT NULL DEFAULT 'saal-square-28'");
ensureColumn("stops", "book_layout_override", "TEXT");
ensureColumn("stops", "book_spread_counts", "TEXT");
