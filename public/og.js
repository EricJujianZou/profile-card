/* Link preview page. ?export=1 renders the exact 1200x627 frame for the server. */
(() => {
  const qs = new URLSearchParams(location.search);
  const c = BOOT.card;
  mountHang(document.getElementById("hang"), c, BOOT.link);
  const q = document.getElementById("q");
  q.textContent = "Would you";
  q.append(document.createElement("br"), `hire ${c.first || c.name.split(" ")[0]}?`);
  document.getElementById("url").textContent = BOOT.link;
  const og = document.getElementById("og");
  if (qs.get("export")) document.documentElement.classList.add("export");
  else {
    const fit = () => (og.style.transform = `scale(${Math.min(1, innerWidth / 1200, innerHeight / 627)})`);
    fit(); addEventListener("resize", fit);
  }
})();
