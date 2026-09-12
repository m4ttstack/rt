/** Real-layout check for the decision queue's context pane, run in headless
    chromium against the fixture server: happy-dom does no layout, and the
    law this guards (the modal never scrolls; the pane takes what the form
    leaves and scrolls on its own) only exists once CSS flex sizing runs.
    Boots on a free port so a concurrent `capture` run on 7941 is untouched. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '..');
/** Tall enough for the modal chrome and the fixture gate's form to fit the
    80vh cap with room left over, so the pane's share is what's measured. */
const VIEWPORT = { width: 1000, height: 1000 };

/** The slice of the page's DOM the measurements touch; this tsconfig has no
    `dom` lib, so the evaluate callbacks reach it through a cast. */
type Measured = {
  clientHeight: number;
  scrollHeight: number;
  getBoundingClientRect(): { top: number; bottom: number };
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

async function openDecisionQueue(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.abort()
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?member=all`);
  await page.waitForSelector('.tui-row');
  await page.click('.tui-dq-open');
  await page.waitForSelector(
    '.tui-triage-modal [data-part="scrollpane-body"] [data-part="markdown"] p'
  );
  return page;
}

test('the modal never scrolls: the pane takes what the form leaves and scrolls itself', async () => {
  const page = await openDecisionQueue();
  const m = await page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const modal = document.querySelector('.tui-triage-modal')!;
    const pane = document.querySelector(
      '.tui-triage-modal [data-part="scrollpane-body"]'
    )!;
    const footer = document.querySelector('.tui-triage-footer')!;
    return {
      modalScrolls: modal.scrollHeight > modal.clientHeight,
      modalBottom: modal.getBoundingClientRect().bottom,
      footerBottom: footer.getBoundingClientRect().bottom,
      paneHeight: pane.clientHeight,
      paneScrolls: pane.scrollHeight > pane.clientHeight,
    };
  });
  expect(m.modalScrolls).toBe(false);
  expect(m.footerBottom).toBeLessThanOrEqual(m.modalBottom);
  expect(m.paneHeight).toBeGreaterThan(0);
  expect(m.paneScrolls).toBe(true);
  await page.context().close();
}, 30_000);
