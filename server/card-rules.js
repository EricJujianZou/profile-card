// Content rules for a card: limits from DESIGN.md section 4, the fixed reason chips, slugs and initials.

export const ICONS = ["briefcase", "code", "award", "star", "moon"];

export const LIMITS = { name: 18, nameHard: 26, role: 36, verdict: 120, receipt: 34 };

export const REASONS = {
  hire: [
    { id: "ships", text: "Ships real stuff" },
    { id: "projects", text: "Cracked projects" },
    { id: "experience", text: "Real experience" },
    { id: "taste", text: "Good taste" },
    { id: "coffee", text: "Would grab coffee" },
    { id: "main-character", text: "Main character energy" },
  ],
  pass: [
    { id: "tutorial", text: "Tutorial projects" },
    { id: "buzzwords", text: "Too many buzzwords" },
    { id: "needs-experience", text: "Needs experience" },
    { id: "nothing-shipped", text: "Nothing shipped yet" },
    { id: "npc", text: "NPC resume" },
    { id: "not-my-field", text: "Not my field" },
  ],
};

export function reasonKind(id) {
  if (REASONS.hire.some((r) => r.id === id)) return "hire";
  if (REASONS.pass.some((r) => r.id === id)) return "pass";
  return null;
}

// Paths the app uses, plus the two sample names, so no card can take them.
export const RESERVED = new Set(["api", "static", "healthz", "favicon.ico", "robots.txt", "maya", "devon", "results", "make"]);

// Sample card on the make screen. Sample data only, not a real person.
export const SAMPLE = {
  slug: "maya",
  source: "resume",
  name: "Maya Okafor",
  initials: "MO",
  photoUrl: null,
  role: "3rd year CS at Waterloo",
  score: 78,
  verdict: "Two internships and a Chrome extension people actually use. Please stop listing Microsoft Word.",
  receipts: [
    { icon: "briefcase", text: "Backend intern, twice" },
    { icon: "code", text: "Chrome extension, 3,100 users" },
    { icon: "award", text: "1st of 214 teams at a hackathon" },
  ],
};

const squash = (s) => String(s ?? "").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\s+/g, " ").trim();

// Words a cut line must never end on.
const DANGLING = new Set(["a", "an", "the", "and", "or", "but", "nor", "at", "@", "to", "of", "in", "on", "for", "with", "by", "from", "into",
  "onto", "via", "as", "per", "than", "vs", "plus", "using", "including", "while", "since", "that", "which", "who", "about", "across", "after",
  "before", "between", "during", "within", "without", "like", "such", "used", "based", "my", "our", "their", "his", "her", "its",
  "&", "+", "-", "/", "|", "·"]);
// Words that start a new phrase, so a cut just before one keeps whole phrases. "of" is not here: it sits inside names like Bank of Canada.
const PHRASE = new Set(["at", "@", "with", "for", "in", "on", "using", "via", "by", "from", "to", "and", "or", "while", "including", "plus", "since", "&", "+"]);
// Words that can sit inside a name after "at" (Ernst and Young, Bank of Montreal), so a cut there would change the name.
const NAME_GLUE = new Set(["and", "&", "+", "of", "the"]);
const SEPARATORS = new Set(["|", "·", "/", "-"]);
const RANGE = new Set(["to", "through", "until", "-"]);
const MONTH = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?,?$/i;

