/** Real-layout check for the decision queue's full-screen sheet, run in
    headless chromium against the fixture server: happy-dom does no layout.
    Every gate face fills the window, the sheet itself never scrolls, and
    the control that moves the decision forward (the gate body's step nav,
    or the review sheet's submit) always stays on screen. Boots on a free
    port so a concurrent `capture` run on 7941 is untouched. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '..');
/** A common laptop window. */
const LAPTOP = { width: 1440, height: 900 };
/** A short laptop window. */
const SHORT = { width: 1000, height: 812 };
/** Shorter than any real laptop window: only here should the question
    area's own scroll fallback fire. */
const VERY_SHORT = { width: 1000, height: 700 };

/** The slice of the page's DOM the measurements touch; this tsconfig has no
    `dom` lib, so the evaluate callbacks reach it through a cast. */
type Measured = {
  clientHeight: number;
  scrollHeight: number;
  getBoundingClientRect(): { top: number; bottom: number; height: number };
  querySelectorAll(selector: string): Measured[];
};
type PageGlobals = {
  document: { querySelector(selector: string): Measured | null };
};

let server: ReturnType<typeof Bun.spawn>;
let browser: Browser;
let BASE = '';

function freePort(): number {
  const probe = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  probe.stop(true);
  if (!port) throw new Error('no free port');
  return port;
}

