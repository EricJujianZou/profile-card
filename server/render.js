// Renders the story image (1080 x 1920) and the link preview (1200 x 627) to PNG with headless Chromium.
// One browser is shared. Each PNG is made once per card and kept on disk until the card is deleted.

import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const SIZES = { story: { width: 1080, height: 1920 }, og: { width: 1200, height: 627 } };

export function createRenderer({ dir, baseUrl }) {
  mkdirSync(dir, { recursive: true });
  let browser = null;
  const pending = new Map();

  async function getBrowser() {
    if (browser?.isConnected()) return browser;
    browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
    return browser;
  }

  async function shoot(slug, kind) {
    const b = await getBrowser();
    const page = await b.newPage({ viewport: SIZES[kind], deviceScaleFactor: 1 });
    try {
      await page.goto(`${baseUrl}/${slug}/${kind}?export=1`, { waitUntil: "networkidle", timeout: 20000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      });
      return await page.screenshot({ type: "png" });
    } finally {
      await page.close();
    }
  }

  const file = (slug, kind) => join(dir, `${slug}-${kind}.png`);

  return {
    async png(slug, kind) {
      if (!SIZES[kind]) throw new Error("unknown image");
      const f = file(slug, kind);
      if (existsSync(f)) return readFileSync(f);
      const key = `${slug}:${kind}`;
      if (!pending.has(key)) {
        pending.set(key, shoot(slug, kind).then((buf) => { writeFileSync(f, buf); return buf; }).finally(() => pending.delete(key)));
      }
      return pending.get(key);
    },
    forget(slug) {
      for (const kind of Object.keys(SIZES)) rmSync(file(slug, kind), { force: true });
    },
    async close() { await browser?.close(); },
  };
}
