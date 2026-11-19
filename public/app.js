/* hire or pass: the live app. Loads after card.js. The server puts the page state in window.BOOT. */

const B = window.BOOT;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const track = (name, data) => { try { window.umami?.track(name, data); } catch (_) {} };
const firstName = (c) => c.first || c.name.split(" ")[0];

const state = {
  card: B.card || null,
  link: B.link || "",
  url: B.url || "",
  owner: !!B.owner,
  vote: B.vote || null,
  storyFile: null,
};

function setBand(badge, kind, text) {
  badge.dataset.band = kind;
  $(".b-band-text", badge).textContent = text ?? { candidate: "Candidate", hire: "Hire", pass: "Pass" }[kind];
}

/* ---------- swing: the whole lanyard pivots from the top of the screen ---------- */
function swing(hang, { onVote } = {}) {
  let x0 = 0, dx = 0, t0 = 0, active = false, pivot = 300;
  const angleFor = (d) => Math.max(-24, Math.min(24, (Math.atan2(d, pivot) * 180) / Math.PI));
  const badge = () => $(".badge", hang);

  hang.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".badge");
    if (!b || hang.dataset.locked) return;
    active = true; x0 = e.clientX; dx = 0; t0 = performance.now();
    pivot = b.getBoundingClientRect().top + b.offsetHeight / 2 - hang.getBoundingClientRect().top;
    b.setPointerCapture(e.pointerId);
    hang.getAnimations().forEach((a) => a.cancel());
  });
  hang.addEventListener("pointermove", (e) => {
    if (!active) return;
    dx = e.clientX - x0;
    const a = angleFor(dx);
    hang.style.transform = `rotate(${-a}deg)`;
    if (onVote) setBand(badge(), Math.abs(a) > 3 ? (a > 0 ? "hire" : "pass") : "candidate");
  });
  const end = () => {
    if (!active) return;
    active = false;
    const a = angleFor(dx);
    const fast = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.6;
    hang.style.transform = "";
    if (onVote && (Math.abs(dx) > 72 || (fast && Math.abs(dx) > 24))) {
      onVote(dx > 0 ? "hire" : "pass", -a);
    } else {
      settle(hang, -a);
      if (onVote) setBand(badge(), "candidate");
    }
  };
  hang.addEventListener("pointerup", end);
  hang.addEventListener("pointercancel", end);
}

function settle(hang, from) {
  if (REDUCED || !from) return;
  hang.animate(
    [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${-from * 0.3}deg)` }, { transform: `rotate(${from * 0.08}deg)` }, { transform: "rotate(0deg)" }],
    { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
}

function entrance(hang) {
  if (REDUCED) return;
  hang.animate(
    [{ transform: "rotate(6deg)" }, { transform: "rotate(-2.4deg)" }, { transform: "rotate(0.7deg)" }, { transform: "rotate(0deg)" }],
    { duration: 1100, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  );
}

/* ---------- screens ---------- */
function show(name) {
  closeSheets();
  $$(".screen").forEach((s) => s.classList.toggle("is-on", s.dataset.screen === name));
  window.scrollTo(0, 0);
  return $(`[data-screen="${name}"]`);
}

function showMake(voted) {
  const screen = show("make");
  const hang = $(".hang", screen);
  if (voted && state.card) {
    // after a vote the visitor sees the card they voted on, with their vote printed on its band
    mountHang(hang, state.card, state.link);
    setBand($(".badge", hang), voted, `You said ${voted}`);
  } else {
    mountHang(hang, B.sample, B.sampleLink);
  }
  entrance(hang);
}

function showOwner() {
  if (location.hash === "#results") return showResults();
  const screen = show("card");
  const hang = $(".hang", screen);
  mountHang(hang, state.card, state.link);
  entrance(hang);
  $("[data-linkedin]", screen).href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(state.url)}`;
  prefetchStory();
}

/* ---------- make: one input, then the badge fills in from the stream ---------- */
const PROGRESS = { photo: 12, name: 25, role: 28, receipt: [36, 44, 52], score: 72 };

function setupMake() {
  const screen = $('[data-screen="make"]');
  const tabs = $$('[role="tab"]', screen);
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => {
      x.setAttribute("aria-selected", String(x === t));
      $("#" + x.getAttribute("aria-controls")).hidden = x !== t;
    });
  }));
  $$('input[type="file"]', screen).forEach((inp) => inp.addEventListener("change", () => {
    const file = inp.files[0];
    inp.value = "";
    if (file) makeCard(inp.dataset.go, file);
  }));
  $("#p-github", screen).addEventListener("submit", (e) => {
    e.preventDefault();
    const u = e.target.elements.u.value.trim();
    if (u) makeCard("github", u);
  });
  swing($(".hang", screen));
}

