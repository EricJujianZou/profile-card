// HTTP routes for hire or pass. Plain node:http, no framework.

import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { makeCard, defaultClient, CardError } from "./ai.js";
import { fetchGithub, cleanUsername, GithubError } from "./github.js";
import { REASONS, SAMPLE } from "./card-rules.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const MAX_PDF = 8 * 1024 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const TYPES = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const STATUS = {
  resume: "Reading your resume",
  linkedin: "Reading your LinkedIn PDF",
  shipped: "Finding what you shipped",
  score: "Picking a score",
  verdict: "Writing your verdict",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Each card costs a paid AI call, so card making has limits. Votes have a limit per network on each card.
export const RATE_DEFAULTS = { cardsPerIpHour: 5, cardsPerDay: 300, votesPerIpCard: 10 };

export function ratesFromEnv(env = process.env) {
  const n = (v, d) => (v === undefined || v === "" || !Number.isInteger(Number(v)) || Number(v) < 0 ? d : Number(v));
  return {
    cardsPerIpHour: n(env.HOP_CARDS_PER_IP_HOUR, RATE_DEFAULTS.cardsPerIpHour),
    cardsPerDay: n(env.HOP_CARDS_PER_DAY, RATE_DEFAULTS.cardsPerDay),
    votesPerIpCard: n(env.HOP_VOTES_PER_IP_CARD, RATE_DEFAULTS.votesPerIpCard),
  };
}

