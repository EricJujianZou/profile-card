// Cards and votes in one SQLite file. Voters are stored only as a salted hash, one vote per voter per card.

import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { REASONS, RESERVED, reasonKind, slugBase, firstName } from "./card-rules.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function openDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cards (
      slug TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      initials TEXT NOT NULL,
      photo_url TEXT,
      role TEXT NOT NULL,
      score INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      receipts TEXT NOT NULL,
      owner_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS votes (
      card_slug TEXT NOT NULL REFERENCES cards(slug) ON DELETE CASCADE,
      voter_hash TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('hire', 'pass')),
      reason_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (card_slug, voter_hash)
    );
    CREATE TABLE IF NOT EXISTS makes (ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS makes_by_ip ON makes (ip_hash, created_at);
    CREATE INDEX IF NOT EXISTS makes_by_time ON makes (created_at);
  `);

  // Older files have no ip_hash column on votes. It holds a salted hash of the voter's network, per card, for the vote limit.
  if (!db.prepare("PRAGMA table_info(votes)").all().some((c) => c.name === "ip_hash")) db.exec("ALTER TABLE votes ADD COLUMN ip_hash TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS votes_by_ip ON votes (card_slug, ip_hash)");
  // Older files have no first_name column on cards. Cards from before it get their first name from the name.
  if (!db.prepare("PRAGMA table_info(cards)").all().some((c) => c.name === "first_name")) db.exec("ALTER TABLE cards ADD COLUMN first_name TEXT");

  let salt = db.prepare("SELECT value FROM meta WHERE key = 'salt'").get()?.value;
  if (!salt) {
    salt = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO meta (key, value) VALUES ('salt', ?)").run(salt);
  }

  const q = {
    card: db.prepare("SELECT * FROM cards WHERE slug = ?"),
    insert: db.prepare(`INSERT INTO cards (slug, source, name, first_name, initials, photo_url, role, score, verdict, receipts, owner_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    del: db.prepare("DELETE FROM cards WHERE slug = ?"),
    vote: db.prepare("SELECT decision, reason_id FROM votes WHERE card_slug = ? AND voter_hash = ?"),
    addVote: db.prepare("INSERT OR IGNORE INTO votes (card_slug, voter_hash, decision, reason_id, ip_hash, created_at) VALUES (?, ?, ?, NULL, ?, ?)"),
    votesByIp: db.prepare("SELECT COUNT(*) AS n FROM votes WHERE card_slug = ? AND ip_hash = ?"),
    setReason: db.prepare("UPDATE votes SET reason_id = ? WHERE card_slug = ? AND voter_hash = ? AND decision = ?"),
    counts: db.prepare("SELECT decision, reason_id, COUNT(*) AS n FROM votes WHERE card_slug = ? GROUP BY decision, reason_id"),
    makesSince: db.prepare("SELECT COUNT(*) AS n FROM makes WHERE created_at >= ?"),
    makesByIp: db.prepare("SELECT COUNT(*) AS n FROM makes WHERE ip_hash = ? AND created_at > ?"),
    addMake: db.prepare("INSERT INTO makes (ip_hash, created_at) VALUES (?, ?)"),
    pruneMakes: db.prepare("DELETE FROM makes WHERE created_at < ?"),
  };

  const ownerHash = (browserId) => sha(`owner:${browserId}`);
  const voterHash = (slug, browserId) => sha(`${salt}:${slug}:${browserId}`);
  const toCard = (row) => row && {
    slug: row.slug,
    source: row.source,
    name: row.name,
    first: row.first_name || firstName(row.name) || row.name,
    initials: row.initials,
    photoUrl: row.photo_url,
    role: row.role,
    score: row.score,
    verdict: row.verdict,
    receipts: JSON.parse(row.receipts),
    createdAt: row.created_at,
  };

  function freeSlug(name) {
    const base = slugBase(name);
    const taken = (s) => RESERVED.has(s) || q.card.get(s);
    if (!taken(base)) return base;
    const abc = "abcdefghjkmnpqrstuvwxyz23456789";
    for (;;) {
      const tail = Array.from(randomBytes(3), (b) => abc[b % abc.length]).join("");
      if (!taken(`${base}-${tail}`)) return `${base}-${tail}`;
    }
  }

  return {
    raw: db,
    getCard: (slug) => toCard(q.card.get(slug)),

    createCard(card, browserId) {
      const first = card.first || firstName(card.name) || card.name;
      const slug = freeSlug(first);
      q.insert.run(slug, card.source, card.name, first, card.initials, card.photoUrl ?? null, card.role, card.score, card.verdict,
        JSON.stringify(card.receipts), ownerHash(browserId), Date.now());
      return this.getCard(slug);
    },

    isOwner(slug, browserId) {
      if (!browserId) return false;
      const row = q.card.get(slug);
      if (!row) return false;
      const a = Buffer.from(row.owner_hash, "hex");
      const b = Buffer.from(ownerHash(browserId), "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    },

    deleteCard: (slug) => q.del.run(slug).changes > 0,

    // Takes one card-making slot for this address and returns null, or returns "day" or "ip" when a limit is hit.
    // The day is the UTC day. The address is kept only as a salted hash, and only for one day.
    claimMake(ip, { cardsPerIpHour, cardsPerDay }, now = Date.now()) {
      q.pruneMakes.run(now - 86400000);
      if (q.makesSince.get(now - (now % 86400000)).n >= cardsPerDay) return "day";
      const ipHash = sha(`${salt}:make:${ip}`);
      if (q.makesByIp.get(ipHash, now - 3600000).n >= cardsPerIpHour) return "ip";
      q.addMake.run(ipHash, now);
      return null;
    },

    voteOf(slug, browserId) {
      if (!browserId) return null;
      const row = q.vote.get(slug, voterHash(slug, browserId));
      return row ? { decision: row.decision, reasonId: row.reason_id } : null;
    },

    // Returns the vote that counts. A second vote from the same browser keeps the first one.
    // With ip and max, a network that already gave max votes on this card gets null and the vote is not saved.
    addVote(slug, browserId, decision, { ip = null, max = Infinity } = {}) {
      const earlier = this.voteOf(slug, browserId);
      if (earlier) return earlier;
      const ipHash = ip ? sha(`${salt}:vote:${slug}:${ip}`) : null;
      if (ipHash && q.votesByIp.get(slug, ipHash).n >= max) return null;
      q.addVote.run(slug, voterHash(slug, browserId), decision, ipHash, Date.now());
      return this.voteOf(slug, browserId);
    },

    setReason(slug, browserId, reasonId) {
      const kind = reasonKind(reasonId);
      if (!kind) return false;
      return q.setReason.run(reasonId, slug, voterHash(slug, browserId), kind).changes > 0;
    },

    results(slug) {
      const rows = q.counts.all(slug);
      const total = { hire: 0, pass: 0 };
      const byReason = {};
      for (const r of rows) {
        total[r.decision] += r.n;
        if (r.reason_id) byReason[r.reason_id] = (byReason[r.reason_id] || 0) + r.n;
      }
      const list = (kind) => REASONS[kind]
        .map((r) => ({ id: r.id, text: r.text, count: byReason[r.id] || 0 }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count);
      const votes = total.hire + total.pass;
      return {
        hire: total.hire,
        pass: total.pass,
        percent: votes ? Math.round((total.hire / votes) * 100) : null,
        reasons: { hire: list("hire"), pass: list("pass") },
      };
    },
  };
}
