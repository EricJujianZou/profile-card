/* hire or pass: card data and the badge component. Shared by the app, the story image and the link preview image. */

const CARDS = {
  maya: {
    initials: "MO",
    score: 78,
    name: "Maya Okafor",
    role: "3rd year CS at Waterloo",
    verdict: "Two internships and a Chrome extension people actually use. Please stop listing Microsoft Word.",
    receipts: [
      ["briefcase", "Backend intern, twice"],
      ["code", "Chrome extension, 3,100 users"],
      ["award", "1st of 214 teams at a hackathon"],
    ],
    link: "hireorpass.com/maya",
    source: "resume",
  },
  devon: {
    initials: "DP",
    score: 64,
    name: "Devon Park",
    role: "4th year CS at UBC",
    verdict: "41 repos and 30 of them say initial commit. The Rust one is actually good.",
    receipts: [
      ["code", "Mostly TypeScript and Rust"],
      ["star", "212 stars on one repo"],
      ["moon", "Commits after 1am, most nights"],
    ],
    link: "hireorpass.com/devon",
    source: "github",
  },
};

/* receipt icons are inlined so the badge renders the same on the story and link preview pages */
const PATHS = {
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
const icon = (id) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${PATHS[id]}</svg>`;

/* ---------- the badge component ---------- */
function badgeHTML(c) {
  return `
  <article class="badge" data-band="candidate" aria-label="${c.name}, AI score ${c.score}">
    <div class="b-id">
      <div class="b-photo" data-f="photo" aria-hidden="true">${c.initials}</div>
      <div class="b-score"><span class="b-num" data-f="score">${c.score}</span><span class="b-cap">AI score</span></div>
    </div>
    <h2 class="b-name" data-f="name">${c.name}</h2>
    <p class="b-role" data-f="role">${c.role}</p>
    <p class="b-verdict" data-f="verdict">${c.verdict}</p>
    <ul class="b-receipts">
      ${c.receipts.map(([i, t]) => `<li data-f="receipt">${icon(i)}<span>${t}</span></li>`).join("")}
    </ul>
    <p class="b-link">${c.link}</p>
    <div class="b-band"><span class="b-band-fill"></span><span class="b-band-text">Candidate</span></div>
  </article>`;
}

const STRAP = Array(14).fill("hire or pass").join(" ");
const CLIP = `
  <svg class="clip" viewBox="0 0 34 46" aria-hidden="true">
    <rect class="md" x="2" y="0" width="30" height="10" rx="2"/>
    <rect class="ring" x="11.5" y="8.5" width="11" height="12" rx="5.5"/>
    <rect class="m" x="8" y="19" width="18" height="16" rx="4"/>
    <rect class="md" x="11" y="23.5" width="12" height="3" rx="1.5"/>
    <rect class="md" x="13" y="33" width="8" height="13" rx="2"/>
  </svg>`;

function mountHang(el) {
  const c = CARDS[el.dataset.card];
  el.innerHTML = `<div class="strap" aria-hidden="true"><span>${STRAP}</span></div>${CLIP}${badgeHTML(c)}`;
}

