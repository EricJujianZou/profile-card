import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { fakeClient, DEVON } from "./fakes.js";

// GitHub's public API, faked: one user with no repos and no events.
const fakeGithub = async (url) => {
  const path = new URL(url).pathname;
  const body = path === "/users/devon" ? { login: "devon", name: "Devon Park", public_repos: 41, avatar_url: "https://avatars.githubusercontent.com/u/1" }
    : path.startsWith("/users/devon/") ? [] : null;
  return new Response(JSON.stringify(body ?? { message: "Not Found" }), { status: body ? 200 : 404, headers: { "content-type": "application/json" } });
};
const fakeRenderer = { png: async () => Buffer.from("PNG"), forget() {}, close: async () => {} };

let dir, db, base, server, offBase, offServer;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "hop-"));
  db = openDb(join(dir, "t.db"));
  const listen = (app) => new Promise((ok) => { const s = createServer(app).listen(0, "127.0.0.1", () => ok(s)); });
  server = await listen(createApp({ db, renderer: fakeRenderer, aiClient: fakeClient(JSON.stringify(DEVON)), fetchImpl: fakeGithub, publicUrl: "http://test.local", umami: "site-id", umamiSrc: "https://analytics.example.com/script.js" }));
  offServer = await listen(createApp({ db, renderer: null, aiClient: null, fetchImpl: fakeGithub, publicUrl: "http://test.local" }));
  base = `http://127.0.0.1:${server.address().port}`;
  offBase = `http://127.0.0.1:${offServer.address().port}`;
});
after(() => { server.close(); offServer.close(); db.close?.(); rmSync(dir, { recursive: true, force: true }); });

const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];
const call = (path, { cookie = "", method = "GET", body, type = "application/json", at = base } = {}) =>
  fetch(at + path, { method, headers: { cookie, "content-type": type }, body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) });
const lines = async (res) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
const bootOf = async (res) => JSON.parse((await res.text()).match(/window\.BOOT=(.*?);?<\/script>/)[1]);

test("full path: make a card, vote, give a reason, read results, delete", async () => {
  const made = await call("/api/cards?source=github", { method: "POST", body: { username: "github.com/devon" } });
  assert.equal(made.status, 200);
  const owner = cookieOf(made);
  assert.match(owner, /^hop_id=[\w-]{20,}$/);
  const events = await lines(made);
  assert.deepEqual(events.slice(0, 2).map((e) => e.t), ["photo", "status"]);
  assert.equal(events[1].text, "Reading 41 repos");
  const done = events.at(-1);
  assert.equal(done.t, "done");
  const slug = done.card.slug;
  assert.match(slug, /^devon-[a-z0-9]{3}$/, "devon is a reserved sample name, so the slug gets a tail");
  assert.equal(done.card.photoUrl, "https://avatars.githubusercontent.com/u/1");
  assert.equal(done.url, `http://test.local/${slug}`);
  assert.equal(done.link, `test.local/${slug}`);
  assert.ok(events.some((e) => e.t === "verdict"));

  const ownerPage = await call(`/${slug}`, { cookie: owner });
  assert.match(ownerPage.headers.get("content-security-policy"), /script-src 'self' 'nonce-[\w+/=]+' https:\/\/analytics\.example\.com/);
  const ownerHtml = await ownerPage.text();
  assert.match(ownerHtml, /data-website-id="site-id"/);
  assert.match(ownerHtml, /<meta property="og:image" content="http:\/\/test\.local\/devon-\w{3}\/og\.png">/);
  assert.match(ownerHtml, /<title>Would you hire Devon\?<\/title>/);
  const ownerBoot = JSON.parse(ownerHtml.match(/window\.BOOT=(.*?);?<\/script>/)[1]);
  assert.equal(ownerBoot.view, "card");
  assert.equal(ownerBoot.owner, true);

  const visitorPage = await call(`/${slug}`);
  const voter = cookieOf(visitorPage);
  assert.ok(voter && voter !== owner, "the card page gives a first visitor the browser cookie");
  const visitorBoot = await bootOf(visitorPage);
  assert.equal(visitorBoot.view, "vote");
  assert.equal(visitorBoot.owner, false);
  assert.equal(visitorBoot.card.slug, slug);
  assert.equal(JSON.stringify(visitorBoot).includes("owner_hash"), false, "the owner key never reaches a page");

  assert.equal((await call(`/api/cards/${slug}/vote`, { method: "POST", cookie: owner, body: { decision: "hire" } })).status, 403);
  assert.equal((await call(`/api/cards/${slug}/reason`, { method: "POST", cookie: voter, body: { reasonId: "ships" } })).status, 409);

  const voted = await call(`/api/cards/${slug}/vote`, { method: "POST", cookie: voter, body: { decision: "hire" } });
  assert.equal(voted.status, 200);
  assert.equal((await call(`/api/cards/${slug}/reason`, { method: "POST", cookie: voter, body: { reasonId: "npc" } })).status, 400, "a pass reason on a hire vote");
  assert.deepEqual(await (await call(`/api/cards/${slug}/reason`, { method: "POST", cookie: voter, body: { reasonId: "ships" } })).json(), { decision: "hire", reasonId: "ships" });
  await call(`/api/cards/${slug}/vote`, { method: "POST", cookie: voter, body: { decision: "pass" } });
  const second = cookieOf(await call(`/${slug}`));
  await call(`/api/cards/${slug}/vote`, { method: "POST", cookie: second, body: { decision: "pass" } });

  assert.equal((await call(`/api/cards/${slug}/results`, { cookie: voter })).status, 403);
  const results = await (await call(`/api/cards/${slug}/results`, { cookie: owner })).json();
  assert.equal(results.hire, 1, "the second vote from the same browser does not count");
  assert.equal(results.pass, 1);
  assert.equal(results.percent, 50);
  assert.deepEqual(results.reasons.hire.map((r) => [r.id, r.count]), [["ships", 1]]);
  assert.deepEqual(results.reasons.pass, []);

  assert.equal((await bootOf(await call(`/${slug}`, { cookie: voter }))).view, "sent");
  const png = await call(`/${slug}/story.png`);
  assert.equal(png.headers.get("content-type"), "image/png");

  assert.equal((await call(`/api/cards/${slug}`, { method: "DELETE", cookie: voter })).status, 403);
  assert.equal((await call(`/api/cards/${slug}`, { method: "DELETE", cookie: owner })).status, 200);
  assert.equal((await call(`/${slug}`)).status, 404);
  assert.equal((await call(`/api/cards/${slug}/vote`, { method: "POST", cookie: voter, body: { decision: "hire" } })).status, 404);
});

