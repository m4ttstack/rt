// bun:test's `expect` has no Playwright-locator matchers (toBeVisible,
// toHaveAttribute, expect.poll, ...) -- those live in @playwright/test's own
// expect. Assertions here read a value off the Locator/Page API directly
// (which auto-waits for attachment) and compare with bun's expect.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard, consoleErrors } from "./rig.ts";
import { subline, type StatusData } from "../../core/board/logic.ts";
import fixture from "../fixture/status.json" with { type: "json" };

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({ has: page.locator("strong", { hasText: name }) });
}

async function poll(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!check()) throw new Error("poll() timed out waiting for condition");
}

test("renders one row per fixture app; site cell links name + suffix", async () => {
  await withBoard(async (page) => {
    const appsTable = page.locator("table").first();
    expect(await appsTable.locator('[data-part="table-row"]').count()).toBe(3);

    const atlasLink = rowFor(page, "atlas").locator("a.unstyled");
    expect(await atlasLink.getAttribute("href")).toBe("https://atlas.localhost");
    const text = await atlasLink.textContent();
    expect(text).toContain("atlas");
    expect(text).toContain(".mattstack");

    expect(consoleErrors(page)).toEqual([]);
  });
});

test("health badges: status+ms for healthy, unreachable for down", async () => {
  await withBoard(async (page) => {
    const atlasBadge = rowFor(page, "atlas").locator('[data-part="badge"]', { hasText: "200" });
    expect(await atlasBadge.textContent()).toContain("34ms");

    const ledgerBadge = rowFor(page, "ledger").locator('[data-part="badge"]', { hasText: "unreachable" });
    expect(await ledgerBadge.count()).toBeGreaterThan(0);
  });
});

test("launchd column shows running+pid or stopped", async () => {
  await withBoard(async (page) => {
    const atlasLaunchd = rowFor(page, "atlas").locator('[data-part="table-cell"]').nth(3);
    const atlasText = await atlasLaunchd.textContent();
    expect(atlasText).toContain("running");
    expect(atlasText).toContain("5123");

    const ledgerLaunchd = rowFor(page, "ledger").locator('[data-part="table-cell"]').nth(3);
    expect(await ledgerLaunchd.textContent()).toContain("stopped");
  });
});

test("ownership chip: this board vs managed by", async () => {
  await withBoard(async (page) => {
    const forecastChip = rowFor(page, "forecast").locator('[data-part="chip"]', { hasText: "this board" });
    expect(await forecastChip.count()).toBe(1);

    const atlasChip = rowFor(page, "atlas").locator('[data-part="chip"]', { hasText: "managed" });
    expect(await atlasChip.textContent()).toContain("mattstack");
  });
});

test("publish switch carries the parity aria-label and fires PUT then a refresh GET", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/forecast/publish", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let statusRequests = 0;
    await page.route("**/api/v1/status", async (route) => {
      statusRequests++;
      await route.continue();
    });

    const toggle = rowFor(page, "forecast").locator('[data-part="switch-control"]');
    expect(await toggle.getAttribute("aria-label")).toBe("make forecast private");

    const before = statusRequests;
    await toggle.click();
    await poll(() => statusRequests > before);
    expect(putBody).toEqual({ published: false });
  });
});

test("strays section and tunnel section render", async () => {
  await withBoard(async (page) => {
    expect(await page.locator("h2", { hasText: "services without routes" }).count()).toBe(1);
    expect(await page.locator("h2", { hasText: "cloudflare tunnel" }).count()).toBe(1);
    expect(await page.getByText("carries *.mattstack").count()).toBe(1);
  });
});

test("subline matches logic.subline of the fixture", async () => {
  await withBoard(async (page) => {
    const expected = subline(fixture as unknown as StatusData);
    expect(await page.locator(".board-subline").textContent()).toBe(expected);
  });
});

test("restart button posts and flips the row to a restarting badge with a spinner", async () => {
  await withBoard(async (page) => {
    let posted = false;
    await page.route("**/api/v1/apps/atlas/restart", async (route) => {
      posted = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const atlasRow = rowFor(page, "atlas");
    await atlasRow.locator('[aria-label="restart atlas"]').click();
    expect(posted).toBe(true);

    const healthCell = atlasRow.locator('[data-part="table-cell"]').nth(2);
    await healthCell.locator('[data-part="badge"]', { hasText: "restarting" }).waitFor({ state: "visible" });
    expect(await healthCell.locator('[data-part="spinner"]').count()).toBe(1);
  });
});

test("issues render a bad badge and the raw message", async () => {
  await withBoard(async (page) => {
    const ledgerRow = rowFor(page, "ledger");
    expect(await ledgerRow.locator('[data-part="badge"]', { hasText: "cloudflare sync failed" }).count()).toBe(1);
    expect(await ledgerRow.locator("code").textContent()).toContain("Access sync failed: 502 from Cloudflare API");
  });
});

test("external-link anchor appears only when publicUrl differs, with parity aria-label", async () => {
  await withBoard(async (page) => {
    const atlasExtLink = rowFor(page, "atlas").locator('a[target="_blank"]');
    expect(await atlasExtLink.getAttribute("aria-label")).toBe("open atlas.mattstack");

    const ledgerExtLink = rowFor(page, "ledger").locator('a[target="_blank"]');
    expect(await ledgerExtLink.count()).toBe(0);
  });
});