async function makeCard(source, payload) {
  track("make_start", { source });
  const screen = show("processing");
  const hang = $(".hang", screen);
  mountHang(hang, BLANK_CARD, "");
  hang.dataset.locked = "1";
  entrance(hang);
  const badge = $(".badge", hang);
  const status = $(".status", screen);
  const retry = $(".retry", screen);
  const fill = $(".b-band-fill", badge);
  $$("[data-f]", badge).forEach((f) => f.classList.add("blank"));
  $(".b-link", badge).textContent = "";
  setBand(badge, "candidate", "");
  status.textContent = source === "resume" ? "Reading your resume" : source === "linkedin" ? "Reading your LinkedIn PDF" : "Finding your GitHub";
  retry.hidden = true;
  // the band creeps toward the next step while the AI works, so the screen never looks stuck
  let pct = 0, cap = 10;
  const progress = (to) => { pct = Math.max(pct, to); cap = Math.min(96, pct + 9); fill.style.width = `${pct}%`; };
  const creep = setInterval(() => {
    if (!screen.classList.contains("is-on")) return clearInterval(creep);
    pct += (cap - pct) * 0.06;
    fill.style.width = `${pct}%`;
  }, 400);
  progress(4);

  const reveal = (el) => { el.classList.remove("blank"); el.classList.add("fill-in"); };
  const receipts = $$('[data-f="receipt"]', badge);
  const verdict = $('[data-f="verdict"]', badge);
  let verdictShown = false;

  const fail = (message, canRetry) => {
    status.textContent = message;
    retry.hidden = false;
    $("span", retry).textContent = canRetry ? "Try again" : "Start over";
    retry.onclick = () => (canRetry ? makeCard(source, payload) : showMake());
    clearInterval(creep);
    fill.style.width = "0%";
  };

  const handle = (ev) => {
    if (ev.t === "status") status.textContent = ev.text;
    if (ev.t === "photo") {
      const photo = $('[data-f="photo"]', badge);
      photo.innerHTML = "";
      const img = new Image();
      img.alt = "";
      img.src = ev.url;
      photo.append(img);
      reveal(photo);
      progress(PROGRESS.photo);
    }
    if (ev.t === "name") {
      const name = $('[data-f="name"]', badge);
      name.textContent = ev.name;
      name.classList.toggle("is-long", [...ev.name].length > 18);
      reveal(name);
      const photo = $('[data-f="photo"]', badge);
      if (photo.classList.contains("blank")) { photo.textContent = ev.initials; reveal(photo); }
      badge.setAttribute("aria-label", ev.name);
      progress(PROGRESS.name);
    }
    if (ev.t === "role") { const r = $('[data-f="role"]', badge); r.textContent = ev.role; reveal(r); progress(PROGRESS.role); }
    if (ev.t === "receipt" && receipts[ev.i]) {
      receipts[ev.i].innerHTML = `${iconSVG(ev.icon)}<span>${escHTML(ev.text)}</span>`;
      reveal(receipts[ev.i]);
      progress(PROGRESS.receipt[ev.i] || 52);
    }
    if (ev.t === "score") { const s = $('[data-f="score"]', badge); s.textContent = ev.score; reveal(s); progress(PROGRESS.score); }
    if (ev.t === "verdict") {
      // word by word: show only finished words until the sentence is done
      const text = ev.partial ? ev.text.slice(0, ev.text.lastIndexOf(" ") + 1).trim() : ev.text;
      if (!text) return;
      if (!verdictShown) { verdict.classList.remove("blank"); verdictShown = true; }
      verdict.textContent = text;
      progress(PROGRESS.score + (28 * Math.min(text.length, 110)) / 110);
    }
    if (ev.t === "done") {
      state.card = ev.card; state.link = ev.link; state.url = ev.url; state.owner = true; state.storyFile = null;
      $(".b-link", badge).textContent = ev.link;
      clearInterval(creep);
      progress(100);
      track("card_made", { source });
      history.replaceState(null, "", `/${ev.card.slug}#card`);
      setTimeout(() => { status.textContent = ""; showOwner(); }, REDUCED ? 0 : 700);
    }
    if (ev.t === "error") {
      track("card_error", { source, code: ev.code });
      fail(ev.message, ev.retry);
    }
  };

  let res;
  try {
    res = source === "github"
      ? await fetch("/api/cards?source=github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: payload }) })
      : await fetch(`/api/cards?source=${source}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: payload });
  } catch (_) {
    return fail("Lost the connection. Try again.", true);
  }
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    track("card_error", { source, code: String(res.status) });
    return fail(err.error || "Something broke while making your card. Try again.", res.status >= 500);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.t === "done" || ev.t === "error") finished = true;
        handle(ev);
      }
    }
  } catch (_) { /* handled below */ }
  if (!finished) fail("Lost the connection. Try again.", true);
}

/* ---------- vote ---------- */
function setupVote() {
  const screen = $('[data-screen="vote"]');
  const hang = $(".hang", screen);
  const sheet = $("[data-reason-sheet]", screen);
  for (const kind of ["hire", "pass"]) {
    $(`.chips[data-kind="${kind}"]`, sheet).innerHTML = B.reasons[kind]
      .map((r) => `<button class="chip" data-kind="${kind}" data-reason="${r.id}" aria-pressed="false">${escHTML(r.text)}</button>`).join("");
  }

  const post = (path, body) => fetch(`/api/cards/${state.card.slug}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  let saving = null;
  const vote = (dir, from) => {
    if (hang.dataset.locked) return;
    hang.dataset.locked = "1";
    setBand($(".badge", hang), dir);
    settle(hang, from ?? (dir === "hire" ? -14 : 14));
    state.vote = { decision: dir };
    track("vote", { decision: dir });
    saving = post("vote", { decision: dir }).then((v) => { if (v?.decision) state.vote = v; });
    $("h2", sheet).textContent = dir === "hire" ? "What sold you?" : "Why pass?";
    $$(".chips", sheet).forEach((c) => (c.hidden = c.dataset.kind !== dir));
    setTimeout(() => openSheet(sheet), REDUCED ? 0 : 420);
  };

  swing(hang, { onVote: vote });
  $$("[data-vote-btn]", screen).forEach((b) => b.addEventListener("click", () => vote(b.dataset.voteBtn)));
  document.addEventListener("keydown", (e) => {
    if (!screen.classList.contains("is-on") || sheet.classList.contains("is-open")) return;
    if (e.key === "ArrowLeft") vote("pass");
    if (e.key === "ArrowRight") vote("hire");
  });
  sheet.addEventListener("click", async (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || sheet.dataset.busy) return;
    sheet.dataset.busy = "1";
    chip.setAttribute("aria-pressed", "true");
    track("reason", { reason: chip.dataset.reason });
    await saving;
    post("reason", { reasonId: chip.dataset.reason });
    setTimeout(() => { delete sheet.dataset.busy; showMake(state.vote.decision); }, REDUCED ? 0 : 320);
  });
  $(".skip", sheet).addEventListener("click", () => { track("reason_skip"); showMake(state.vote.decision); });
  $("[data-make-yours]", screen).addEventListener("click", () => track("make_yours"));
}

function showVote() {
  const screen = show("vote");
  const hang = $(".hang", screen);
  delete hang.dataset.locked;
  mountHang(hang, state.card, state.link);
  $(".vote-q", screen).textContent = `Would you hire ${firstName(state.card)}?`;
  $(".anon span", screen).textContent = `${firstName(state.card)} won't see who voted.`;
  entrance(hang);
}

/* ---------- results ---------- */
async function showResults() {
  const res = await fetch(`/api/cards/${state.card.slug}/results`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!res || res.hire + res.pass === 0) { show("results-empty"); track("view_results", { votes: 0 }); return; }
  const screen = show("results");
  track("view_results", { votes: res.hire + res.pass });
  $('[data-res="percent"]', screen).textContent = res.percent;
  $('[data-res="hire"]', screen).textContent = `${res.hire} hire`;
  $('[data-res="pass"]', screen).textContent = `${res.pass} pass`;
  const split = $(".split", screen);
  split.setAttribute("aria-label", `${res.hire} hire, ${res.pass} pass`);
  $(".h", split).style.flex = res.hire;
  $(".p", split).style.flex = res.pass;
  $(".h", split).hidden = !res.hire;
  $(".p", split).hidden = !res.pass;
  for (const kind of ["hire", "pass"]) {
    const list = res.reasons[kind];
    const top = list[0]?.count || 1;
    $(`[data-res="${kind}-list"]`, screen).innerHTML = list.map((r) =>
      `<li><div class="r-top"><span>${escHTML(r.text)}</span><b>${r.count}</b></div><div class="bar"><i style="width:${((r.count / top) * 100).toFixed(1)}%"></i></div></li>`
    ).join("");
    $(`.reasons.${kind}`, screen).hidden = !list.length;
  }
}

/* ---------- sheets ---------- */
function openSheet(sheet) {
  sheet.classList.add("is-open");
  sheet.nextElementSibling?.classList.add("is-open");
  $("button, a", sheet)?.focus({ preventScroll: true });
}
function closeSheets() {
  $$(".sheet.is-open").forEach((s) => s.classList.remove("is-open"));
  $$(".scrim.is-open").forEach((s) => s.classList.remove("is-open"));
  $$("[data-reason-sheet] .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
}

/* ---------- share ---------- */
function prefetchStory() {
  if (state.storyFile || !state.card) return;
  const slug = state.card.slug;
  fetch(`/${slug}/story.png`).then((r) => (r.ok ? r.blob() : null)).then((blob) => {
    if (blob && state.card?.slug === slug) state.storyFile = new File([blob], `hire-or-pass-${slug}.png`, { type: "image/png" });
  }).catch(() => {});
}

function copy(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  legacyCopy(text);
}
function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (_) {}
  ta.remove();
}

function saveImage() {
  const a = document.createElement("a");
  a.href = `/${state.card.slug}/story.png`;
  a.download = `hire-or-pass-${state.card.slug}.png`;
  document.body.append(a);
  a.click();
  a.remove();
}

function setupShare() {
  const sheet = $("[data-share-sheet]");
  $$("[data-open-share]").forEach((b) => b.addEventListener("click", () => {
    copy(state.url);
    track("share_story");
    $("[data-story-img]", sheet).src = `/${state.card.slug}/story.png`;
    $("[data-sticker]", sheet).textContent = state.link;
    prefetchStory();
    openSheet(sheet);
  }));
  $("[data-share-image]", sheet).addEventListener("click", async () => {
    track("share_instagram");
    const file = state.storyFile;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (_) {}
      return;
    }
    saveImage();
  });
  $("[data-save-image]", sheet).addEventListener("click", () => { track("save_image"); saveImage(); });
  $$("[data-copy]").forEach((b) => b.addEventListener("click", () => {
    copy(state.url);
    track("copy_link");
    const label = $("span", b);
    label.textContent = "Copied";
    setTimeout(() => (label.textContent = "Copy link"), 1600);
  }));
  $$("[data-linkedin]").forEach((a) => a.addEventListener("click", () => track("share_linkedin")));
  $$(".scrim, [data-close]").forEach((s) => s.addEventListener("click", closeSheets));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheets());
}

/* ---------- delete ---------- */
function setupDelete() {
  const sheet = $("[data-delete-sheet]");
  $$("[data-open-delete]").forEach((b) => b.addEventListener("click", () => openSheet(sheet)));
  $("[data-confirm-delete]", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const ok = await fetch(`/api/cards/${state.card.slug}`, { method: "DELETE" }).then((r) => r.ok).catch(() => false);
    btn.disabled = false;
    if (!ok) return;
    track("delete_card");
    location.replace("/");
  });
}

/* ---------- theme ---------- */
function setupTheme() {
  const saved = (() => { try { return localStorage.getItem("hop-theme"); } catch (_) { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $$("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("hop-theme", next); } catch (_) {}
  }));
}

/* ---------- start ---------- */
function route() {
  if (state.owner && state.card) return showOwner();
  if (B.view === "vote" && !state.vote) return showVote();
  if (state.vote && state.card) return showMake(state.vote.decision);
  showMake();
}

setupTheme();
setupMake();
setupVote();
setupShare();
setupDelete();
addEventListener("hashchange", () => { if (state.owner) showOwner(); });
route();
