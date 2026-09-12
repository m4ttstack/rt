/** Real-layout check for the decision queue's context pane, run in headless
    chromium against the fixture server: happy-dom does no layout, and the
    defect this guards (the pane squeezed to zero under the form on a short
    viewport) only exists once CSS flex sizing runs. Boots on a free port so
    a concurrent `capture` run on 7941 is untouched. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '..');
const SHORT_VIEWPORT = { width: 1000, height: 640 };

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
  const ctx = await browser.newContext({ viewport: SHORT_VIEWPORT });
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

test('context pane keeps a readable height under the form on a short viewport', async () => {
  const page = await openDecisionQueue();
  const { clientHeight, scrollHeight } = await page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const body = document.querySelector(
      '.tui-triage-modal [data-part="scrollpane-body"]'
    )!;
    return { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight };
  });
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  expect(clientHeight).toBeGreaterThanOrEqual(120);
  await page.context().close();
}, 30_000);

test('the form and footer stay in flow below the pane, reached by scrolling the modal', async () => {
  const page = await openDecisionQueue();
  const actions = page.locator('.tui-triage-form-col .tui-gate-actions-end');
  await actions.scrollIntoViewIfNeeded();
  const { formBottom, footerTop, modalScrolls } = await page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const modal = document.querySelector('.tui-triage-modal')!;
    const form = document.querySelector('.tui-triage-form-col')!;
    const footer = document.querySelector('.tui-triage-footer')!;
    return {
      formBottom: form.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      modalScrolls: modal.scrollHeight > modal.clientHeight,
    };
  });
  expect(footerTop).toBeGreaterThanOrEqual(formBottom);
  expect(modalScrolls).toBe(true);
  await expect(actions.isVisible()).resolves.toBe(true);
  await page.context().close();
}, 30_000);
