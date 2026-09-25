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

  -- Per-photo facts from PhotoPrism used for photobook layout (faces with
  -- positions, labels, capture time, quality); cached, keyed by photo UID.
  CREATE TABLE IF NOT EXISTS photo_insights (
    photo_uid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
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
ensureColumn("stories", "book_layout_pack", "TEXT NOT NULL DEFAULT 'photobook'");
ensureColumn("stops", "book_layout_override", "TEXT");
ensureColumn("stops", "book_spread_counts", "TEXT");
ensureColumn("stories", "book_title_font", "TEXT");
ensureColumn("stories", "book_body_font", "TEXT");
ensureColumn("stories", "book_keep_bursts", "INTEGER NOT NULL DEFAULT 0");
// Photobook: text parts left out of the book, and text size multipliers.
ensureColumn("stories", "book_hide_intro", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stories", "book_hide_outro", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stops", "book_hide_text", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stop_info_cards", "book_hidden", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("stories", "book_title_scale", "REAL NOT NULL DEFAULT 1");
ensureColumn("stories", "book_body_scale", "REAL NOT NULL DEFAULT 1");
// The query that created this story - re-run later by "check for new
// photos" (storyUpdate.js) to pull in anything imported to PhotoPrism
// since. Empty on stories from before this shipped, which just hides that
// button rather than guessing at a source. source_config is JSON: album
// UIDs, a date range, or a theme plan - whatever that source_type's create
// function originally took as its own arguments.
ensureColumn("stories", "source_type", "TEXT NOT NULL DEFAULT ''");
ensureColumn("stories", "source_config", "TEXT NOT NULL DEFAULT ''");
// Set only for a "Nach Themen" story's stops - the originating theme's own
// id (a label slug, subject UID, trip id, or "leftover-YYYY-MM" for a
// monthly bucket), stable across re-runs of the same theme plan. Lets an
// update match a freshly recomputed theme group back to the existing stop
// holding that theme's edits, the same way a chronological story's stops
// are matched by time range instead.
ensureColumn("stops", "theme_id", "TEXT");
// Per-photo: whether this photo's caption should be typeset into the
// printed photobook (Saal/CEWE) next to it - defaults off for every photo,
// toggled on individually (IncludedPhotoGrid.jsx). Unrelated to the web
// view/deck, which already show every caption unconditionally.
ensureColumn("stop_photos", "book_show_caption", "INTEGER NOT NULL DEFAULT 0");
// Where an info card's own spread lands among its stop's *photo* spreads in
// the photobook, as a fraction (0 = right after the chapter opener, 1 = at
// the very end) - free placement instead of the old fixed top/middle/end
// three-way choice. NULL means "never set" - an old card falls back to a
// placement-derived equivalent (bookPlanner.js) rather than silently
// jumping to a new spot.
ensureColumn("stop_info_cards", "photo_position", "REAL");
// A specific photo to use as the chapter opener's full-bleed backdrop for
// this stop, instead of the automatically best-scoring one - the same idea
// as an info card's own hero photo, just for the stop's chapter spread.
// NULL means "automatic" (the existing backdropScore-based pick).
ensureColumn("stops", "book_chapter_backdrop_hash", "TEXT");
