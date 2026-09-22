/** Deterministic screenshot capture against the BOARD_FIXTURE server.
    Boots the server itself, freezes the page clock to fixture meta.now,
    kills CSS animations, waits for fonts, shoots the named states. */
import { mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { chromium, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '..');
const outIdx = process.argv.indexOf('--out');
const OUT = join(
  ROOT,
  outIdx > -1 ? process.argv[outIdx + 1]! : 'tests/.captures'
);
mkdirSync(OUT, { recursive: true });
const META = JSON.parse(
  readFileSync(join(ROOT, 'tests/fixture/meta.json'), 'utf8')
) as { now: number };
const PORT = 7941;
const BASE = `http://127.0.0.1:${PORT}`;

const server = Bun.spawn(['bun', 'run', join(ROOT, 'src/server.ts')], {
  env: {
    ...process.env,
    BOARD_FIXTURE: join(ROOT, 'tests/fixture'),
    PORT: String(PORT),
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/healthz`)).ok) break;
  } catch {}
  await new Promise(r => setTimeout(r, 200));
}

// Rounded-corner / border antialiasing is GPU-rasterized and can jitter a
// color channel by ~1 unit between otherwise-identical runs; software
// rendering plus fixed color/text settings make that bit-for-bit stable,
// which `capture:compare`'s zero-tolerance diff needs.
const browser = await chromium.launch({
  args: [
    '--disable-gpu',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--disable-font-subpixel-positioning',
    '--run-all-compositor-stages-before-draw',
    '--disable-partial-raster',
    '--disable-checker-imaging',
    '--disable-skia-runtime-opts',
    '--disable-gpu-rasterization',
  ],
});

async function newPage(width: number, theme: 'light' | 'dark'): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width, height: 950 },
    deviceScaleFactor: 1,
  });
  // The shell links Google Fonts (Inter / JetBrains Mono). Loading them for real
  // makes each run's text-shaping race the network: whichever pass finishes the
  // webfont swap before paint gets different glyph metrics than a pass that
  // times out to the fallback stack, which is exactly the kind of few-dozen-
  // pixel drift `capture:compare` is designed to catch. Block both hosts so
  // every run renders the same fallback stack deterministically, offline.
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.abort()
  );
  const page = await ctx.newPage();
  await page.clock.setFixedTime(META.now);
  await page.addInitScript(
    (mode: string) => localStorage.setItem('mrs-theme', mode),
    theme
  );
  // The fixture has a seat (rmarlow), which would open the board filtered to
  // her rows; every shot but the seat tab's wants the whole team.
  await page.goto(`${BASE}/?member=all`);
  // Kill animations/transitions so pulsing badges and spinners can't smear.
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
  await page.evaluate(
    () =>
      (
        globalThis as unknown as {
          document: { fonts: { ready: Promise<unknown> } };
        }
      ).document.fonts.ready
  );
  await page.waitForSelector('.tui-row, .tui-empty');
  return page;
}

/** The kit's JetBrains Mono is a lazily activated `@font-face` with
    `font-display: swap`: the first mono text on the page (the comments
    drawer's inline code) lays out in the fallback and swaps a frame later,
    so a shot taken straight after a selector wait can catch either side of
    that swap. Waiting on the font set before every shot settles it. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    const { document, requestAnimationFrame } = globalThis as unknown as {
      document: {
        fonts: { ready: Promise<unknown>; status: 'loading' | 'loaded' };
      };
      requestAnimationFrame: (cb: () => void) => void;
    };
    const frame = () =>
      new Promise<void>(r => requestAnimationFrame(() => r()));
    // A face requested by content that laid out after the last `ready`
    // settled (the drawer's code font) starts loading a frame later; loop
    // until a settled `ready` is followed by a frame with nothing loading.
    for (let i = 0; i < 10; i++) {
      await document.fonts.ready;
      await frame();
      await frame();
      if (document.fonts.status === 'loaded') return;
    }
  });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`  ✓ ${name}`);
}

for (const theme of ['light', 'dark'] as const) {
  // rows view, desktop
  let page = await newPage(1280, theme);
  await shoot(page, `rows-${theme}`);
  // a row under the pointer: the checkbox swaps in, the secondary verbs and
  // the tools appear left of the primary verb, which must not move
  await page.locator('.tui-row').first().hover();
  await page.waitForSelector('.tui-row:hover .tui-status-tools');
  await shoot(page, `rowhover-${theme}`);
  await page.mouse.move(0, 0);
  // the row's note (B10): the band at rest, then the same row with its
  // editor open -- the note tool is the first of the row's hover tools.
  const noted = page.locator('.tui-row[data-note]').first();
  if (await noted.count()) {
    // The band's own hover, not the row's: the dismiss verb belongs to the
    // note and only appears (dim) when the pointer is on it.
    await noted.locator('.tui-row-note').hover();
    await page.waitForSelector('.tui-row[data-note] .tui-row-note');
    await shoot(page, `note-${theme}`);
    // This file has no DOM lib (see `shoot`), so the row is cast to the
    // shape this click needs rather than typed as an element.
    await noted.evaluate(row => {
      const el = row as unknown as {
        querySelector: (sel: string) => { click: () => void } | null;
      };
      el.querySelector('.tui-status-tools button')?.click();
    });
    await page.waitForSelector('.tui-row-note[data-editing]');
    await shoot(page, `noteedit-${theme}`);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
  }
  // the seat tab: every row needing rmarlow's move, grouped by need
  await page.click('[role="tab"]:has-text("Needs me")');
  await page.waitForSelector('[data-part="panel-title"]:has-text("decide")');
  await shoot(page, `needsme-${theme}`);
  await page.click('[role="tab"]:has-text("Team")');
  await page.waitForSelector('.tui-row');
  // row menu open (right-click the first row)
  await page.click('.tui-row', { button: 'right' });
  // `.tui-menu` is gone: the menu shell is the kit's ContextMenu recipe, named
  // by its own self-identifying data-part (the root's, not an item's).
  await page.waitForSelector('[data-part="contextmenu"]');
  await shoot(page, `rowmenu-${theme}`);
  // paper cut 4 assertion: opening the comments drawer while the row menu is
  // open closes the menu first (its outside-click handler fires on the
  // drawer trigger's mousedown), so no two layers actually coexist here --
  // this is a single-layer Escape-close smoke test, not multi-layer LIFO
  // evidence. The LIFO stack invariant is covered by the unit test in
  // src/__tests__/escape-stack.test.ts. This still checks that Escape closes
  // the drawer without taking the board down with it. `.tui-threads` is the
  // facts line's thread count, the row's one entry into the drawer.
  const t2 = page.locator('.tui-threads').first();
  if (await t2.count()) {
    await t2.click();
    await page.waitForSelector('[data-part="sidedrawer"][data-side="right"]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-part="sidedrawer"][data-side="right"]', {
      state: 'detached',
    });
    if (!(await page.locator('.tui-row').first().isVisible()))
      throw new Error('escape assertion: board vanished');
  }
  await page.keyboard.press('Escape');
  // comments drawer (first thread link, if the fixture has one)
  const trigger = page.locator('.tui-threads').first();
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForSelector('[data-part="sidedrawer"][data-side="right"]');
    await shoot(page, `comments-${theme}`);
    await page.keyboard.press('Escape');
  }
  // review modal: the status line's `read` verb on a row whose finished
  // review is its hottest fact (a hotter line would hide the verb in
  // "+N active", so the fixture keeps one such row).
  const reviewBtn = page.locator('button[data-verb="read-review"]').first();
  if (await reviewBtn.count()) {
    // On an author's row with threads still awaiting them, respond leads and
    // the report is the secondary verb, which only unhides under the pointer.
    await reviewBtn
      .locator('xpath=ancestor::*[contains(@class,"tui-row")][1]')
      .hover();
    await reviewBtn.click();
    await page.waitForSelector(
      '.tui-review-modal [data-part="markdown"] h1, .tui-review-modal [data-part="markdown"] p'
    );
    await shoot(page, `reviewmodal-${theme}`);
    await page.keyboard.press('Escape');
  }
  // decision queue: the loop below skips gates until it lands on the
  // sectioned face (B7): the overview strip and the question's own context,
  // wherever that gate sits in the queue.
  await page.click('.tui-dq-open');
  await page.waitForSelector('.tui-triage-body');
  for (
    let i = 0;
    i < 10 &&
    !(await page.locator('.tui-gate-question[data-sectioned]').count());
    i++
  ) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await page.waitForSelector('.tui-gate-question[data-sectioned]');
  await shoot(page, `queue-${theme}`);
  // The bracketed-findings gate (B9): the pane groups by label rather than
  // leading every line with its own prefix.
  for (let i = 0; i < 10; i++) {
    if (await page.locator('.tui-gate-groups').count()) break;
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await page.waitForSelector('.tui-gate-groups');
  await shoot(page, `queuegroups-${theme}`);
  await page.keyboard.press('Escape');
  // Structured respond gates: the header card in place of the MR strip,
  // then the thread card (respond-plan) and the replies card (respond-post).
  // Each shot reopens the queue, which starts a fresh session at the first
  // gate, and skips forward to its gate.
  for (const [shape, name] of [
    ['plan@1', 'queueplan'],
    ['post@1', 'queuepost'],
  ] as const) {
    await page.click('.tui-dq-open');
    await page.waitForSelector('.tui-triage-body');
    const head = page.locator(`.tui-respond-head[data-shape="${shape}"]`);
    for (let i = 0; i < 10 && !(await head.count()); i++) {
      await page.getByRole('button', { name: 'skip gate' }).click();
      await page.waitForTimeout(120);
    }
    await head.waitFor();
    await shoot(page, `${name}-${theme}`);
    await page.keyboard.press('Escape');
  }
  // settings modal
  await page.click('.tui-side-gear');
  await page.waitForSelector('[data-part="modal"]');
  await shoot(page, `settings-${theme}`);
  await page.keyboard.press('Escape');
  // codeowners tab whose section is not a CODEOWNERS header: the alarm
  await page.click('[role="tab"]:has-text("Acme Queue")');
  await page.waitForSelector('.tui-banner[data-intent="bad"]');
  await shoot(page, `badsection-${theme}`);
  await page.click('[role="tab"]:has-text("Team")');
  await page.waitForSelector('.tui-row');
  // selection bar
  await page.locator('[data-part="selectbox"]').first().click();
  await page.waitForSelector('.tui-selbar');
  await shoot(page, `selection-${theme}`);
  await page.close();

  // mobile drawer (below the 720px breakpoint)
  page = await newPage(700, theme);
  await shoot(page, `mobile-${theme}`);
  await page.click('.tui-burger');
  await page.waitForSelector('[data-part="sidedrawer"][data-side="left"]');
  await shoot(page, `drawer-${theme}`);
  await page.close();

  // phone width (the 480px rules: branch and behind hidden, pill tightened)
  page = await newPage(400, theme);
  await shoot(page, `phone-${theme}`);
  await page.close();

  // focus states: tab from the top and shoot the first few focus stops
  page = await newPage(1280, theme);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await shoot(page, `focus-${theme}`);
  await page.close();
}

await browser.close();
server.kill();
console.log(`captures written to ${OUT}`);
