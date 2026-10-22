import { test, describe } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp, normalizeUrl, randomSlug } from "../src/app.js";

const fresh = (opts = {}) => createApp({ dbFile: ":memory:", ...opts });

describe("normalizeUrl", () => {
  test("adds https when missing", () => {
    assert.equal(normalizeUrl("example.com/a"), "https://example.com/a");
  });
  test("rejects dangerous schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ftp://x.com"]) {
      assert.equal(normalizeUrl(bad), null, bad);
    }
  });
  test("rejects junk and self links", () => {
    assert.equal(normalizeUrl("not a url"), null);
    assert.equal(normalizeUrl("https://snip.test/abc", "snip.test"), null);
  });
});

test("randomSlug has the right length and alphabet", () => {
  const s = randomSlug(8);
  assert.equal(s.length, 8);
  assert.match(s, /^[a-zA-Z2-9]+$/);
});

describe("API", () => {
  test("creates a link and redirects", async () => {
    const app = fresh();
    const res = await request(app).post("/api/links").send({ url: "https://github.com/cryoviper" }).expect(201);
    assert.ok(res.body.slug);
    assert.ok(res.body.token);
    const r = await request(app).get("/" + res.body.slug).expect(302);
    assert.equal(r.headers.location, "https://github.com/cryoviper");
  });

  test("custom alias, duplicate and reserved", async () => {
    const app = fresh();
    await request(app).post("/api/links").send({ url: "https://a.com", slug: "my-link" }).expect(201);
    await request(app).post("/api/links").send({ url: "https://b.com", slug: "my-link" }).expect(409);
    await request(app).post("/api/links").send({ url: "https://b.com", slug: "api" }).expect(400);
    await request(app).post("/api/links").send({ url: "https://b.com", slug: "a b" }).expect(400);
  });

  test("rejects bad urls and bad json", async () => {
    const app = fresh();
    await request(app).post("/api/links").send({ url: "javascript:alert(1)" }).expect(400);
    await request(app).post("/api/links").set("content-type", "application/json").send("{bad").expect(400);
  });

  test("counts clicks with referrer and device", async () => {
    const app = fresh();
    const { body } = await request(app).post("/api/links").send({ url: "https://example.com" });
    await request(app).get("/" + body.slug).set("Referer", "https://www.twitter.com/x").set("User-Agent", "Mozilla/5.0 (iPhone)");
    await request(app).get("/" + body.slug).set("User-Agent", "Mozilla/5.0 (Windows NT 10.0)");
    const stats = await request(app).get("/api/links/" + body.slug).expect(200);
    assert.equal(stats.body.clicks, 2);
    assert.equal(stats.body.days.length, 14);
    assert.equal(stats.body.days.at(-1).clicks, 2);
    assert.deepEqual(stats.body.referrers.map((r) => r.name).sort(), ["Direct", "twitter.com"]);
    assert.deepEqual(stats.body.devices.map((d) => d.name).sort(), ["Desktop", "Mobile"]);
  });

  test("delete needs the right token", async () => {
    const app = fresh();
    const { body } = await request(app).post("/api/links").send({ url: "https://example.com" });
    await request(app).delete("/api/links/" + body.slug).set("Authorization", "Bearer wrong").expect(403);
    await request(app).delete("/api/links/" + body.slug).set("Authorization", "Bearer " + body.token).expect(204);
    await request(app).get("/" + body.slug).expect(404);
  });

  test("QR code endpoint returns SVG", async () => {
    const app = fresh();
    const { body } = await request(app).post("/api/links").send({ url: "https://example.com" });
    const r = await request(app).get(`/api/links/${body.slug}/qr.svg`).expect(200);
    assert.match(r.headers["content-type"], /image\/svg\+xml/);
  });

  test("rate limits link creation", async () => {
    const app = fresh({ rateLimitMax: 2 });
    await request(app).post("/api/links").send({ url: "https://a.com" }).expect(201);
    await request(app).post("/api/links").send({ url: "https://a.com" }).expect(201);
    await request(app).post("/api/links").send({ url: "https://a.com" }).expect(429);
  });
});
