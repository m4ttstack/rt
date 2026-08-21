// Per-row drawer: open/close mechanics, keyboard contract, selected-row
// highlight, and focus restore -- including the row-vanished edge case
// (Drawer's own returnFocusRef silently no-ops on a detached chevron).
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard, consoleErrors } from "./rig.ts";
import fixture from "../fixture/status.json" with { type: "json" };

// The site cell renders the name in a <strong> only when the row has a
// route; an unrouted row (a stray, or a tunnel) falls back to a plain span
// (see AppsTable's SiteCell) -- scoping to the row's first cell, not a tag,
// matches both.
function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({
    has: page.locator('[data-part="table-cell"]').first().filter({ hasText: name }),
  });
}

function chevronFor(page: Page, name: string) {
  return rowFor(page, name).locator('[data-part="row-chevron"]');
}

async function openDrawer(page: Page, name: string): Promise<void> {
  await chevronFor(page, name).click();
  await page.waitForSelector('[data-part="sidedrawer"]');
}

test("row click opens the drawer, titled by the app name", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("atlas");
    expect(consoleErrors(page)).toEqual([]);
  });
});

test("switch, restart, and site-link clicks do not open the drawer", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/forecast/publish", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );
    await page.route("**/api/v1/apps/atlas/restart", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );

    await rowFor(page, "forecast").locator('[data-part="switch-control"]').click();
    expect(await page.locator('[data-part="sidedrawer"]').count()).toBe(0);

    await rowFor(page, "atlas").locator('[aria-label="restart atlas"]').click();
    expect(await page.locator('[data-part="sidedrawer"]').count()).toBe(0);

    await rowFor(page, "atlas").locator('a[target="_blank"]').click();
    expect(await page.locator('[data-part="sidedrawer"]').count()).toBe(0);
  });
});

test("esc closes the drawer at its root screen", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached" });
  });
});

test("✕ closes the drawer", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    await page.locator('[data-part="drawer-close"]').click();
    await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached" });
  });
});

test("↑/↓ move the drawer to the adjacent row, resetting to its root", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    // dev port push, then ↓: title must land back on the next row's root, not
    // "dev port" for the next row.
    await rowFor(page, "atlas").locator('[data-part="row-chevron"]').focus();
    await page.locator('[data-part="listgroup-nav"] button', { hasText: "dev port" }).click();
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("dev port");

    await page.keyboard.press("ArrowDown");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("forecast");
    expect(await page.locator('[data-part="drawer-back"]').count()).toBe(0);

    await page.keyboard.press("ArrowUp");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("atlas");
  });
});

test("the open row carries a selected class", async () => {
  await withBoard(async (page) => {
    const atlasRow = rowFor(page, "atlas");
    expect(await atlasRow.getAttribute("class")).not.toContain("row-selected");

    await openDrawer(page, "atlas");
    expect(await atlasRow.getAttribute("class")).toContain("row-selected");
  });
});

test("closing the drawer returns focus to the row's chevron", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached" });
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return active?.getAttribute("data-part") === "row-chevron" && active?.getAttribute("aria-label");
      }),
    ).toBe("details for atlas");
  });
});

test(
  "when the open row's data vanishes, the drawer closes and focus lands on a stable fallback",
  async () => {
    await withBoard(async (page) => {
      let dropLedger = false;
      await page.route("**/api/v1/status", async (route) => {
        if (!dropLedger) {
          await route.continue();
          return;
        }
        const next = structuredClone(fixture) as typeof fixture;
        next.apps = next.apps.filter((a) => a.name !== "ledger");
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
      });

      await openDrawer(page, "ledger");
      dropLedger = true;
      await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached", timeout: 8000 });

      expect(await page.evaluate(() => document.activeElement === document.querySelector("main.board"))).toBe(true);
    });
  },
  12000,
);

test("a service-without-route root's 'give it a route…' opens the add modal prefilled with its name", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "stray-agent");
    await page.locator('[data-part="listgroup-action"] button', { hasText: "give it a route" }).click();
    await page.waitForSelector('[data-part="modal"]');
    expect(await page.getByRole("textbox", { name: "Name" }).inputValue()).toBe("stray-agent");
  });
});

test("root screens render per row kind: app (public+nav+actions+danger), service (reduced), tunnel (facts+restart)", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    const drawer = page.locator('[data-part="sidedrawer"]');
    expect(await drawer.locator('[data-part="listgroup-toggle"]', { hasText: "public" }).count()).toBe(1);
    expect(await drawer.locator('[data-part="listgroup-nav"]').count()).toBe(4); // dev port, access, logs, edit app
    // Danger is an Action row (data-part="listgroup-action") with a bad-intent,
    // centered button -- there is no separate "danger" part.
    expect(await drawer.locator('button[data-intent="bad"][data-centered]', { hasText: "remove app" }).count()).toBe(1);
    await page.locator('[data-part="drawer-close"]').click();
    await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached" });

    await openDrawer(page, "stray-agent");
    expect(await drawer.locator('[data-part="listgroup-toggle"]').count()).toBe(0);
    expect(await drawer.locator('button[data-intent="bad"][data-centered]').count()).toBe(0);
    expect(await drawer.locator('[data-part="listgroup-action"]', { hasText: "give it a route" }).count()).toBe(1);
    await page.locator('[data-part="drawer-close"]').click();
    await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached" });

    await openDrawer(page, "cloudflared");
    expect(await drawer.locator('[data-part="listgroup-fact"]', { hasText: "carries" }).count()).toBe(1);
    expect(await drawer.locator('[data-part="listgroup-action"]', { hasText: "restart tunnel" }).count()).toBe(1);
  });
});

test("a broken app's root shows an error banner and a bad-tone logs hint", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "ledger");
    const drawer = page.locator('[data-part="sidedrawer"]');
    expect(await drawer.locator('[data-part="alert"][data-intent="bad"]').count()).toBe(1);
    expect(await drawer.locator('[data-part="listgroup-nav"] .t-bad').count()).toBe(1);
  });
});