// The key a limit counts by: an IPv4 address, or the /64 network of an IPv6 address,
// because one IPv6 home or phone usually gets a whole /64 and can change the rest at will.
export function ipKey(addr) {
  let a = String(addr || "").trim().split("%")[0];
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(a)) a = a.slice(7);
  if (!a.includes(":")) return a || "unknown";
  const [head, tail] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createApp({ db, renderer = null, aiClient = defaultClient(), fetchImpl = fetch, publicUrl, umami = null, umamiSrc = null, rates = RATE_DEFAULTS, trustProxy = false }) {
  const base = publicUrl.replace(/\/$/, "");
  // Umami analytics is off unless both the script URL and the website id are set.
  const umamiOrigin = umami && umamiSrc ? new URL(umamiSrc).origin : null;
  const analyticsSrc = umamiOrigin ? ` ${umamiOrigin}` : "";
  const secure = base.startsWith("https:");
  const host = base.replace(/^https?:\/\//, "");
  const linkOf = (slug) => `${host}/${slug}`;
  const pub = (c) => c && { slug: c.slug, source: c.source, name: c.name, first: c.first, initials: c.initials, photoUrl: c.photoUrl, role: c.role, score: c.score, verdict: c.verdict, receipts: c.receipts };
  const templates = {};
  const tpl = (name) => (templates[name] ??= readFileSync(join(PUBLIC, name), "utf8"));

  function browserId(req, res, create) {
    const id = parseCookies(req.headers.cookie).hop_id;
    if (id && /^[A-Za-z0-9_-]{20,64}$/.test(id)) return id;
    if (!create) return null;
    const fresh = randomBytes(24).toString("base64url");
    res.setHeader("Set-Cookie", `hop_id=${fresh}; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000${secure ? "; Secure" : ""}`);
    return fresh;
  }

  // Behind a proxy (HOP_TRUST_PROXY=1) every request comes from the proxy, so the visitor's address is
  // the last one the proxy added to X-Forwarded-For. Earlier entries come from the visitor and can be faked.
  function clientIp(req) {
    const fwd = trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean).at(-1) : null;
    return ipKey(fwd || req.socket.remoteAddress);
  }

  function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
    res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", ...extra });
    res.end(body);
  }
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", { "Cache-Control": "no-store" });

  function page(res, status, file, boot, meta = "") {
    const nonce = randomBytes(12).toString("base64");
    const analytics = umamiOrigin && file === "index.html"
      ? `<script defer src="${esc(umamiSrc)}" data-website-id="${esc(umami)}"></script>`
      : "";
    const html = tpl(file)
      .replace("<!--META-->", meta + analytics)
      .replace("<!--BOOT-->", `<script nonce="${nonce}">window.BOOT=${safeJson(boot)}</script>`);
    send(res, status, html, "text/html; charset=utf-8", {
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'${analyticsSrc}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://avatars.githubusercontent.com",
        `connect-src 'self'${analyticsSrc}`,
        "frame-ancestors 'self'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join("; "),
    });
  }

  function cardMeta(card) {
    const first = card.first;
    const title = `Would you hire ${first}?`;
    const desc = "AI scores your resume, then your friends swipe hire or pass.";
    const img = `${base}/${card.slug}/og.png`;
    return [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${esc(`${base}/${card.slug}`)}">`,
      `<meta property="og:image" content="${esc(img)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="627">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="robots" content="noindex">`,
    ].join("\n");
  }
  const homeMeta = `<title>hire or pass</title>\n<meta name="description" content="AI scores your resume, then your friends swipe hire or pass.">`;

  const homeBoot = (extra = {}) => ({ view: "make", sample: SAMPLE, sampleLink: linkOf(SAMPLE.slug), reasons: REASONS, ...extra });

  async function createCard(req, res, url) {
    const source = url.searchParams.get("source");
    if (!["resume", "linkedin", "github"].includes(source)) return json(res, 400, { error: "Pick resume, GitHub or LinkedIn." });

    let input;
    try {
      if (source === "github") {
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
        const username = cleanUsername(body.username);
        if (!username) return json(res, 400, { error: "That is not a GitHub username." });
        input = { source, username };
      } else {
        const pdf = await readBody(req, MAX_PDF);
        if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return json(res, 400, { error: "That file is not a PDF." });
        input = { source, pdf };
      }
    } catch (err) {
      if (err.status === 413) return json(res, 413, { error: "That PDF is over 8 MB." });
      return json(res, 400, { error: "Could not read that." });
    }

    // Counted once the input is valid, before any paid call. The check and the count run without a pause, so
    // requests that arrive together cannot all slip past the limit.
    const limited = db.claimMake(clientIp(req), rates);
    if (limited === "day") return json(res, 429, { error: "Card making is full for today. Try again tomorrow." });
    if (limited === "ip") return json(res, 429, { error: "Too many cards from here. Try again in an hour." });

    const owner = browserId(req, res, true);
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" });
    const out = (obj) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n"); };
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abort.abort(); });

    try {
      // fail before calling GitHub, so a server with no AI key does not spend the GitHub rate limit
      if (!aiClient) throw new CardError("setup", "The AI step is not set up on this server yet.", false);
      if (source === "github") {
        const gh = await fetchGithub(input.username, { fetchImpl });
        input.github = gh.data;
        input.photoUrl = gh.photoUrl;
        if (gh.photoUrl) out({ t: "photo", url: gh.photoUrl });
        out({ t: "status", text: `Reading ${gh.repoCount} ${gh.repoCount === 1 ? "repo" : "repos"}` });
      } else {
        out({ t: "status", text: STATUS[source] });
      }

      const card = await makeCard(input, {
        client: aiClient,
        signal: abort.signal,
        onEvent(ev) {
          out(ev);
          if (ev.t === "name") out({ t: "status", text: STATUS.shipped });
          if (ev.t === "receipt" && ev.i === 2) out({ t: "status", text: STATUS.score });
          if (ev.t === "score") out({ t: "status", text: STATUS.verdict });
        },
      });
      if (abort.signal.aborted) return;
      const saved = db.createCard(card, owner);
      out({ t: "done", card: pub(saved), link: linkOf(saved.slug), url: `${base}/${saved.slug}` });
      res.end();
      if (renderer) for (const kind of ["story", "og"]) renderer.png(saved.slug, kind).catch((e) => console.error("render", kind, e.message));
    } catch (err) {
      if (abort.signal.aborted) return;
      const known = err instanceof CardError || err instanceof GithubError;
      if (!known) console.error("make card", err);
      const retry = err instanceof GithubError ? err.code !== "not_found" : err instanceof CardError ? err.retry : true;
      out({ t: "error", code: err.code || "server", message: known ? err.message : "Something broke while making your card. Try again.", retry });
      res.end();
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean);

    if (path === "/healthz") return send(res, 200, "ok");
    if (path === "/robots.txt") return send(res, 200, "User-agent: *\nDisallow: /\n");

    if (parts[0] === "static" && parts.length === 2 && req.method === "GET") {
      const name = parts[1];
      const file = join(PUBLIC, name);
      if (!/^[a-z0-9-]+\.(js|css|svg|png|ico)$/.test(name) || !existsSync(file)) return send(res, 404, "Not found");
      return send(res, 200, readFileSync(file), TYPES[extname(name)], { "Cache-Control": "no-cache" });
    }

    if (parts[0] === "api") {
      if (path === "/api/cards" && req.method === "POST") return createCard(req, res, url);
      const slug = parts[2];
      if (parts[1] !== "cards" || !slug || !SLUG_RE.test(slug)) return json(res, 404, { error: "Not found" });
      const card = db.getCard(slug);
      if (!card) return json(res, 404, { error: "This card was deleted." });
      const action = parts[3];

      if (!action && req.method === "DELETE") {
        if (!db.isOwner(slug, browserId(req, res, false))) return json(res, 403, { error: "Only the owner can delete this card." });
        db.deleteCard(slug);
        renderer?.forget(slug);
        return json(res, 200, { ok: true });
      }
      if (action === "results" && req.method === "GET") {
        if (!db.isOwner(slug, browserId(req, res, false))) return json(res, 403, { error: "Only the owner sees results." });
        return json(res, 200, db.results(slug));
      }
      if ((action === "vote" || action === "reason") && req.method === "POST") {
        let body;
        try { body = JSON.parse((await readBody(req, 1024)).toString("utf8") || "{}"); } catch { return json(res, 400, { error: "Bad request" }); }
        // A real visitor got the browser cookie when the card page loaded. A request without it is a script.
        const id = browserId(req, res, false);
        if (!id) return json(res, 403, { error: "Open the card link to vote." });
        if (db.isOwner(slug, id)) return json(res, 403, { error: "You can't vote on your own card." });
        if (action === "vote") {
          if (!["hire", "pass"].includes(body.decision)) return json(res, 400, { error: "Bad request" });
          const vote = db.addVote(slug, id, body.decision, { ip: clientIp(req), max: rates.votesPerIpCard });
          if (!vote) return json(res, 429, { error: "Too many votes from this network on this card." });
          return json(res, 200, vote);
        }
        if (!db.voteOf(slug, id)) return json(res, 409, { error: "Vote first." });
        if (!db.setReason(slug, id, body.reasonId)) return json(res, 400, { error: "Bad request" });
        return json(res, 200, db.voteOf(slug, id));
      }
      return json(res, 405, { error: "Method not allowed" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");

    if (parts.length === 0) return page(res, 200, "index.html", homeBoot(), homeMeta);

    const slug = parts[0];
    const card = SLUG_RE.test(slug) ? db.getCard(slug) : null;
    if (!card) return page(res, 404, "index.html", homeBoot({ missing: true }), homeMeta);

    if (parts.length === 1) {
      // A first visit gets the browser cookie here, and a vote needs it.
      const id = browserId(req, res, true);
      const owner = db.isOwner(slug, id);
      const vote = owner ? null : db.voteOf(slug, id);
      const view = owner ? "card" : vote ? "sent" : "vote";
      return page(res, 200, "index.html", homeBoot({ view, card: pub(card), link: linkOf(slug), url: `${base}/${slug}`, owner, vote }), cardMeta(card));
    }
    if (parts.length === 2 && (parts[1] === "story" || parts[1] === "og")) {
      return page(res, 200, `${parts[1]}.html`, { card: pub(card), link: linkOf(slug) });
    }
    if (parts.length === 2 && (parts[1] === "story.png" || parts[1] === "og.png")) {
      if (!renderer) return send(res, 503, "Images are off");
      try {
        const png = await renderer.png(slug, parts[1].replace(".png", ""));
        return send(res, 200, png, "image/png", { "Cache-Control": "public, max-age=300" });
      } catch (err) {
        console.error("render", err.message);
        return send(res, 500, "Could not make the image");
      }
    }
    return page(res, 404, "index.html", homeBoot({ missing: true }), homeMeta);
  }

  return (req, res) => handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, "Server error");
    else res.end();
  });
}
