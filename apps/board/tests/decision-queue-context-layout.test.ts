/** Real-layout check for the decision queue's context pane, run in headless
    chromium against the fixture server: happy-dom does no layout, and the
    law this guards (the pane is as tall as its text up to its 46vh cap and
    never shrinks below that; the body, never the modal, scrolls when the
    pane plus the form outgrow the modal's cap) only exists once CSS flex
    sizing runs. Boots on a free port so a concurrent `capture` run on 7941
    is untouched. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '..');
const ROOMY = { width: 1000, height: 1100 };
/** A laptop-height window: the form alone nearly fills the modal's cap,
    which is where a shrinkable pane collapses to its header. */
const SHORT = { width: 1000, height: 812 };
/** The ScrollPane cap DecisionQueueModal passes, as a share of the
    viewport height. */
const PANE_CAP = 0.46;

/** The slice of the page's DOM the measurements touch; this tsconfig has no
    `dom` lib, so the evaluate callbacks reach it through a cast. */
type Measured = {
  clientHeight: number;
  scrollHeight: number;
  getBoundingClientRect(): { top: number; bottom: number; height: number };
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

/** Opens the queue and skips forward to the first gate whose context pane
    renders prose; the queue order is the fixture's row order, so this does
    not assume which position that gate holds. */
async function openDecisionQueue(viewport: {
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
  await page.waitForSelector('.tui-triage-body');
  const prose = page.locator(
    '.tui-triage-modal [data-part="scrollpane-body"] [data-part="markdown"] p'
  );
  for (let i = 0; i < 10 && !(await prose.count()); i++) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await prose.first().waitFor();
  return page;
}

type Layout = {
  modalScrolls: boolean;
  bodyScrolls: boolean;
  modalBottom: number;
  footerBottom: number;
  paneRootHeight: number;
  paneScrolls: boolean;
};

function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const modal = document.querySelector('.tui-triage-modal')!;
    const root = document.querySelector(
      '.tui-triage-modal [data-part="scrollpane"]'
    )!;
    const pane = document.querySelector(
      '.tui-triage-modal [data-part="scrollpane-body"]'
    )!;
    const footer = document.querySelector('.tui-triage-footer')!;
    const body = document.querySelector('.tui-triage-body')!;
    return {
      modalScrolls: modal.scrollHeight > modal.clientHeight,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      modalBottom: modal.getBoundingClientRect().bottom,
      footerBottom: footer.getBoundingClientRect().bottom,
      paneRootHeight: root.getBoundingClientRect().height,
      paneScrolls: pane.scrollHeight > pane.clientHeight,
    };
  });
}

function expectPaneLaw(m: Layout, viewportHeight: number): void {
  const cap = viewportHeight * PANE_CAP;
  expect(m.paneRootHeight).toBeLessThanOrEqual(cap + 1);
  // Never shrunk: either all of the text shows, or the pane stands at its cap.
  if (m.paneScrolls) expect(m.paneRootHeight).toBeGreaterThanOrEqual(cap - 1);
  expect(m.modalScrolls).toBe(false);
  expect(m.footerBottom).toBeLessThanOrEqual(m.modalBottom);
}

test('roomy: the pane is as tall as its text up to its cap, and the modal never scrolls', async () => {
  const page = await openDecisionQueue(ROOMY);
  expectPaneLaw(await measure(page), ROOMY.height);
  await page.context().close();
}, 30_000);

test('short: the pane keeps its height and the body scrolls to the form under the pinned footer', async () => {
  const page = await openDecisionQueue(SHORT);
  const m = await measure(page);
  expectPaneLaw(m, SHORT.height);
  expect(m.bodyScrolls).toBe(true);
  await page.context().close();
}, 30_000);
