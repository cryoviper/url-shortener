import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import QRCode from "qrcode";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes (l, 1, O, 0)
const RESERVED = new Set(["api", "assets", "stats", "admin", "health", "index", "favicon"]);
const SLUG_RE = /^[a-zA-Z0-9_-]{3,32}$/;

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function randomSlug(len = 6) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function normalizeUrl(input, selfHost) {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw || raw.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null; // blocks javascript:, data:, file:
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  if (selfHost && u.host === selfHost) return null; // no redirect loops
  return u.toString();
}

function deviceOf(ua = "") {
  if (/bot|crawler|spider|preview/i.test(ua)) return "Bot";
  if (/ipad|tablet/i.test(ua)) return "Tablet";
  if (/mobi|android|iphone/i.test(ua)) return "Mobile";
  return "Desktop";
}
function referrerOf(ref = "") {
  try {
    return ref ? new URL(ref).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export function createApp({ dbFile, rateLimitMax = 30 } = {}) {
  const { q } = openDb(dbFile);
  const app = express();
  app.set("trust proxy", 1); // behind Render/Fly proxies, so rate limits see the real IP
  app.use(helmet());
  app.use(express.json({ limit: "10kb" }));

  const createLimiter = rateLimit({ windowMs: 60_000, limit: rateLimitMax, standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "Too many links created. Wait a minute and try again." } });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Create a short link
  app.post("/api/links", createLimiter, (req, res) => {
    const url = normalizeUrl(req.body?.url, req.get("host"));
    if (!url) return res.status(400).json({ error: "Enter a valid http(s) link, like https://example.com/page" });

    let slug = req.body?.slug?.trim();
    if (slug) {
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "Custom alias must be 3–32 letters, numbers, - or _" });
      if (RESERVED.has(slug.toLowerCase())) return res.status(400).json({ error: "That alias is reserved. Pick another." });
      if (q.bySlug.get(slug)) return res.status(409).json({ error: "That alias is already taken." });
    } else {
      do slug = randomSlug(); while (q.bySlug.get(slug));
    }

    // The manage token is shown once; only its hash is stored.
    const token = crypto.randomBytes(18).toString("base64url");
    q.insert.run(slug, url, sha256(token));
    const base = `${req.protocol}://${req.get("host")}`;
    res.status(201).json({ slug, url, short: `${base}/${slug}`, token });
  });

  // Stats for a link
  app.get("/api/links/:slug", (req, res) => {
    const link = q.bySlug.get(req.params.slug);
    if (!link) return res.status(404).json({ error: "Link not found" });
    const rows = q.perDay.all(link.id, "-13 days");
    const map = Object.fromEntries(rows.map((r) => [r.day, r.n]));
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      days.push({ day: d, clicks: map[d] || 0 });
    }
    res.json({
      slug: link.slug,
      url: link.url,
      createdAt: link.created_at.replace(" ", "T") + "Z",
      clicks: q.total.get(link.id).n,
      lastClick: q.last.get(link.id).at ? q.last.get(link.id).at.replace(" ", "T") + "Z" : null,
      days,
      referrers: q.referrers.all(link.id),
      devices: q.devices.all(link.id),
    });
  });

  // QR code as SVG
  app.get("/api/links/:slug/qr.svg", async (req, res) => {
    const link = q.bySlug.get(req.params.slug);
    if (!link) return res.status(404).end();
    const svg = await QRCode.toString(`${req.protocol}://${req.get("host")}/${link.slug}`, { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } });
    res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").send(svg);
  });

  // Delete (needs the manage token)
  app.delete("/api/links/:slug", (req, res) => {
    const link = q.bySlug.get(req.params.slug);
    const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!link) return res.status(404).json({ error: "Link not found" });
    const ok = token && crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(link.token_hash));
    if (!ok) return res.status(403).json({ error: "Wrong or missing manage token" });
    q.del.run(link.id);
    res.status(204).end();
  });

  app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1h" }));

  // Redirect
  app.get("/:slug", (req, res, next) => {
    if (!SLUG_RE.test(req.params.slug)) return next();
    const link = q.bySlug.get(req.params.slug);
    if (!link) return next();
    q.click.run(link.id, referrerOf(req.get("referer")), deviceOf(req.get("user-agent")));
    res.set("Cache-Control", "no-store"); // so every click is counted
    res.redirect(302, link.url);
  });

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    res.status(404).sendFile(path.join(__dirname, "..", "public", "404.html"));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
