/* hire or pass: the badge component. Shared by the app, the story image and the link preview image. */

/* receipt icons are inlined so the badge renders the same on the story and link preview pages */
const PATHS = {
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
const escHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const iconSVG = (id) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${PATHS[id] || PATHS.star}</svg>`;
const photoHTML = (c) => (c.photoUrl ? `<img src="${escHTML(c.photoUrl)}" alt="">` : escHTML(c.initials));

/* Placeholder text that sizes the grey blanks while a card is being made. Never shown as text. */
const BLANK_CARD = {
  name: "Xxxxxx Xxxxx", initials: "", photoUrl: null, role: "Xxxxxxxxxxxxxxxxxxxxxx", score: 88,
  verdict: "Xxxxx xxxxxxxxxxx xxx x Xxxxxx xxxxxxxxx xxxxxx xxxxxxxxxx xxx xxxx xxxxx xxxx xxxx Xxxxxxxxx",
  receipts: [{ icon: "code", text: "Xxxxxxxx xxxxxxxxx" }, { icon: "code", text: "Xxxxxxxxx xxxxxxxxxxxx" }, { icon: "code", text: "Xxxxxxx xxxxxxxx" }],
};

/* ---------- the badge component ---------- */
function badgeHTML(c, link) {
  const long = [...c.name].length > 18 ? " is-long" : "";
  return `
  <article class="badge" data-band="candidate" aria-label="${escHTML(c.name)}, AI score ${Number(c.score)}">
    <div class="b-id">
      <div class="b-photo" data-f="photo" aria-hidden="true">${photoHTML(c)}</div>
      <div class="b-score"><span class="b-num" data-f="score">${Number(c.score)}</span><span class="b-cap">AI score</span></div>
    </div>
    <h2 class="b-name${long}" data-f="name">${escHTML(c.name)}</h2>
    <p class="b-role" data-f="role">${escHTML(c.role)}</p>
    <p class="b-verdict" data-f="verdict">${escHTML(c.verdict)}</p>
    <ul class="b-receipts">
      ${c.receipts.map((r) => `<li data-f="receipt">${iconSVG(r.icon)}<span>${escHTML(r.text)}</span></li>`).join("")}
    </ul>
    <p class="b-link">${escHTML(link)}</p>
    <div class="b-band"><span class="b-band-fill"></span><span class="b-band-text">Candidate</span></div>
  </article>`;
}

const STRAP = Array(14).fill("hire or pass").join(" ");
const CLIP = `
  <svg class="clip" viewBox="0 0 34 46" aria-hidden="true">
    <rect class="md" x="2" y="0" width="30" height="10" rx="2"/>
    <rect class="ring" x="11.5" y="8.5" width="11" height="12" rx="5.5"/>
    <rect class="m" x="8" y="19" width="18" height="16" rx="4"/>
    <rect class="md" x="11" y="23.5" width="12" height="3" rx="1.5"/>
    <rect class="md" x="13" y="33" width="8" height="13" rx="2"/>
  </svg>`;

function mountHang(el, card, link) {
  el.innerHTML = `<div class="strap" aria-hidden="true"><span>${STRAP}</span></div>${CLIP}${badgeHTML(card, link)}`;
}
