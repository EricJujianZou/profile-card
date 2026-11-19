/* hire or pass: click-through prototype. No backend. Loads after card.js. */

const STEPS = {
  resume: ["Reading your resume", "Finding what you shipped", "Picking a score", "Writing your verdict"],
  github: ["Reading 41 repos", "Finding what you shipped", "Picking a score", "Writing your verdict"],
  linkedin: ["Reading your LinkedIn PDF", "Finding what you shipped", "Picking a score", "Writing your verdict"],
};

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function setBand(badge, state, text) {
  badge.dataset.band = state;
  $(".b-band-text", badge).textContent = text ?? { candidate: "Candidate", hire: "Hire", pass: "Pass" }[state];
}

/* ---------- swing: the whole lanyard pivots from the top of the screen ---------- */
function swing(hang, { onVote } = {}) {
  const badge = $(".badge", hang);
  let x0 = 0, dx = 0, t0 = 0, active = false, pivot = 300;
  const angleFor = (d) => Math.max(-24, Math.min(24, (Math.atan2(d, pivot) * 180) / Math.PI));

  badge.addEventListener("pointerdown", (e) => {
    if (hang.dataset.locked) return;
    active = true; x0 = e.clientX; dx = 0; t0 = performance.now();
    pivot = badge.getBoundingClientRect().top + badge.offsetHeight / 2 - hang.getBoundingClientRect().top;
    badge.setPointerCapture(e.pointerId);
    hang.getAnimations().forEach((a) => a.cancel());
  });
  badge.addEventListener("pointermove", (e) => {
    if (!active) return;
    dx = e.clientX - x0;
    const a = angleFor(dx);
    hang.style.transform = `rotate(${-a}deg)`;
    if (Math.abs(a) > 3) setBand(badge, a > 0 ? "hire" : "pass");
    else setBand(badge, "candidate");
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
      setBand(badge, "candidate");
    }
  };
  badge.addEventListener("pointerup", end);
  badge.addEventListener("pointercancel", end);
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

/* ---------- vote ---------- */
function setupVote() {
  const screen = $('[data-screen="vote"]');
  const hang = $(".hang", screen);
  const badge = $(".badge", hang);
  const sheet = $("[data-reason-sheet]", screen);

  const vote = (dir, from) => {
    if (hang.dataset.locked) return;
    hang.dataset.locked = "1";
    setBand(badge, dir);
    settle(hang, from ?? (dir === "hire" ? -14 : 14));
    trySet("hop-vote", dir);
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
  $$(".chip", sheet).forEach((chip) =>
    chip.addEventListener("click", () => {
      chip.setAttribute("aria-pressed", "true");
      setTimeout(() => go("sent"), REDUCED ? 0 : 320);
    })
  );
  $(".skip", sheet).addEventListener("click", () => go("sent"));
}

function resetVote() {
  const screen = $('[data-screen="vote"]');
  const hang = $(".hang", screen);
  delete hang.dataset.locked;
  setBand($(".badge", hang), "candidate");
  $$(".chip", screen).forEach((c) => c.setAttribute("aria-pressed", "false"));
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
}

/* ---------- processing: the badge fills in as each part arrives ---------- */
let timers = [];
function runProcessing(source = "github") {
  timers.forEach(clearTimeout);
  timers = [];
  const screen = $('[data-screen="processing"]');
  const hang = $(".hang", screen);
  mountHang(hang);
  const badge = $(".badge", hang);
  const status = $(".status", screen);
  const fill = $(".b-band-fill", badge);
  const steps = STEPS[source] || STEPS.github;
  const fields = $$("[data-f]", badge);
  const verdict = $('[data-f="verdict"]', badge);
  const fullVerdict = verdict.textContent;
  hang.dataset.locked = "1";
  fields.forEach((f) => f.classList.add("blank"));
  setBand(badge, "candidate", "");
  status.textContent = steps[0];

  const show = (sel) => $$(sel, badge).forEach((f) => { f.classList.remove("blank"); f.classList.add("fill-in"); });
  const at = (ms, fn) => timers.push(setTimeout(fn, REDUCED ? ms / 3 : ms));

  at(250, () => (fill.style.width = "12%"));
  at(900, () => { show('[data-f="photo"], [data-f="name"], [data-f="role"]'); fill.style.width = "25%"; });
  at(1800, () => { status.textContent = steps[1]; });
  $$('[data-f="receipt"]', badge).forEach((li, n) =>
    at(2100 + n * 320, () => { li.classList.remove("blank"); li.classList.add("fill-in"); fill.style.width = `${32 + n * 6}%`; })
  );
  at(3100, () => { status.textContent = steps[2]; fill.style.width = "60%"; });
  at(3700, () => { show('[data-f="score"]'); fill.style.width = "75%"; });
  at(4000, () => {
    status.textContent = steps[3];
    verdict.classList.remove("blank");
    verdict.textContent = "";
    const words = fullVerdict.split(" ");
    words.forEach((w, n) =>
      at(4000 + n * 70, () => {
        verdict.textContent = words.slice(0, n + 1).join(" ");
        fill.style.width = `${75 + (25 * (n + 1)) / words.length}%`;
      })
    );
  });
  at(5500, () => { fill.style.width = "0%"; fill.style.transition = "none"; setBand(badge, "candidate"); status.textContent = ""; });
  at(6100, () => go("card"));
}

/* ---------- share ---------- */
function setupShare() {
  const sheet = $("[data-share-sheet]");
  $$("[data-open-share]").forEach((b) => b.addEventListener("click", () => {
    copy(CARDS.devon.link);
    openSheet(sheet);
  }));
  $("[data-share-image]", sheet).addEventListener("click", async () => {
    // Real app: fetch the rendered 1080x1920 PNG and pass it to navigator.share({ files: [png] }).
    if (navigator.share) {
      try { await navigator.share({ url: "https://" + CARDS.devon.link }); } catch (_) {}
    }
  });
  $$("[data-copy]").forEach((b) => b.addEventListener("click", () => {
    copy(CARDS.devon.link);
    const label = $("span", b);
    const was = label.textContent;
    label.textContent = "Copied";
    setTimeout(() => (label.textContent = was), 1600);
  }));
  $$(".scrim, [data-close]").forEach((s) => s.addEventListener("click", closeSheets));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheets());
}
function copy(text) {
  navigator.clipboard?.writeText("https://" + text).catch(() => {});
}
function trySet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
function tryGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }

