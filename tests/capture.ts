/** Deterministic screenshot capture against the BOARD_FIXTURE server.
    Boots the server itself, freezes the page clock to fixture meta.now,
    kills CSS animations, waits for fonts, shoots the named states. */
import { chromium, type Page } from "playwright";
import { join } from "path";
import { mkdirSync, readFileSync } from "fs";

const ROOT = join(import.meta.dir, "..");
const outIdx = process.argv.indexOf("--out");
const OUT = join(ROOT, outIdx > -1 ? process.argv[outIdx + 1]! : "tests/.captures");
mkdirSync(OUT, { recursive: true });
const META = JSON.parse(readFileSync(join(ROOT, "tests/fixture/meta.json"), "utf8")) as { now: number };
const PORT = 7941;
const BASE = `http://127.0.0.1:${PORT}`;

const server = Bun.spawn(["bun", "run", join(ROOT, "src/server.ts")], {
  env: { ...process.env, BOARD_FIXTURE: join(ROOT, "tests/fixture"), PORT: String(PORT) },
  stdout: "inherit", stderr: "inherit",
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

// Rounded-corner / border antialiasing is GPU-rasterized and can jitter a
// color channel by ~1 unit between otherwise-identical runs; software
// rendering plus fixed color/text settings make that bit-for-bit stable,
// which `capture:compare`'s zero-tolerance diff needs.
const browser = await chromium.launch({
  args: [
    "--disable-gpu",
    "--force-color-profile=srgb",
    "--disable-lcd-text",
    "--disable-font-subpixel-positioning",
    "--run-all-compositor-stages-before-draw",
    "--disable-partial-raster",
    "--disable-checker-imaging",
    "--disable-skia-runtime-opts",
    "--disable-gpu-rasterization",
  ],
});

async function newPage(width: number, theme: "light" | "dark"): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 950 }, deviceScaleFactor: 1 });
  // The shell links Google Fonts (Inter / JetBrains Mono). Loading them for real
  // makes each run's text-shaping race the network: whichever pass finishes the
  // webfont swap before paint gets different glyph metrics than a pass that
  // times out to the fallback stack, which is exactly the kind of few-dozen-
  // pixel drift `capture:compare` is designed to catch. Block both hosts so
  // every run renders the same fallback stack deterministically, offline.
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const page = await ctx.newPage();
  await page.clock.setFixedTime(META.now);
  await page.addInitScript((mode: string) => localStorage.setItem("mrs-theme", mode), theme);
  await page.goto(BASE);
  // Kill animations/transitions so pulsing badges and spinners can't smear.
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.evaluate(() => (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready);
  await page.waitForSelector(".tui-row, .tui-card, .tui-empty");
  return page;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`  ✓ ${name}`);
}

for (const theme of ["light", "dark"] as const) {
  // rows view, desktop
  let page = await newPage(1280, theme);
  await shoot(page, `rows-${theme}`);
  // row menu open (right-click the first row)
  await page.click(".tui-row", { button: "right" });
  await page.waitForSelector(".tui-menu");
  await shoot(page, `rowmenu-${theme}`);
  // paper cut 4 assertion: opening the comments drawer while the row menu is
  // open closes the menu first (its outside-click handler fires on the
  // drawer trigger's mousedown), so no two layers actually coexist here --
  // this is a single-layer Escape-close smoke test, not multi-layer LIFO
  // evidence. The LIFO stack invariant is covered by the unit test in
  // src/__tests__/escape-stack.test.ts. This still checks that Escape closes
  // the drawer without taking the board down with it.
  const t2 = page.locator(".tui-comments-btn, .tui-comment-token").first();
  if (await t2.count()) {
    await t2.click();
    await page.waitForSelector('[data-part="sidedrawer"][data-side="right"]');
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-part="sidedrawer"][data-side="right"]', { state: "detached" });
    if (!(await page.locator(".tui-row").first().isVisible())) throw new Error("escape assertion: board vanished");
  }
  await page.keyboard.press("Escape");
  // comments drawer (first comments trigger, if the fixture has one)
  const trigger = page.locator(".tui-comments-btn, .tui-comment-token").first();
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForSelector('[data-part="sidedrawer"][data-side="right"]');
    await shoot(page, `comments-${theme}`);
    await page.keyboard.press("Escape");
  }
  // review modal (badge with a saved report)
  const reviewBtn = page.locator(".tui-review-open.tui-review-done").first();
  if (await reviewBtn.count()) {
    await reviewBtn.click();
    await page.waitForSelector(".tui-review-modal .tui-md h1, .tui-review-modal .tui-md p");
    await shoot(page, `reviewmodal-${theme}`);
    await page.keyboard.press("Escape");
  }
  // settings modal
  await page.click(".tui-side-gear");
  await page.waitForSelector('[data-part="modal"]');
  await shoot(page, `settings-${theme}`);
  await page.keyboard.press("Escape");
  // selection bar
  await page.locator('[data-part="selectbox"]').first().click();
  await page.waitForSelector(".tui-selbar");
  await shoot(page, `selection-${theme}`);
  await page.close();

  // grid view
  page = await newPage(1280, theme);
  await page.evaluate(() => localStorage.setItem("mrs-view", "grid"));
  await page.reload();
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.waitForSelector(".tui-grid");
  await shoot(page, `grid-${theme}`);
  await page.close();

  // mobile drawer (below the 720px breakpoint)
  page = await newPage(700, theme);
  await shoot(page, `mobile-${theme}`);
  await page.click(".tui-burger");
  await page.waitForSelector('[data-part="sidedrawer"][data-side="left"]');
  await shoot(page, `drawer-${theme}`);
  await page.close();

  // focus states: tab from the top and shoot the first few focus stops
  page = await newPage(1280, theme);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await shoot(page, `focus-${theme}`);
  await page.close();
}

await browser.close();
server.kill();
console.log(`captures written to ${OUT}`);