// A second server with its own database, small limits and a trusted proxy header, so a test can act from many addresses.
test("the vote question and link use the first name without a title, and a GitHub name like The Octocat uses the login", async () => {
  // GitHub, faked: every username exists, with no display name, no repos and no events.
  const anyUser = async (url) => {
    const [, , login, more] = new URL(url).pathname.split("/");
    const body = more ? [] : { login, name: null, public_repos: 1, avatar_url: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const make = async (name, username) => {
    const app = createApp({ db: openDb(":memory:"), aiClient: fakeClient(JSON.stringify({ ...DEVON, name })), fetchImpl: anyUser, publicUrl: "http://test.local" });
    const s = await new Promise((ok) => { const srv = createServer(app).listen(0, "127.0.0.1", () => ok(srv)); });
    try {
      const at = `http://127.0.0.1:${s.address().port}`;
      const done = (await lines(await call("/api/cards?source=github", { method: "POST", body: { username }, at }))).at(-1);
      const html = await (await call(`/${done.card.slug}`, { at })).text();
      return { card: done.card, title: html.match(/<title>(.*?)<\/title>/)[1] };
    } finally { s.close(); }
  };

  const dr = await make("Dr. Marguerite Abernathy-Okonkwo-Lindqvist", "mabernathy");
  assert.equal(dr.title, "Would you hire Marguerite?");
  assert.equal(dr.card.slug, "marguerite");
  assert.equal(dr.card.name, "Marguerite A.");
  assert.equal(dr.card.first, "Marguerite");
  assert.equal(dr.card.initials, "MA");

  const octo = await make("The Octocat", "octocat");
  assert.equal(octo.title, "Would you hire octocat?");
  assert.equal(octo.card.slug, "octocat");
  assert.equal(octo.card.name, "The Octocat");
});

test("a card saved before the first name was stored still gets a clean first name", () => {
  const old = openDb(":memory:");
  old.raw.exec(`INSERT INTO cards (slug, source, name, initials, role, score, verdict, receipts, owner_hash, created_at)
    VALUES ('ada', 'resume', 'Prof. Ada Lovelace', 'PL', 'Analyst', 50, 'Fine.', '[]', 'x', 0)`);
  assert.equal(old.getCard("ada").first, "Ada");
});

const startLimited = (rates) => new Promise((ok) => {
  const app = createApp({ db: openDb(":memory:"), aiClient: fakeClient(JSON.stringify(DEVON)), fetchImpl: fakeGithub, publicUrl: "http://test.local", rates, trustProxy: true });
  const srv = createServer(app).listen(0, "127.0.0.1", () => ok(srv));
});

test("votes need the cookie from the card page, and one network gets a fixed number of votes per card", async () => {
  const s = await startLimited({ cardsPerIpHour: 5, cardsPerDay: 300, votesPerIpCard: 2 });
  const at = `http://127.0.0.1:${s.address().port}`;
  const req = (path, { ip = "9.9.9.9", cookie = "", body } = {}) => fetch(at + path, {
    method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-forwarded-for": ip }, body: body && JSON.stringify(body),
  });
  const makeOne = async () => {
    const res = await fetch(`${at}/api/cards?source=resume`, { method: "POST", headers: { "content-type": "application/pdf", "x-forwarded-for": "8.8.8.8" }, body: "%PDF-1.4 test" });
    return { owner: cookieOf(res), slug: (await lines(res)).at(-1).card.slug };
  };
  try {
    const { owner, slug } = await makeOne();
    const other = (await makeOne()).slug;

    for (let i = 0; i < 5; i++) {
      const r = await req(`/api/cards/${slug}/vote`, { body: { decision: "hire" } });
      assert.equal(r.status, 403, "a vote with no cookie does not count");
      assert.equal(r.headers.get("set-cookie"), null, "and it does not get a cookie either");
    }
    assert.equal((await req(`/api/cards/${slug}/reason`, { body: { reasonId: "ships" } })).status, 403);

    const visitor = async (ip) => cookieOf(await req(`/${slug}`, { ip }));
    const a = await visitor("9.9.9.9"), b = await visitor("9.9.9.9"), c = await visitor("9.9.9.9");
    assert.equal((await req(`/api/cards/${slug}/vote`, { cookie: a, body: { decision: "hire" } })).status, 200);
    assert.equal((await req(`/api/cards/${slug}/vote`, { cookie: b, body: { decision: "hire" } })).status, 200);
    const blocked = await req(`/api/cards/${slug}/vote`, { cookie: c, body: { decision: "hire" } });
    assert.equal(blocked.status, 429, "the third vote from one network on one card");
    assert.deepEqual(await blocked.json(), { error: "Too many votes from this network on this card." });
    assert.deepEqual(await (await req(`/api/cards/${slug}/vote`, { cookie: a, body: { decision: "pass" } })).json(), { decision: "hire", reasonId: null }, "a repeat vote still answers with the vote that counts");

    const d = await visitor("7.7.7.7");
    assert.equal((await req(`/api/cards/${slug}/vote`, { ip: "7.7.7.7", cookie: d, body: { decision: "pass" } })).status, 200, "another network can vote");
    const e = cookieOf(await req(`/${other}`));
    assert.equal((await req(`/api/cards/${other}/vote`, { cookie: e, body: { decision: "pass" } })).status, 200, "the limit is per card");

    const results = await (await req(`/api/cards/${slug}/results`, { cookie: owner })).json();
    assert.deepEqual([results.hire, results.pass], [2, 1], "only the counted votes are in the results");
  } finally {
    s.close();
  }
});

test("card making stops at the limit per address and at the daily cap, with one plain line", async () => {
  const s = await startLimited({ cardsPerIpHour: 2, cardsPerDay: 3, votesPerIpCard: 10 });
  const at = `http://127.0.0.1:${s.address().port}`;
  const make = (ip, body = "%PDF-1.4 test") =>
    fetch(`${at}/api/cards?source=resume`, { method: "POST", headers: { "content-type": "application/pdf", "x-forwarded-for": ip }, body });
  try {
    const first = await make("1.1.1.1");
    assert.equal(first.status, 200);
    assert.equal((await lines(first)).at(-1).t, "done");
    assert.equal((await make("1.1.1.1")).status, 200);
    const third = await make("1.1.1.1");
    assert.equal(third.status, 429);
    assert.deepEqual(await third.json(), { error: "Too many cards from here. Try again in an hour." });
    assert.equal((await make("6.6.6.6, 1.1.1.1")).status, 429, "an address the visitor adds in front does not count");
    assert.equal((await make("2.2.2.2", "not a pdf")).status, 400, "bad input does not use up a slot");
    assert.equal((await make("2.2.2.2")).status, 200);
    const full = await make("3.3.3.3");
    assert.equal(full.status, 429);
    assert.deepEqual(await full.json(), { error: "Card making is full for today. Try again tomorrow." });
  } finally {
    s.close();
  }
});

test("bad input and a server with no AI key give one clear line", async () => {
  assert.equal((await call("/api/cards?source=resume", { method: "POST", type: "application/pdf", body: "hello" })).status, 400);
  assert.equal((await call("/api/cards?source=github", { method: "POST", body: { username: "not a name!" } })).status, 400);
  const missing = (await lines(await call("/api/cards?source=github", { method: "POST", body: { username: "nobody" } }))).at(-1);
  assert.equal(missing.t, "error");
  assert.equal(missing.retry, false);
  const off = (await lines(await call("/api/cards?source=resume", { method: "POST", type: "application/pdf", body: "%PDF-1.4 test", at: offBase }))).at(-1);
  assert.deepEqual([off.t, off.code, off.message], ["error", "setup", "The AI step is not set up on this server yet."]);
  const offGithub = await lines(await call("/api/cards?source=github", { method: "POST", body: { username: "devon" }, at: offBase }));
  assert.deepEqual(offGithub.map((e) => e.t), ["error"], "no GitHub call when the AI step is off");
  assert.equal((await call("/maya", { at: offBase })).status, 404, "reserved sample slug is not a real card");
  assert.equal((await call("/static/app.js")).status, 200);
  assert.equal((await call("/static/..%2Fserver%2Fai.js")).status, 404);
});
