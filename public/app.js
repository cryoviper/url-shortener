// Snip frontend. Talks to the Express API on the same origin.
const $ = (id) => document.getElementById(id);
const KEY = "snip.mine.v1";
const mine = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const saveMine = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ } };

$("hostLabel").textContent = location.host + "/";

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json", ...(opts.headers || {}) }, ...opts });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- create ----------
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  const slug = $("slug").value.trim();
  const err = $("err");
  err.textContent = "";
  if (!url) { err.textContent = "Paste a link first."; $("url").focus(); return; }
  const btn = $("submit");
  btn.disabled = true;
  btn.textContent = "Shortening…";
  try {
    const data = await api("/api/links", { method: "POST", body: JSON.stringify({ url, slug: slug || undefined }) });
    saveMine([{ slug: data.slug, url: data.url, short: data.short, token: data.token, created: Date.now() }, ...mine()]);
    showResult(data);
    $("form").reset();
    renderList();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Shorten";
  }
});

function showResult(data) {
  $("result").hidden = false;
  const a = $("shortLink");
  a.href = data.short;
  a.textContent = data.short.replace(/^https?:\/\//, "");
  $("origLink").textContent = data.url;
  $("qr").src = `/api/links/${encodeURIComponent(data.slug)}/qr.svg`;
  $("copyBtn").onclick = () => copy(data.short, $("copyBtn"));
  $("statsBtn").onclick = () => openStats(data.slug);
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    prompt("Copy this link:", text);
  }
}

// ---------- list ----------
async function renderList() {
  const list = $("list");
  const items = mine();
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Links you create show up here.";
    list.append(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "s";
    a.href = it.short;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "/" + it.slug;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = it.url;
    const acts = document.createElement("div");
    acts.className = "acts";
    const c = Object.assign(document.createElement("button"), { type: "button", textContent: "Copy" });
    c.onclick = () => copy(it.short, c);
    const s = Object.assign(document.createElement("button"), { type: "button", textContent: "Stats" });
    s.onclick = () => openStats(it.slug);
    acts.append(c, s);
    li.append(a, acts, meta);
    list.append(li);
  }
}

// ---------- stats ----------
const dlg = $("stats");
$("closeStats").onclick = () => dlg.close();
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

async function openStats(slug) {
  $("statsTitle").textContent = "/" + slug;
  $("statsUrl").textContent = "";
  $("statsBody").innerHTML = '<p class="muted">Loading…</p>';
  dlg.showModal();
  try {
    const s = await api("/api/links/" + encodeURIComponent(slug));
    $("statsUrl").textContent = s.url;
    $("statsUrl").href = s.url;
    const max = Math.max(1, ...s.days.map((d) => d.clicks));
    const W = 560, H = 120, gap = 6, bw = (W - gap * 13) / 14;
    const bars = s.days.map((d, i) => {
      const h = d.clicks ? Math.max(4, (d.clicks / max) * (H - 4)) : 3;
      return `<rect x="${i * (bw + gap)}" y="${H - h}" width="${bw}" height="${h}" rx="3" class="${d.clicks ? "" : "zero"}"><title>${d.day}: ${d.clicks}</title></rect>`;
    }).join("");
    const listHtml = (rows) => rows.length
      ? rows.map((r) => `<li><span>${esc(r.name)}</span><b>${r.n}</b></li>`).join("")
      : '<li><span class="muted">No clicks yet</span></li>';
    const week = s.days.slice(-7).reduce((a, d) => a + d.clicks, 0);
    $("statsBody").innerHTML = `
      <div class="big">
        <div><span>Total clicks</span><b>${s.clicks}</b></div>
        <div><span>Last 7 days</span><b>${week}</b></div>
        <div><span>Created</span><b><small>${new Date(s.createdAt).toLocaleDateString()}</small></b></div>
      </div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Clicks per day, last 14 days">${bars}</svg>
      <div class="axis"><span>${fmt(s.days[0].day)}</span><span>Today</span></div>
      <div class="cols">
        <div><h3>Top referrers</h3><ul>${listHtml(s.referrers)}</ul></div>
        <div><h3>Devices</h3><ul>${listHtml(s.devices)}</ul></div>
      </div>`;
    const own = mine().find((m) => m.slug === slug);
    if (own?.token) {
      const del = Object.assign(document.createElement("button"), { type: "button", className: "danger", textContent: "Delete this link" });
      del.onclick = async () => {
        if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = "Click again to delete forever"; return; }
        try {
          await api("/api/links/" + encodeURIComponent(slug), { method: "DELETE", headers: { authorization: "Bearer " + own.token } });
          saveMine(mine().filter((m) => m.slug !== slug));
          renderList();
          dlg.close();
          if ($("shortLink").textContent.endsWith("/" + slug)) $("result").hidden = true;
        } catch (ex) { del.textContent = ex.message; }
      };
      $("statsBody").append(del);
    }
  } catch (ex) {
    $("statsBody").innerHTML = "";
    const p = document.createElement("p");
    p.className = "err";
    p.textContent = ex.message === "Link not found" ? "This link no longer exists." : ex.message;
    $("statsBody").append(p);
  }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => new Date(d + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

renderList();