const bare = (w) => String(w ?? "").toLowerCase().replace(/[.,;:]+$/, "");
const numberish = (w) => /^\(?[$#]?\d/.test(w ?? "") || MONTH.test(w ?? "") || /^(present|now|today)\b/i.test(w ?? "");

// Drops what a cut leaves hanging at the end: separators, words like "at" or "to", and a bracket that never closes.
function tidy(s) {
  const words = s.split(" ").filter(Boolean);
  while (words.length) {
    const last = words[words.length - 1].replace(/[,;:(]+$/, "");
    if (!last || /^[|·/&+@-]+$/.test(last) || (words.length > 1 && DANGLING.has(bare(last)))) { words.pop(); continue; }
    words[words.length - 1] = last;
    break;
  }
  const out = words.join(" ");
  const open = out.lastIndexOf("(");
  return open >= 0 && !out.includes(")", open) ? tidy(out.slice(0, open)) : out;
}

const isAt = (w) => ["at", "@"].includes(bare(w));

// The places a line may be cut, as "keep words before index k".
// kind 3 is the end, 2 the end of a clause, 1 the start of a new phrase, 0 a plain word break.
// No cut splits a date range like "2016 to 2019". Inside the name after "at", a word break needs two whole words of the name.
function cutPoints(words) {
  const points = [];
  let at = -1;
  for (let k = 1; k < words.length; k++) {
    const prev = words[k - 1], next = words[k];
    if (isAt(prev)) at = k - 1;
    if (/[,;]$/.test(prev) || SEPARATORS.has(next)) { points.push({ k, kind: 2 }); at = -1; continue; }
    const inRange = (RANGE.has(bare(next)) && numberish(prev) && numberish(words[k + 1]))
      || (RANGE.has(bare(prev)) && numberish(words[k - 2]) && numberish(next))
      || (MONTH.test(prev) && /^\d/.test(next));
    if (inRange) continue;
    const phrase = PHRASE.has(bare(next));
    if (at < 0) { points.push({ k, kind: phrase ? 1 : 0 }); continue; }
    if (phrase && !NAME_GLUE.has(bare(next))) { points.push({ k, kind: 1 }); at = -1; }
    else if (k - at - 1 >= 2 && !NAME_GLUE.has(bare(prev)) && !DANGLING.has(bare(prev))) points.push({ k, kind: 0, inName: true });
  }
  points.push({ k: words.length, kind: 3 });
  return points;
}

// Cuts a role or receipt that is over the limit so it still reads as a whole, true phrase.
// In order: drop asides in brackets, keep whole clauses, keep the employer or school after "at",
// keep whole phrases, then keep whole words. A single word longer than the limit is the only thing cut inside a word.
export function clip(text, max) {
  const s = squash(text);
  if (s.length <= max) return s;
  const noAside = squash(s.replace(/\s*\([^)]*\)/g, ""));
  if (noAside && noAside.length <= max) return tidy(noAside);
  const t = noAside || s;
  const words = t.split(" ");
  const points = cutPoints(words);
  const fit = (from, list) => list
    .map((p) => ({ kind: p.kind, kept: tidy(words.slice(from, p.k).join(" ")) }))
    .filter((c) => c.kept && c.kept.length <= max);
  const cuts = fit(0, points);

  // "Data Engineering Intern at Royal Bank of Canada" becomes "Intern at Royal Bank of Canada".
  // Words before "at" are dropped from the front only when they read as a job title: no number, no clause,
  // no small words like "the" or "of". So "Led the migration of a monolith to services at scale" keeps its verb.
  const at = words.findIndex((w, i) => i > 0 && isAt(w));
  const withOrg = [];
  let partOrg = [];
  if (at > 0) {
    const ends = points.filter((p) => p.k > at + 1 && p.kind >= 1);
    const canDrop = !words.slice(0, at).some((w) => /[\d,;:]/.test(w) || DANGLING.has(bare(w)));
    for (let from = 0; from < (canDrop ? at : 1); from++) {
      if (from > 0 && DANGLING.has(bare(words[from]))) continue;
      for (const c of fit(from, ends)) withOrg.push({ from, kept: c.kept[0].toUpperCase() + c.kept.slice(1) });
    }
    // Last choice for the name: its first whole words, as in "1st of 214 teams at Hack the North".
    partOrg = fit(0, points.filter((p) => p.inName));
  }

  const longest = (list) => list.sort((a, b) => b.kept.length - a.kept.length)[0]?.kept;
  const hard = t.slice(0, max);
  const atBreak = Math.max(hard.lastIndexOf("-"), hard.lastIndexOf("/"));
  return longest(cuts.filter((c) => c.kind >= 2 && c.kept.length >= max / 2))
    ?? withOrg.sort((a, b) => a.from - b.from || b.kept.length - a.kept.length)[0]?.kept
    ?? longest(partOrg)
    ?? longest(cuts.filter((c) => c.kind >= 1 && (c.kept.includes(" ") || c.kept.length >= max / 3)))
    ?? longest(cuts)
    ?? (atBreak >= max / 2 ? hard.slice(0, atBreak) : hard);
}

// The verdict keeps whole sentences when it is too long, and only cuts words as a last resort.
export function clipVerdict(text) {
  const s = squash(text);
  if (s.length <= LIMITS.verdict) return s;
  const sentences = s.match(/[^.!?]+[.!?]+/g) || [];
  let out = "";
  for (const sentence of sentences) {
    const next = (out + " " + sentence.trim()).trim();
    if (next.length > LIMITS.verdict) break;
    out = next;
  }
  return out || clip(s, LIMITS.verdict);
}

// Titles and small words that come before a name and are never the first name.
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "sir", "dame", "rev", "hon", "the", "a", "an"]);
// Words that come after a name and are never the last name.
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "mba", "esq", "cpa", "pe"]);
const key = (w) => w.toLowerCase().replace(/\./g, "").replace(/,$/, "");
const hasLetter = (w) => /\p{L}/u.test(w);
const isInitial = (w) => /^\p{L}\.?$/u.test(w);

