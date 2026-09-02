/**
 * Renders the latch banner's fixed artwork to assets/latch-band.png, once, at
 * build time. Text is the only reason a browser is involved: the runtime
 * compositor paints sprite pixels and cannot render glyphs. Re-run by hand
 * after changing the band's look, and commit the result.
 *
 *   bun run scripts/build-latch-band.ts
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const W = 1656;
const H = 208;
// Left inset reserved for the sprite the runtime paints in; the artwork must
// leave it empty or the sprite lands on top of the band's own pixels.
const SPRITE_BOX = 120 + 60 * 2;

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
  html, body { margin: 0; padding: 0; }
  .band {
    width: ${W}px; height: ${H}px; box-sizing: border-box;
    display: flex; align-items: center;
    padding: 0 60px 0 ${SPRITE_BOX}px;
    background: #161224;
    background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 6px);
  }
  .stack { display: flex; flex-direction: column; gap: 18px; width: 100%; }
  .title { font-family: 'Silkscreen', 'Courier New', monospace; font-weight: 700;
           font-size: 50px; letter-spacing: 0.08em; color: #f6f2ff; line-height: 1; }
  .rule { height: 4px; background: #ff6b9d; width: 100%; }
  .sub { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 24px;
         letter-spacing: 0.16em; color: #ff6b9d; text-transform: uppercase; }
</style>
<div class="band"><div class="stack">
  <div class="title">RE-REVIEW LATCH</div>
  <div class="rule"></div>
  <div class="sub">resolve this thread to summon another pass</div>
</div></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready);
mkdirSync(join(import.meta.dir, "..", "assets"), { recursive: true });
await page.locator(".band").screenshot({
  path: join(import.meta.dir, "..", "assets", "latch-band.png"),
});
await browser.close();
console.log(`wrote assets/latch-band.png (${W}x${H})`);
