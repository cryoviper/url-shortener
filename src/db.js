import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDb(file = process.env.DB_FILE || "data/links.db") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id          INTEGER PRIMARY KEY,
      slug        TEXT    NOT NULL UNIQUE,
      url         TEXT    NOT NULL,
      token_hash  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS clicks (
      id        INTEGER PRIMARY KEY,
      link_id   INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      at        TEXT    NOT NULL DEFAULT (datetime('now')),
      referrer  TEXT,
      device    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clicks_link_at ON clicks(link_id, at);
  `);

  // Prepared statements: parameters are bound, never concatenated (no SQL injection).
  const q = {
    insert: db.prepare("INSERT INTO links (slug, url, token_hash) VALUES (?, ?, ?)"),
    bySlug: db.prepare("SELECT * FROM links WHERE slug = ?"),
    del: db.prepare("DELETE FROM links WHERE id = ?"),
    click: db.prepare("INSERT INTO clicks (link_id, referrer, device) VALUES (?, ?, ?)"),
    total: db.prepare("SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?"),
    perDay: db.prepare(`
      SELECT date(at) AS day, COUNT(*) AS n FROM clicks
      WHERE link_id = ? AND at >= datetime('now', ?)
      GROUP BY day ORDER BY day`),
    referrers: db.prepare(`
      SELECT COALESCE(referrer, 'Direct') AS name, COUNT(*) AS n FROM clicks
      WHERE link_id = ? GROUP BY name ORDER BY n DESC LIMIT 5`),
    devices: db.prepare(`
      SELECT device AS name, COUNT(*) AS n FROM clicks
      WHERE link_id = ? GROUP BY device ORDER BY n DESC`),
    last: db.prepare("SELECT MAX(at) AS at FROM clicks WHERE link_id = ?"),
  };
  return { db, q };
}