// The words of a name without titles in front or suffixes at the end. Emoji and other words with no letter are dropped.
function nameWords(name) {
  const words = squash(name).split(" ").map((w) => w.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[,;:!?]+$/, "")).filter(hasLetter);
  let i = 0;
  while (i < words.length - 1 && HONORIFICS.has(key(words[i]))) i++;
  let j = words.length;
  while (j > i + 1 && SUFFIXES.has(key(words[j - 1]))) j--;
  return words.slice(i, j);
}

// The name a card calls the person by, as in "Would you hire Marguerite?".
// It skips titles ("Dr.", "Prof"), a leading "The", and a single initial ("J. Robert" gives Robert).
export function firstName(name) {
  const words = nameWords(name);
  const real = words.findIndex((w, i) => !isInitial(w) || i === words.length - 1);
  const first = words[Math.max(0, real)] ?? "";
  return /^(\p{L}\.)+$/u.test(first) && first.length > 2 ? first : first.replace(/\.$/, "");
}

// A GitHub display name such as "The Octocat", "Acme Labs" or "dev_42" is not a person's name,
// so the card uses the login there instead.
export function looksLikePersonName(name) {
  const s = squash(name);
  if (!s || /[\d_@#/\\]/.test(s)) return false;
  const words = s.split(" ").map(key);
  if (["the", "a", "an"].includes(words[0])) return false;
  const ORG = new Set(["inc", "llc", "ltd", "labs", "lab", "team", "bot", "hq", "org", "corp", "co", "foundation", "official", "studio", "studios", "group", "project", "community", "company", "software", "games", "dev", "devs"]);
  return !words.some((w) => ORG.has(w));
}

// Keeps the name as written when it fits. A long name keeps whole words only:
// first and last name, then the first name and last initial, then the first name.
export function cleanName(name) {
  const s = squash(name);
  if (s.length <= LIMITS.nameHard) return s;
  const words = nameWords(s);
  if (!words.length) return s.slice(0, LIMITS.nameHard);
  const first = firstName(s);
  const last = words[words.length - 1];
  const options = last === first ? [words.join(" "), first] : [words.join(" "), `${first} ${last}`, `${first} ${[...last][0]}.`, first];
  const fits = options.find((o) => o.length <= LIMITS.nameHard);
  if (fits) return fits;
  // One very long word: keep the parts before a hyphen that fit, and cut inside a word only when there is no hyphen.
  const hard = [...first].slice(0, LIMITS.nameHard).join("");
  const hyphen = hard.lastIndexOf("-");
  return hyphen > 0 ? hard.slice(0, hyphen) : hard;
}

export function initialsOf(name) {
  const words = nameWords(name);
  if (!words.length) return [...squash(name)][0]?.toUpperCase() || "?";
  const first = [...words[0]][0] || "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] || "" : "";
  return (first + last).toUpperCase();
}

// The link is the first name, as plain letters and digits. firstName takes care of titles and initials.
export function slugBase(name) {
  const base = firstName(name).normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 20);
  return base || "card";
}

// Turns the model's JSON into a card the badge can hold. Throws when there is nothing usable.
// login is the GitHub username, used as the first name when the display name is not a person's name.
export function normalizeCard(raw, { source, photoUrl = null, fallbackName = "", login = null }) {
  if (!raw || typeof raw !== "object") throw new Error("empty result");
  const name = cleanName(raw.name || fallbackName);
  if (!name) throw new Error("no name");
  const first = source === "github" && login && !looksLikePersonName(name) ? login : firstName(name) || name;
  const receipts = (Array.isArray(raw.receipts) ? raw.receipts : [])
    .filter((r) => r && r.text)
    .slice(0, 3)
    .map((r) => ({ icon: ICONS.includes(r.icon) ? r.icon : "star", text: clip(r.text, LIMITS.receipt) }));
  const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
  const verdict = clipVerdict(raw.verdict);
  if (!verdict) throw new Error("no verdict");
  return {
    source,
    name,
    first,
    initials: initialsOf(name),
    photoUrl: photoUrl || null,
    role: clip(raw.role, LIMITS.role),
    score,
    verdict,
    receipts,
  };
}
