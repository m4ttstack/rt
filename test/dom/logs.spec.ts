// Logs lives in the drawer now (drawer-states-atlas.html "4 · Logs, edit,
// remove") -- the stderr modal is retired. ledger carries the fixture's one
// stderr line; forecast/orbit/atlas/stray-agent/cloudflared carry none.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard } from "./rig.ts";
import fixture from "../fixture/status.json" with { type: "json" };

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({
    has: page.locator('[data-part="table-cell"]').first().filter({ hasText: name }),
  });
}

async function openDrawer(page: Page, name: string): Promise<void> {
  await rowFor(page, name).locator('[data-part="row-chevron"]').click();
  await page.waitForSelector('[data-part="sidedrawer"]');
}

async function openLogs(page: Page, name: string): Promise<void> {
  await openDrawer(page, name);
  await page
    .locator('[data-part="listgroup-nav"]')
    .filter({ has: page.locator('[data-part="listgroup-label"]', { hasText: "logs" }) })
    .locator("button")
    .click();
  await page.waitForSelector('[data-part="drawer-title"]', { hasText: "logs" });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitUntil() timed out");
}

test("stderr modal is gone: no trigger on the health cell, no modal reachable", async () => {
  await withBoard(async (page) => {
    expect(await page.locator('[aria-label^="show recent stderr for"]').count()).toBe(0);
    await openLogs(page, "ledger");
    expect(await page.locator('[data-part="modal"]').count()).toBe(0);
  });
});

// `withBoard` navigates and waits for `[data-board-ready]` before handing
// back the page, so the very first `/api/v1/status` fetch (the one that
// paints the board pre-test) always lands before a route registered inside a
// test can intercept it -- these two tests open the drawer against the real
// committed fixture (ledger's one real stderr line) and only start
// intercepting for the NEXT tick of the board's own 5s poll, which is also
// what makes them genuine tests of "live," not just "shows initial state."
test(
  "logs screen shows a richer stderr tail landed by the next poll, newest at the bottom",
  async () => {
    await withBoard(async (page) => {
      await openLogs(page, "ledger");
      const box = page.locator(".drawer-logbox");
      expect((await box.textContent())?.trim()).toBe("Error: connect ECONNREFUSED");

      await page.route("**/api/v1/status", async (route) => {
        const next = structuredClone(fixture) as typeof fixture;
        const ledger = next.apps.find((a) => a.name === "ledger");
        if (!ledger?.service) throw new Error("fixture missing ledger.service");
        ledger.service.stderr = ["bun: error: connect ECONNREFUSED", "exited with code 1", "launchd: respawning in 10s"];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
      });

      await waitUntil(async () => ((await box.textContent()) ?? "").includes("respawning"));
      expect((await box.textContent())?.trim()).toBe(
        "bun: error: connect ECONNREFUSED\nexited with code 1\nlaunchd: respawning in 10s",
      );
      expect(
        await page.locator('[data-part="listgroup-footer"]', {
          hasText: "last 200 lines of stderr, newest at the bottom · live",
        }).count(),
      ).toBe(1);
    });
  },
  15000,
);

test(
  "logs screen live-updates when a later poll returns a new stderr line",
  async () => {
    await withBoard(async (page) => {
      await openLogs(page, "ledger");
      const box = page.locator(".drawer-logbox");
      expect((await box.textContent())?.trim()).toBe("Error: connect ECONNREFUSED");

      await page.route("**/api/v1/status", async (route) => {
        const next = structuredClone(fixture) as typeof fixture;
        const ledger = next.apps.find((a) => a.name === "ledger");
        if (!ledger?.service) throw new Error("fixture missing ledger.service");
        ledger.service.stderr = ["Error: connect ECONNREFUSED", "launchd: respawning in 10s"];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
      });

      // The board's own poll interval (REFRESH_MS, 5s) is what lands this --
      // no manual refresh trigger exists for a screen that's just reading
      // live board state, so the wait has to clear that real interval.
      await waitUntil(async () => ((await box.textContent()) ?? "").includes("respawning"));
      expect((await box.textContent())?.trim()).toBe("Error: connect ECONNREFUSED\nlaunchd: respawning in 10s");
    });
  },
  15000,
);

test("empty state: a row with no stderr shows a dim 'no recent output' fact, not an empty box", async () => {
  await withBoard(async (page) => {
    await openLogs(page, "forecast"); // stderr: [] in the fixture
    expect(await page.locator(".drawer-logbox").count()).toBe(0);
    expect(
      await page.locator('[data-part="listgroup-fact"]', { hasText: "no recent output" }).count(),
    ).toBe(1);
  });
});

test("copy all writes the tail to the clipboard", async () => {
  await withBoard(async (page) => {
    await openLogs(page, "ledger");
    await page
      .locator('[data-part="listgroup-action"]')
      .filter({ hasText: "copy all" })
      .locator("button")
      .click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("Error: connect ECONNREFUSED");
  });
});