beforeAll(async () => {
  const port = freePort();
  BASE = `http://127.0.0.1:${port}`;
  server = Bun.spawn(['bun', 'run', join(ROOT, 'src/server.ts')], {
    env: {
      ...process.env,
      BOARD_FIXTURE: join(ROOT, 'tests/fixture'),
      BOARD_STATE_DB: join(
        mkdtempSync(join(tmpdir(), 'dq-layout-')),
        'state.db'
      ),
      PORT: String(port),
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    if (server.exitCode !== null)
      throw new Error(`fixture server exited with ${server.exitCode}`);
    try {
      up = (await fetch(`${BASE}/healthz`)).ok;
    } catch {}
    if (!up) await new Promise(r => setTimeout(r, 200));
  }
  if (!up) throw new Error('fixture server never answered /healthz');
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

async function openQueue(viewport: {
  width: number;
  height: number;
}): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.abort()
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?member=all`);
  await page.waitForSelector('.tui-row');
  await page.click('.tui-dq-open');
  await page.waitForSelector('.tui-gate-sheet');
  return page;
}

/** Steps forward with the head's next-gate control until `selector`
    matches, so no test assumes which queue position a gate holds. */
async function nextUntil(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  for (let i = 0; i < 10 && !(await target.count()); i++) {
    await page.getByRole('button', { name: 'next gate' }).click();
    await page.waitForTimeout(120);
  }
  await target.first().waitFor();
}

type Layout = {
  kind: 'review' | 'respond' | 'triage';
  sheetTop: number;
  sheetBottom: number;
  sheetScrolls: boolean;
  /** The rail's docked submit (review, respond) or the step nav (triage):
      the one control that moves the decision forward. */
  forwardBottom: number;
  itemsScrolls: boolean;
  paneRootHeight: number;
  paneFloorPx: number;
};

function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const sheet = document.querySelector('.tui-gate-sheet')!;
    const review = document.querySelector('.tui-review-sheet');
    const respond = document.querySelector('.tui-respond-sheet');
    const forward =
      document.querySelector('.tui-sheet-submit') ??
      document.querySelector('.tui-gate-actions');
    const items = document.querySelector('.tui-gate-items');
    const root = document.querySelector(
      '.tui-triage-sheet [data-part="scrollpane"]'
    );
    const win = globalThis as unknown as {
      getComputedStyle(el: unknown): { minHeight: string };
    };
    const sheetRect = sheet.getBoundingClientRect();
    return {
      kind: review
        ? ('review' as const)
        : respond
          ? ('respond' as const)
          : ('triage' as const),
      sheetTop: sheetRect.top,
      sheetBottom: sheetRect.bottom,
      sheetScrolls: sheet.scrollHeight > sheet.clientHeight + 1,
      forwardBottom: forward ? forward.getBoundingClientRect().bottom : 0,
      // +1: Blink's 1/64px layout units round apart by a fraction.
      itemsScrolls: items ? items.scrollHeight > items.clientHeight + 1 : false,
      paneRootHeight: root ? root.getBoundingClientRect().height : 0,
      paneFloorPx: root ? parseFloat(win.getComputedStyle(root).minHeight) : 0,
    };
  });
}

function expectSheetLaw(m: Layout, viewport: { height: number }): void {
  expect(m.sheetTop).toBe(0);
  expect(Math.abs(m.sheetBottom - viewport.height)).toBeLessThanOrEqual(0.5);
  expect(m.sheetScrolls).toBe(false);
  expect(m.forwardBottom).toBeGreaterThan(0);
  expect(m.forwardBottom).toBeLessThanOrEqual(viewport.height);
}

test('every gate fills the window, never scrolls, and keeps its forward control on screen', async () => {
  for (const viewport of [LAPTOP, SHORT]) {
    const page = await openQueue(viewport);
    const kinds = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const m = await measure(page);
      kinds.add(m.kind);
      expectSheetLaw(m, viewport);
      const next = page.getByRole('button', { name: 'next gate' });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(150);
    }
    expect(await page.locator('.tui-triage-done').count()).toBe(0);
    expect([...kinds].sort()).toEqual(['respond', 'review', 'triage']);
    await page.context().close();
  }
}, 60_000);

test('laptop: a respond gate lists every thread at full height beside a docked submit', async () => {
  const page = await openQueue(LAPTOP);
  await nextUntil(page, '.tui-respond-sheet');
  const cards = await page.evaluate(() => {
    const { document } = globalThis as unknown as {
      document: { querySelectorAll(s: string): ArrayLike<Measured> };
    };
    return Array.from(
      document.querySelectorAll('.tui-respond-list .tui-thread-card')
    ).map(c => c.scrollHeight <= c.clientHeight + 1);
  });
  expect(cards.length).toBeGreaterThan(1);
  expect(cards.every(Boolean)).toBe(true);
  expectSheetLaw(await measure(page), LAPTOP);
  await page.context().close();
}, 30_000);

test('very short: the question area scrolls as the fallback, the step nav stays on screen', async () => {
  const page = await openQueue(VERY_SHORT);
  await nextUntil(page, '.tui-triage-sheet [data-part="scrollpane-body"] p');
  const m = await measure(page);
  expectSheetLaw(m, VERY_SHORT);
  // The pane is reference material and yields first: if the question area
  // had to scroll, the pane is already at its floor.
  if (m.itemsScrolls) {
    expect(m.paneRootHeight).toBeLessThanOrEqual(m.paneFloorPx + 1);
  }
  await page.context().close();
}, 30_000);

test('the head is one row: title, focus pane, queue nav and close share a line -- no skip chip', async () => {
  const page = await openQueue(LAPTOP);
  for (let pass = 0; pass < 2; pass++) {
    const middle = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      return box.y + box.height / 2;
    };
    const title = await middle('.tui-gate-sheet-title');
    for (const selector of [
      '.tui-gate-sheet-actions button:has-text("focus pane")',
      '.tui-gate-queue-nav',
      '.tui-gate-sheet-close',
    ])
      expect(Math.abs((await middle(selector)) - title)).toBeLessThanOrEqual(4);
    expect(
      await page
        .locator('.tui-gate-sheet-head button:has-text("skip gate")')
        .count()
    ).toBe(0);
    // Once on the review sheet (gate 1), once on a triage gate.
    await nextUntil(page, '.tui-triage-sheet');
  }
  await page.context().close();
}, 30_000);

test('queue nav: previous is disabled at the first gate and walks back from the next', async () => {
  const page = await openQueue(LAPTOP);
  const prev = page.locator('[aria-label="previous gate"]');
  const pos = page.locator('.tui-gate-queue-pos');
  expect(await prev.isDisabled()).toBe(true);
  expect(await pos.textContent()).toMatch(/^1 of \d+$/);
  await page.getByRole('button', { name: 'next gate' }).click();
  await page.waitForTimeout(150);
  expect(await pos.textContent()).toMatch(/^2 of \d+$/);
  expect(await prev.isDisabled()).toBe(false);
  await prev.click();
  await page.waitForTimeout(150);
  expect(await pos.textContent()).toMatch(/^1 of \d+$/);
  await page.context().close();
}, 30_000);

test('the recommended choice is highlighted only until something in its question is picked', async () => {
  const page = await openQueue(LAPTOP);
  await nextUntil(page, '.tui-respond-sheet');
  const tinted = () =>
    page.evaluate(() => {
      const { document } = globalThis as unknown as {
        document: { querySelectorAll(s: string): ArrayLike<unknown> };
      };
      const win = globalThis as unknown as {
        getComputedStyle(el: unknown): { backgroundColor: string };
      };
      return Array.from(
        document.querySelectorAll(
          '.tui-respond-list > .tui-gate-question:first-child .tui-gate-choice[data-recommended]'
        )
      ).map(
        c => win.getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)'
      );
    });
  expect(await tinted()).toEqual([true]);
  await page
    .locator(
      '.tui-respond-list > .tui-gate-question:first-child .tui-gate-choice:not([data-recommended])'
    )
    .first()
    .click();
  // The choice background transitions, so wait out the fade before reading.
  for (let i = 0; i < 20 && (await tinted())[0]; i++)
    await page.waitForTimeout(50);
  expect(await tinted()).toEqual([false]);
  await page.context().close();
}, 30_000);
