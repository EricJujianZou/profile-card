import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePartialJson } from "../server/partial-json.js";
import { clip, clipVerdict, normalizeCard, slugBase, initialsOf, LIMITS, firstName, cleanName, looksLikePersonName } from "../server/card-rules.js";
import { openDb } from "../server/db.js";
import { activity, cleanUsername } from "../server/github.js";
import OpenAI from "openai";
import { makeCard, buildRequest, CardError, SCHEMA, SYSTEM } from "../server/ai.js";
import { ipKey, ratesFromEnv, RATE_DEFAULTS } from "../server/app.js";
import { fakeClient, DEVON } from "./fakes.js";

test("partial JSON keeps closed values and an open string value", () => {
  assert.equal(parsePartialJson(""), undefined);
  assert.deepEqual(parsePartialJson('{"name":"Ma'), { name: "Ma" });
  assert.deepEqual(parsePartialJson('{"name":"Maya","ro'), { name: "Maya" });
  assert.deepEqual(parsePartialJson('{"name":"Maya","score":7'), { name: "Maya" });
  assert.deepEqual(parsePartialJson('{"name":"Maya","score":78,'), { name: "Maya", score: 78 });
  assert.deepEqual(parsePartialJson('{"r":[{"icon":"code","text":"Rust'), { r: [{ icon: "code", text: "Rust" }] });
  assert.deepEqual(parsePartialJson('{"v":"a \\"quote'), { v: 'a "quote' });
  assert.deepEqual(parsePartialJson('{"v":"x\\'), { v: "x" });
  assert.deepEqual(parsePartialJson('{"ok":true}'), { ok: true });
});

test("content limits keep the badge from overflowing", () => {
  assert.equal(clip("Chrome extension with 3,100 weekly users", 34), "Chrome extension");
  assert.ok(clip("x".repeat(50), 34).length <= 34);
  const v = clipVerdict("First sentence is fine and short. " + "Second one runs on and on ".repeat(5) + "end.");
  assert.equal(v, "First sentence is fine and short.");
  assert.equal(clip("Built it — shipped it", 40), "Built it, shipped it");
  assert.equal(slugBase("Zoë Ångström"), "zoe");
  assert.equal(slugBase("李"), "card");
  assert.equal(initialsOf("Devon Park"), "DP");
  const card = normalizeCard(
    { name: "Devon Park", role: "4th year CS at UBC", score: 140, verdict: "Good.", receipts: [{ icon: "rocket", text: "a" }, { icon: "code", text: "b" }, { icon: "star", text: "c" }, { icon: "moon", text: "d" }] },
    { source: "github" }
  );
  assert.equal(card.score, 100);
  assert.equal(card.receipts.length, 3);
  assert.equal(card.receipts[0].icon, "star");
});

