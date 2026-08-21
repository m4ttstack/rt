/** Deterministic screenshot capture against the DECK_FIXTURE server.
    Boots the server itself, freezes the page clock, kills CSS animations,
    waits for fonts, shoots the named board/modal/notice states. Ported from
    mr-board/tests/capture.ts; the font-host block that script carries does
    not apply here — the kit's theme.css links no webfonts. */
import { chromium, type Page } from "playwright";
import { join } from "path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const ROOT = join(import.meta.dir, "..");
const outIdx = process.argv.indexOf("--out");
const OUT = join(ROOT, outIdx > -1 ? process.argv[outIdx + 1]! : "test/.captures");
mkdirSync(OUT, { recursive: true });

const PORT = 8391;
const BASE = `http://127.0.0.1:${PORT}`;
// Frozen wall clock so autoHeal's "recent" window and its rendered
// toLocaleTimeString text are byte-identical across every run.
const NOW = new Date("2026-08-19T12:00:00.000Z").getTime();

const fixtureDir = mkdtempSync(join(tmpdir(), "deck-capture-fixture-"));
const stateDir = mkdtempSync(join(tmpdir(), "deck-capture-state-"));

const baseFixture = JSON.parse(readFileSync(join(ROOT, "test/fixture/status.json"), "utf8"));
const emptyFixture = JSON.parse(readFileSync(join(ROOT, "test/fixture/status-empty.json"), "utf8"));
const staleFixture = JSON.parse(readFileSync(join(ROOT, "test/fixture/status-stale.json"), "utf8"));

const noticeOkFixture = structuredClone(baseFixture);
noticeOkFixture.autoHeal = { at: NOW - 30000, ok: true };

function writeStatus(data: unknown): void {
  writeFileSync(join(fixtureDir, "status.json"), JSON.stringify(data));
}
writeStatus(baseFixture);

const server = Bun.spawn(["bun", "run", join(ROOT, "src/main.ts"), "serve"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    DECK_FIXTURE: fixtureDir,
    LOCAL_STATE_DIR: stateDir,
    LOCAL_APPS_NO_GATEWAY: "1",
    LOCAL_APPS_AUTO_HEAL: "0",
  },
  stdout: "inherit",
  stderr: "inherit",
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

// Rounded-corner / border antialiasing is GPU-rasterized and can jitter a
// color channel by ~1 unit between otherwise-identical runs; software
// rendering plus fixed color/text settings make that bit-for-bit stable,
// which `capture:compare`'s zero-tolerance diff needs. Verbatim from
// mr-board/tests/capture.ts, the product of a past debugging session.
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

async function newPage(theme: "light" | "dark"): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // The scheme watcher (core/board/main.tsx) reads matchMedia at first
  // render, so the emulated scheme must be set before the navigation.
  if (theme === "dark") await page.emulateMedia({ colorScheme: "dark" });
  // install(), not setFixedTime(): the board's own 5s poll (REFRESH_MS in
  // core/board/logic.ts) runs on setInterval, which setFixedTime leaves on
  // the real wall clock -- a capture pass slow enough to cross that 5s
  // boundary can race an unprompted refetch against a scripted reload() and
  // land on a torn frame. install() freezes timers too (rAF is untouched,
  // so settle()'s frame wait still works), so the poll never fires on its own.
  await page.clock.install({ time: NOW });
  await page.goto(BASE);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.evaluate(() => (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready);
  await page.waitForSelector("[data-board-ready]");
  return page;
}

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({ has: page.locator("strong", { hasText: name }) });
}

// A click can resolve before React's resulting re-render has painted; two
// rAFs guarantee the browser has committed a full frame after that render,
// so the shot never catches an in-between layout (a real, once-seen diff on
// modal-add-external and modal-stderr before this was added).
//
// The board leans on native `title` tooltips for icon-only controls, and
// Chromium's hover-to-tooltip delay runs on the OS/engine's real clock, not
// page.clock's frozen one -- board-override-hover held the mouse over a
// `title`-bearing control, and a slow enough pass let the tooltip paint
// mid-shot, overlapping the health badge (a real, once-seen diff on that
// capture). Stripping every `title` before each shot removes the timer
// this harness cannot freeze.
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("[title]").forEach((el) => el.removeAttribute("title")));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function shoot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: opts.fullPage ?? true });
  console.log(`  ✓ ${name}`);
}

// Every scenario gets its own fresh page (fresh navigation, fresh fixture on
// disk before that navigation) rather than one page reload()ing through the
// whole list. A shared page accumulates compositor/layer state across many
// sequential DOM mutations, and that turned out to be a real source of
// scattered ~0.01%-of-frame diffs on modal shots (backdrop-filter: blur(2px)
// in the kit's Modal recipe samples the board content behind it, and that
// sampling is the part of the frame most sensitive to leftover state) —
// isolating each shot to its own load removes the variable entirely.
async function scenario(
  theme: "light" | "dark",
  fixture: unknown,
  name: string,
  action: (page: Page) => Promise<void> = async () => {},
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  writeStatus(fixture);
  const page = await newPage(theme);
  await action(page);
  await shoot(page, name, opts);
  await page.close();
}

async function openModal(page: Page, trigger: () => Promise<void>): Promise<void> {
  await trigger();
  await page.waitForSelector('[data-part="modal"]');
}

// ---- day ----
await scenario("light", baseFixture, "board-default");
await scenario("light", emptyFixture, "board-empty");
await scenario(
  "light",
  baseFixture,
  "board-sections",
  async (page) => {
    // A short viewport forces an actual scroll — at the default 900px the
    // whole board already fits, so "scroll to strays+tunnel" would be a
    // no-op capture.
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.locator("h2", { hasText: "cloudflare tunnel" }).scrollIntoViewIfNeeded();
  },
  { fullPage: false },
);

{
  writeStatus(baseFixture);
  const page = await newPage("light");
  const addModal = page.locator('[data-part="modal"]');
  await openModal(page, () => page.locator("button", { hasText: "add app" }).click());
  await shoot(page, "modal-add-service");
  await addModal.locator('[data-part="switch-control"]').click();
  await addModal.getByPlaceholder("4200").waitFor({ state: "visible" });
  await shoot(page, "modal-add-external");
  await page.close();
}

await scenario("light", baseFixture, "modal-access", async (page) => {
  await openModal(page, () => rowFor(page, "atlas").locator('[aria-label$=", change access"]').click());
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
});
await scenario("light", baseFixture, "modal-stderr", (page) =>
  openModal(page, () => rowFor(page, "ledger").locator('[aria-label="show recent stderr for ledger"]').click()),
);
await scenario("light", noticeOkFixture, "notice-ok", (page) =>
  page.waitForSelector('[data-part="alert"][data-intent="ok"]'),
);
await scenario("light", staleFixture, "notice-error", (page) =>
  page.waitForSelector('[data-part="alert"][data-intent="bad"]'),
);

// ---- night ----
await scenario("dark", baseFixture, "board-default-dark");
await scenario("dark", baseFixture, "modal-access-dark", async (page) => {
  await openModal(page, () => rowFor(page, "atlas").locator('[aria-label$=", change access"]').click());
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
});
await scenario("dark", staleFixture, "notice-error-dark", (page) =>
  page.waitForSelector('[data-part="alert"][data-intent="bad"]'),
);

await browser.close();
server.kill();
console.log(`captures written to ${OUT}`);