/* ---------- make ---------- */
function setupMake() {
  const screen = $('[data-screen="make"]');
  const tabs = $$('[role="tab"]', screen);
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => {
      x.setAttribute("aria-selected", String(x === t));
      $("#" + x.getAttribute("aria-controls")).hidden = x !== t;
    });
  }));
  $$('input[type="file"]', screen).forEach((inp) => inp.addEventListener("change", () => inp.files.length && go("processing", inp.dataset.go)));
  $("#p-github", screen).addEventListener("submit", (e) => { e.preventDefault(); go("processing", "github"); });
  swing($(".hang", screen));
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

/* ---------- routing ---------- */
const ROUTES = ["make", "sent", "processing", "card", "vote", "results", "results-empty"];
function go(route, arg) {
  location.hash = arg ? `${route}:${arg}` : route;
}
function render() {
  closeSheets();
  timers.forEach(clearTimeout);
  const [raw, arg] = location.hash.slice(1).split(":");
  const route = ROUTES.includes(raw) ? raw : "make";
  const screenName = route === "sent" ? "make" : route;
  $$(".screen").forEach((s) => s.classList.toggle("is-on", s.dataset.screen === screenName));
  const screen = $(`[data-screen="${screenName}"]`);

  if (screenName === "make") {
    const badge = $(".badge", screen);
    const voted = route === "sent" ? tryGet("hop-vote") || "hire" : null;
    // after a vote the visitor sees the card they voted on, with their vote printed on its band
    setBand(badge, voted || "candidate", voted ? `You said ${voted}` : undefined);
  }
  if (route === "vote") resetVote();
  if (route === "processing") runProcessing(arg);
  window.scrollTo(0, 0);
  const hang = $(".hang", screen);
  if (hang && route !== "processing") entrance(hang);
  if (route === "processing") entrance($(".hang", screen));
}

$$(".hang[data-card]").forEach(mountHang);
setupTheme();
setupMake();
setupVote();
setupShare();
addEventListener("hashchange", render);
render();