test("a long role or receipt is cut to a whole phrase, never on a hanging word", () => {
  const role = (s) => clip(s, LIMITS.role);
  const receipt = (s) => clip(s, LIMITS.receipt);
  // The audit case: the old cut showed "Data Engineering Intern at".
  assert.equal(role("Data Engineering Intern at Royal Bank of Canada"), "Intern at Royal Bank of Canada");
  assert.equal(role("Backend dev at Bank of America in Toronto"), "Backend dev at Bank of America");
  assert.equal(role("Analyst at Ernst and Young LLP Toronto"), "Analyst at Ernst and Young LLP");
  assert.equal(role("Software Engineering Intern at Shopify (Payments team)"), "Engineering Intern at Shopify");
  // A count before "at" is never dropped, so the claim stays true.
  assert.equal(receipt("1st of 214 teams at Hack the North 2024"), "1st of 214 teams at Hack the North");
  // Date ranges stay whole or go whole.
  assert.equal(receipt("Volunteer coordinator, 2016 to 2019"), "Volunteer coordinator");
  assert.equal(receipt("Volunteer coordinator 2016 to 2019 at Red Cross"), "Volunteer coordinator 2016 to 2019");
  assert.equal(receipt("Junior dev, March 2024 to present at Shopify"), "Junior dev, March 2024 to present");
  assert.equal(receipt("Teaching assistant for ECE 150 (Fundamentals of Programming)"), "Teaching assistant for ECE 150");
  assert.equal(receipt("Led a team of 5 to build a robot that"), "Led a team of 5 to build a robot");
  assert.equal(receipt("Built a scheduling app used by 1,200 students and 40 clubs"), "Built a scheduling app");
  // Front words are dropped only from a job title, never from a sentence.
  assert.equal(receipt("Led the migration of a monolith to services at scale"), "Led the migration of a monolith");

  const hanging = /\b(a|an|the|and|or|at|to|of|in|on|for|with|by|from|via|using|used)$|[,;:(&+@|/-]$/i;
  const long = [
    "Data Engineering Intern at Royal Bank of Canada", "Intern at the Ministry of Transportation of Ontario",
    "Python, Java, C++, Rust, Go, TypeScript and more", "Research assistant, Jan 2023 to Mar 2024, UW lab",
    "3rd year Computer Engineering at University of Waterloo", "Won, 1st of 214 teams at Hack the North 2024",
    "Mentored 40 first year students in the robotics club at", "Shipped a feature to 2 million users of the app with",
    "Organized a hackathon for 300 people | 2 years in a row", "Led the migration of a monolith to services at scale",
    "Senior software engineer @ Stripe · payments infrastructure team",
  ];
  for (const s of long) {
    for (const max of [LIMITS.role, LIMITS.receipt, 24]) {
      const out = clip(s, max);
      assert.ok(out.length > 0 && out.length <= max, `${s} at ${max} gave "${out}"`);
      assert.doesNotMatch(out, hanging, `${s} at ${max} gave "${out}"`);
      assert.ok(s.replace(/\s+/g, " ").toLowerCase().includes(out.toLowerCase().replace(/,$/, "")) || /^[A-Z]/.test(out), `${s} at ${max} gave "${out}"`);
    }
  }
  // Only a single word longer than the limit is cut inside the word.
  assert.equal(clip("Supercalifragilisticexpialidocious-and-more", 34), "Supercalifragilisticexpialidocious");
});

test("first name, short name, initials and link skip titles, initials and odd words", () => {
  const cases = [
    // name as given, first name, name on the badge, initials, link
    ["Dr. Marguerite Abernathy-Okonkwo-Lindqvist", "Marguerite", "Marguerite A.", "MA", "marguerite"],
    ["Prof Ada Lovelace", "Ada", "Prof Ada Lovelace", "AL", "ada"],
    ["Mrs. Jane Smith", "Jane", "Mrs. Jane Smith", "JS", "jane"],
    ["J. Robert Oppenheimer", "Robert", "J. Robert Oppenheimer", "JO", "robert"],
    ["A.J. Smith", "A.J.", "A.J. Smith", "AS", "aj"],
    ["Martin Luther King Jr.", "Martin", "Martin Luther King Jr.", "MK", "martin"],
    ["Mr. T", "T", "Mr. T", "T", "t"],
    ["The Octocat", "Octocat", "The Octocat", "O", "octocat"],
    ["🚀 Ana Lima", "Ana", "🚀 Ana Lima", "AL", "ana"],
    ["Zoë Ångström", "Zoë", "Zoë Ångström", "ZÅ", "zoe"],
    ["李小龙", "李小龙", "李小龙", "李", "card"],
    ["Maria de los Angeles Fernandez-Garcia", "Maria", "Maria Fernandez-Garcia", "MF", "maria"],
    ["Bartholomew-Featherstonehaugh-Smythe", "Bartholomew-Featherstonehaugh-Smythe", "Bartholomew", "B", "bartholomewfeatherst"],
  ];
  for (const [given, first, badge, initials, link] of cases) {
    assert.equal(firstName(given), first, given);
    assert.equal(cleanName(given), badge, given);
    assert.equal(initialsOf(cleanName(given)), initials, given);
    assert.equal(slugBase(given), link, given);
    assert.ok(badge.length <= LIMITS.nameHard, given);
    // Every word on the badge is a whole word of the name, so nothing like "Lind" from "Lindqvist".
    const tokens = given.split(" ");
    for (const w of badge.split(" ")) {
      assert.ok(tokens.includes(w) || /^\p{L}\.$/u.test(w) || tokens.some((t) => t.startsWith(`${w}-`)), `${given} gave ${badge}`);
    }
  }

  assert.equal(looksLikePersonName("Linus Torvalds"), true);
  for (const org of ["The Octocat", "Acme Labs", "dev_42", "Vercel Inc.", "rust-lang/rust"]) assert.equal(looksLikePersonName(org), false, org);
  const card = (name, extra) => normalizeCard({ ...DEVON, name }, { source: "github", fallbackName: "octocat", ...extra });
  assert.equal(card("The Octocat", { login: "octocat" }).first, "octocat");
  assert.equal(card("Linus Torvalds", { login: "torvalds" }).first, "Linus");
  assert.equal(normalizeCard({ ...DEVON, name: "The Octocat" }, { source: "resume" }).first, "Octocat");
});

test("the prompt and schema give the model the length limits", () => {
  const request = buildRequest({ source: "github", username: "x", github: {} });
  assert.match(request.instructions, new RegExp(`role: at most ${LIMITS.role} characters`));
  assert.match(request.instructions, /Never end the role or a receipt on a word like at, to, of/);
  assert.match(SCHEMA.properties.role.description, new RegExp(`At most ${LIMITS.role} characters`));
  assert.match(SCHEMA.properties.receipts.items.properties.text.description, new RegExp(`At most ${LIMITS.receipt} characters`));
});

test("votes: one per browser per card, reasons only on their own side, results sorted", () => {
  const db = openDb(":memory:");
  const card = db.createCard({ source: "resume", name: "Maya Okafor", initials: "MO", role: "r", score: 78, verdict: "v", receipts: [] }, "owner-1");
  assert.equal(card.slug, "maya-" + card.slug.split("-")[1], "maya is reserved for the sample, so the slug gets a tail");
  const devon = db.createCard({ source: "github", name: "Devon Park", initials: "DP", role: "r", score: 64, verdict: "v", receipts: [] }, "owner-1");
  assert.match(devon.slug, /^devon-/);
  const zed = db.createCard({ source: "resume", name: "Zed Q", initials: "ZQ", role: "r", score: 1, verdict: "v", receipts: [] }, "owner-2");
  assert.equal(zed.slug, "zed");
  const zed2 = db.createCard({ source: "resume", name: "Zed R", initials: "ZR", role: "r", score: 1, verdict: "v", receipts: [] }, "owner-2");
  assert.match(zed2.slug, /^zed-[a-z0-9]{3}$/);

  assert.ok(db.isOwner(zed.slug, "owner-2"));
  assert.ok(!db.isOwner(zed.slug, "owner-1"));
  assert.ok(!db.isOwner(zed.slug, undefined));

  assert.equal(db.addVote(zed.slug, "v1", "hire").decision, "hire");
  assert.equal(db.addVote(zed.slug, "v1", "pass").decision, "hire", "second vote keeps the first");
  assert.ok(!db.setReason(zed.slug, "v1", "npc"), "a pass reason cannot go on a hire vote");
  assert.ok(db.setReason(zed.slug, "v1", "ships"));
  db.addVote(zed.slug, "v2", "hire"); db.setReason(zed.slug, "v2", "taste");
  db.addVote(zed.slug, "v3", "hire"); db.setReason(zed.slug, "v3", "taste");
  db.addVote(zed.slug, "v4", "pass");
  const r = db.results(zed.slug);
  assert.equal(r.hire, 3);
  assert.equal(r.pass, 1);
  assert.equal(r.percent, 75);
  assert.deepEqual(r.reasons.hire.map((x) => [x.id, x.count]), [["taste", 2], ["ships", 1]]);
  assert.deepEqual(r.reasons.pass, []);
  assert.equal(db.results(zed2.slug).percent, null);

  const hashes = db.raw.prepare("SELECT voter_hash FROM votes").all().map((x) => x.voter_hash);
  assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h) && !h.includes("v1")));

  assert.ok(db.deleteCard(zed.slug));
  assert.equal(db.getCard(zed.slug), undefined);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM votes WHERE card_slug = ?").get(zed.slug).n, 0, "votes go with the card");
});

