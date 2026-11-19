// GitHub data from the official public REST API only. No scraping.
// Without GITHUB_TOKEN the API allows 60 requests an hour per server, and one card uses 3.

export class GithubError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function cleanUsername(raw) {
  let s = String(raw ?? "").trim();
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  return NAME_RE.test(s) ? s : null;
}

async function get(path, fetchImpl) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "hire-or-pass", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res;
  try {
    res = await fetchImpl(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new GithubError("network", "GitHub did not answer. Try again.");
  }
  if (res.status === 404) throw new GithubError("not_found", "No GitHub user with that name.");
  if (res.status === 403 || res.status === 429) throw new GithubError("rate", "GitHub is busy. Try again in a few minutes.");
  if (!res.ok) throw new GithubError("network", "GitHub did not answer. Try again.");
  return res.json();
}

// Activity from public events: the API keeps 90 days and 300 events at most.
// Every number here counts pushes. Push events from GitHub no longer say how many commits a push holds,
// so there is no commit count, and the prompt tells the model never to call these numbers commits.
export function activity(events, now = Date.now()) {
  const pushes = (Array.isArray(events) ? events : []).filter((e) => e && e.type === "PushEvent" && e.created_at);
  const days = new Set();
  const hoursUtc = Array(24).fill(0);
  for (const e of pushes) {
    const d = new Date(e.created_at);
    days.add(d.toISOString().slice(0, 10));
    hoursUtc[d.getUTCHours()] += 1;
  }
  const sorted = [...days].sort();
  let streak = 0, run = 0, last = null;
  for (const day of sorted) {
    const t = Date.parse(day);
    run = last !== null && t - last === 86400000 ? run + 1 : 1;
    streak = Math.max(streak, run);
    last = t;
  }
  const since = pushes.length ? Math.round((now - Date.parse(pushes[pushes.length - 1].created_at)) / 86400000) : 0;
  return { pushes: pushes.length, activeDays: days.size, longestStreakDays: streak, coversLastDays: since, pushesByUtcHour: hoursUtc };
}

export async function fetchGithub(username, { fetchImpl = fetch } = {}) {
  const user = await get(`/users/${username}`, fetchImpl);
  const [repos, events] = await Promise.all([
    get(`/users/${username}/repos?per_page=100&sort=pushed`, fetchImpl),
    get(`/users/${username}/events/public?per_page=100`, fetchImpl).catch(() => []),
  ]);
  const own = (Array.isArray(repos) ? repos : []).filter((r) => !r.fork);
  const languages = {};
  for (const r of own) if (r.language) languages[r.language] = (languages[r.language] || 0) + 1;
  const top = [...own].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 25);
  const data = {
    login: user.login,
    name: user.name || null,
    bio: user.bio || null,
    company: user.company || null,
    location: user.location || null,
    blog: user.blog || null,
    followers: user.followers,
    publicRepos: user.public_repos,
    accountCreated: user.created_at,
    ownRepos: own.length,
    forkedRepos: (Array.isArray(repos) ? repos.length : 0) - own.length,
    tinyReposUnder10kb: own.filter((r) => r.size < 10).length,
    languagesByRepoCount: languages,
    repos: top.map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      topics: r.topics,
      homepage: r.homepage || null,
      created: r.created_at?.slice(0, 10),
      lastPush: r.pushed_at?.slice(0, 10),
      archived: r.archived,
    })),
    activity: activity(events),
  };
  return { data, photoUrl: user.avatar_url || null, repoCount: user.public_repos ?? own.length, displayName: user.name || user.login };
}
