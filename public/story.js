/* Story image page. ?export=1 renders the exact 1080x1920 frame for the server. ?guides=1 shows Instagram's covered bands. */
(() => {
  const qs = new URLSearchParams(location.search);
  mountHang(document.getElementById("hang"), BOOT.card, BOOT.link);
  const story = document.getElementById("story");
  if (qs.get("guides")) story.classList.add("guides");
  if (qs.get("export") || qs.get("embed")) {
    document.documentElement.classList.add("export");
  } else {
    const fit = () => (story.style.transform = `scale(${Math.min(innerWidth / 1080, innerHeight / 1920)})`);
    fit(); addEventListener("resize", fit);
  }
})();