test("vote limit per network per card, and an older database file gets the new column", () => {
  const dir = mkdtempSync(join(tmpdir(), "hop-old-"));
  try {
    const file = join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE votes (card_slug TEXT NOT NULL, voter_hash TEXT NOT NULL, decision TEXT NOT NULL, reason_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (card_slug, voter_hash));
      INSERT INTO votes VALUES ('x', 'h', 'hire', NULL, 1);`);
    old.close();
    const db = openDb(file);
    assert.ok(db.raw.prepare("PRAGMA table_info(votes)").all().some((c) => c.name === "ip_hash"));
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM votes").get().n, 1, "old votes stay");
    const card = db.createCard({ source: "resume", name: "Ana Lee", initials: "AL", role: "r", score: 50, verdict: "v", receipts: [] }, "owner");
    const lim = { ip: "1.1.1.1", max: 2 };
    assert.equal(db.addVote(card.slug, "v1", "hire", lim).decision, "hire");
    assert.equal(db.addVote(card.slug, "v2", "pass", lim).decision, "pass");
    assert.equal(db.addVote(card.slug, "v3", "hire", lim), null, "a third browser on the same network is refused");
    assert.equal(db.addVote(card.slug, "v1", "pass", lim).decision, "hire", "a repeat vote still returns the first one");
    assert.equal(db.addVote(card.slug, "v3", "hire", { ip: "2.2.2.2", max: 2 }).decision, "hire");
    assert.equal(db.results(card.slug).hire, 2);
    db.raw.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("card making limits: per address per hour, per server per UTC day, set by env", () => {
  const db = openDb(":memory:");
  const rates = { cardsPerIpHour: 2, cardsPerDay: 3 };
  const t0 = Date.parse("2026-11-17T22:00:00Z");
  assert.equal(db.claimMake("1.1.1.1", rates, t0), null);
  assert.equal(db.claimMake("1.1.1.1", rates, t0 + 1000), null);
  assert.equal(db.claimMake("1.1.1.1", rates, t0 + 2000), "ip");
  assert.equal(db.claimMake("1.1.1.1", rates, t0 + 3600_000 + 1), null, "the hour rolls");
  assert.equal(db.claimMake("2.2.2.2", rates, t0 + 3600_000 + 2), "day", "3 cards made today");
  assert.equal(db.claimMake("2.2.2.2", rates, Date.parse("2026-11-18T00:00:01Z")), null, "a new UTC day starts fresh");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM makes").get().n, 4);
  assert.ok(db.raw.prepare("SELECT ip_hash FROM makes").all().every((r) => /^[0-9a-f]{64}$/.test(r.ip_hash)), "addresses are stored as hashes");
  db.claimMake("3.3.3.3", rates, Date.parse("2026-11-20T00:00:00Z"));
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM makes").get().n, 1, "rows older than a day are removed");

  assert.equal(ipKey("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(ipKey("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:0db8:0001:0002:bbbb:cccc:dddd:eeee"), "2001:db8:1:2::/64", "one /64 is one key");
  assert.equal(ipKey("2001:db8::9"), "2001:db8:0:0::/64");
  assert.deepEqual(ratesFromEnv({}), RATE_DEFAULTS);
  assert.deepEqual(RATE_DEFAULTS, { cardsPerIpHour: 5, cardsPerDay: 300, votesPerIpCard: 10 });
  assert.deepEqual(ratesFromEnv({ HOP_CARDS_PER_IP_HOUR: "1", HOP_CARDS_PER_DAY: "0", HOP_VOTES_PER_IP_CARD: "x" }), { cardsPerIpHour: 1, cardsPerDay: 0, votesPerIpCard: 10 });
});

test("github input: usernames and activity", () => {
  assert.equal(cleanUsername("https://github.com/torvalds/linux"), "torvalds");
  assert.equal(cleanUsername("@octo-cat"), "octo-cat");
  assert.equal(cleanUsername("bad name"), null);
  assert.equal(cleanUsername("-x"), null);
  const now = Date.parse("2026-11-16T12:00:00Z");
  // Live push events have no size field any more, as here. The data counts pushes and has no commit count.
  const a = activity([
    { type: "PushEvent", created_at: "2026-11-15T05:00:00Z", payload: { push_id: 1, ref: "refs/heads/main" } },
    { type: "PushEvent", created_at: "2026-11-14T05:30:00Z", payload: { push_id: 2, ref: "refs/heads/main" } },
    { type: "WatchEvent", created_at: "2026-11-13T05:30:00Z" },
    { type: "PushEvent", created_at: "2026-11-10T22:00:00Z", payload: { push_id: 3, ref: "refs/heads/main" } },
  ], now);
  assert.equal(a.pushes, 3);
  assert.equal("commits" in a, false);
  assert.ok(!Object.keys(a).some((k) => /commit/i.test(k)));
  assert.equal(a.activeDays, 3);
  assert.equal(a.longestStreakDays, 2);
  assert.equal(a.pushesByUtcHour[5], 2);
  // The prompt asks for push hours, says the numbers are pushes, and its sample card says pushes.
  assert.match(SYSTEM, /push hours or streaks/);
  assert.match(SYSTEM, /never call them commits/);
  assert.doesNotMatch(SYSTEM, /commit hours|Commits after/);
  assert.equal(DEVON.receipts[2].text, "Pushes after 1am, most nights");
});


test("AI step streams fields in badge order and returns a clean card", async () => {
  const client = fakeClient(JSON.stringify(DEVON));
  const events = [];
  const card = await makeCard({ source: "github", username: "devon", github: { login: "devon" }, photoUrl: "https://avatars.githubusercontent.com/u/1" }, { client, onEvent: (e) => events.push(e) });
  const order = events.map((e) => e.t).filter((t, i, a) => t !== "verdict" || a[i - 1] !== "verdict");
  assert.deepEqual(order, ["name", "role", "receipt", "receipt", "receipt", "score", "verdict"]);
  assert.equal(events.find((e) => e.t === "name").initials, "DP");
  assert.equal(events.filter((e) => e.t === "receipt")[2].text, "Pushes after 1am, most nights");
  assert.equal(events.at(-1).text, DEVON.verdict);
  assert.ok(events.filter((e) => e.t === "verdict").length > 3, "the verdict arrives in pieces");
  assert.equal(card.photoUrl, "https://avatars.githubusercontent.com/u/1");
  assert.equal(card.score, 64);
  const p = client.calls[0];
  assert.equal(p.model, "gpt-5.5");
  assert.equal(p.stream, true);
  assert.deepEqual(p.reasoning, { effort: "low" });
  assert.equal(p.store, false);
  assert.deepEqual({ ...p.text.format, schema: undefined }, { type: "json_schema", name: "badge_card", strict: true, schema: undefined });
  assert.equal(p.instructions, SYSTEM);
  assert.equal(p.input[0].content[0].type, "input_text");
});

test("the card schema meets OpenAI strict mode: every object closed, every key required", () => {
  const walk = (s, path) => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === "array") walk(s.items, `${path}[]`);
  };
  walk(SCHEMA, "card");
});

test("AI step errors: no key, unreadable input, refusal, cut off, API errors", async () => {
  const pdf = { source: "resume", pdf: Buffer.from("%PDF-1") };
  await assert.rejects(makeCard(pdf, { client: null }), (e) => e instanceof CardError && e.code === "setup");
  const junk = fakeClient(JSON.stringify({ readable: false, name: "", role: "", receipts: [], score: 0, verdict: "" }));
  const seen = [];
  await assert.rejects(makeCard(pdf, { client: junk, onEvent: (e) => seen.push(e) }), (e) => e.code === "unreadable" && !e.retry);
  assert.deepEqual(seen, []);
  await assert.rejects(makeCard(pdf, { client: fakeClient("", { end: "refusal" }) }), (e) => e.code === "refusal" && !e.retry);
  await assert.rejects(makeCard(pdf, { client: fakeClient(JSON.stringify(DEVON), { end: "content_filter" }) }), (e) => e.code === "refusal");
  await assert.rejects(makeCard(pdf, { client: fakeClient(JSON.stringify(DEVON).slice(0, 40), { end: "max_output_tokens" }) }), (e) => e.code === "ai" && e.retry);

  const throwing = (err) => ({ responses: { create: async () => { throw err; } } });
  const apiError = (Cls, status, code) => new Cls(status, { message: "x", code }, "x", new Headers());
  const cases = [
    [apiError(OpenAI.AuthenticationError, 401), "setup"],
    [apiError(OpenAI.PermissionDeniedError, 403), "setup"],
    [apiError(OpenAI.RateLimitError, 429, "rate_limit_exceeded"), "busy"],
    [apiError(OpenAI.RateLimitError, 429, "insufficient_quota"), "setup"],
    [apiError(OpenAI.BadRequestError, 400), "bad_input"],
    [apiError(OpenAI.InternalServerError, 500), "ai"],
  ];
  for (const [err, code] of cases) await assert.rejects(makeCard(pdf, { client: throwing(err) }), (e) => e.code === code, `${err.status} ${err.code}`);

  const req = buildRequest({ source: "linkedin", pdf: Buffer.from("%PDF-1") });
  const file = req.input[0].content[0];
  assert.equal(file.type, "input_file");
  assert.equal(file.filename, "linkedin.pdf");
  assert.equal(file.file_data, "data:application/pdf;base64," + Buffer.from("%PDF-1").toString("base64"));
  assert.match(req.input[0].content[1].text, /LinkedIn/);
});
