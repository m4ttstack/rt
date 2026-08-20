// Boots the board's real server in DECK_FIXTURE mode (deterministic status
// payload, inert mutations) and drives it with a real headless Chromium, so
// DOM specs exercise the same HTML/JS/CSS the browser gets in production.
import { chromium, type Browser, type Page } from "playwright";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const ROOT = join(import.meta.dir, "../..");
const FIXTURE_DIR = join(ROOT, "test/fixture");

let sharedBrowser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  sharedBrowser ??= await chromium.launch({ headless: true });
  return sharedBrowser;
}

async function freePort(): Promise<number> {
  // Probe-and-release: the window between releasing this port and the spawned
  // server binding it is negligible for a single serialized test file.
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  // Bun.Server.port is typed number | undefined; an undefined here would
  // silently build a "http://127.0.0.1:undefined" base URL and burn the full
  // healthz retry budget on a confusing timeout instead of failing fast.
  if (port === undefined) throw new Error("probe server had no port");
  return port;
}

const consoleErrorsByPage = new WeakMap<Page, string[]>();

/** Console/page errors observed on `page` since its navigation began. */
export function consoleErrors(page: Page): string[] {
  return consoleErrorsByPage.get(page) ?? [];
}

export async function withBoard(fn: (page: Page) => Promise<void>): Promise<void> {
  const port = await freePort();
  const stateDir = mkdtempSync(join(tmpdir(), "deck-dom-"));
  const base = `http://127.0.0.1:${port}`;

  const proc = Bun.spawn(["bun", "run", join(ROOT, "src/main.ts"), "serve"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DECK_FIXTURE: FIXTURE_DIR,
      LOCAL_STATE_DIR: stateDir,
      // Never touch the real launchd deck service or ~/.mattstack state.
      LOCAL_APPS_NO_GATEWAY: "1",
      LOCAL_APPS_AUTO_HEAL: "0",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`${base}/healthz`)).ok; } catch { /* not listening yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    if (!up) throw new Error(`fixture server on ${base} did not become healthy`);

    const browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    consoleErrorsByPage.set(page, errors);
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));

    try {
      await page.goto(base);
      await page.waitForSelector("[data-board-ready]");
      await fn(page);
    } finally {
      await context.close();
    }
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(stateDir, { recursive: true, force: true });
  }
}
