// Remote toggle + Push button + public-origin row marker (task 17). Uses its
// own fixture (status-remote.json): atlas is a plain non-remote row that can
// still turn remote on, railwayapp is already live on Railway, gatedapp is
// password-only (no sign-in gate) with remote off -- the one combination
// that disables the toggle -- and lockedout is the same password-only/no-gate
// combination but already remote, proving the toggle stays enabled so the OFF
// path is never blocked.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard } from "./rig.ts";

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({
    has: page.locator('[data-part="table-cell"]').first().filter({ hasText: name }),
  });
}

async function openDrawer(page: Page, name: string): Promise<void> {
  await rowFor(page, name).locator('[data-part="row-chevron"]').click();
  await page.waitForSelector('[data-part="sidedrawer"]');
}

function remoteToggle(page: Page) {
  return page
    .locator('[data-part="listgroup-toggle"]')
    .filter({ has: page.locator('[data-part="listgroup-label"]', { hasText: "remote" }) });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitUntil() timed out");
}

test("a live-remote row shows a public: railway marker and a Push to Railway button", async () => {
  await withBoard(
    async (page) => {
      const row = rowFor(page, "railwayapp");
      expect(await row.locator('[data-part="chip"]', { hasText: "public: railway" }).count()).toBe(1);
      const push = row.locator('[aria-label="push railwayapp to Railway"]');
      expect(await push.count()).toBe(1);
      expect(await push.isDisabled()).toBe(false);

      // A row never in remote mode carries neither.
      const plain = rowFor(page, "atlas");
      expect(await plain.locator('[data-part="chip"]', { hasText: "public: railway" }).count()).toBe(0);
      expect(await plain.locator('[aria-label="push atlas to Railway"]').count()).toBe(0);
    },
    { fixture: "status-remote.json" },
  );
});

test("a non-remote row's drawer renders an enabled Remote toggle, off", async () => {
  await withBoard(
    async (page) => {
      await openDrawer(page, "atlas");
      const toggle = remoteToggle(page);
      expect(await toggle.count()).toBe(1);
      const control = toggle.locator('[data-part="switch-control"]');
      expect(await control.isChecked()).toBe(false);
      expect(await control.isDisabled()).toBe(false);
      // No status fact and no Push action for a row that was never pushed.
      expect(await page.locator('[data-part="listgroup-fact"]', { hasText: "status" }).count()).toBe(0);
      expect(await page.locator('[data-part="listgroup-action"] button', { hasText: "Push to Railway" }).count()).toBe(
        0,
      );
    },
    { fixture: "status-remote.json" },
  );
});

test("turning the remote toggle on POSTs {enabled:true}", async () => {
  await withBoard(
    async (page) => {
      let body: unknown = null;
      await page.route("**/api/v1/apps/atlas/remote", async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });

      await openDrawer(page, "atlas");
      await remoteToggle(page).locator('[data-part="switch-control"]').click();

      await waitUntil(async () => body !== null);
      expect(body).toEqual({ enabled: true });
    },
    { fixture: "status-remote.json" },
  );
});

test("a live row's drawer reflects remote.status and its Push action POSTs to /push", async () => {
  await withBoard(
    async (page) => {
      let pushed = false;
      await page.route("**/api/v1/apps/railwayapp/push", async (route) => {
        pushed = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });

      await openDrawer(page, "railwayapp");
      const toggle = remoteToggle(page);
      expect(await toggle.locator('[data-part="switch-control"]').isChecked()).toBe(true);
      const status = page
        .locator('[data-part="listgroup-fact"]')
        .filter({ has: page.locator('[data-part="listgroup-label"]', { hasText: "status" }) });
      expect(await status.locator('[data-part="listgroup-value"]').textContent()).toBe("live");

      const push = page.locator('[data-part="listgroup-action"] button', { hasText: "Push to Railway" });
      expect(await push.count()).toBe(1);
      expect(await push.isDisabled()).toBe(false);
      await push.click();

      await waitUntil(async () => pushed);
    },
    { fixture: "status-remote.json" },
  );
});

test("a password-only row (no sign-in gate) has its Remote toggle disabled with a tooltip", async () => {
  await withBoard(
    async (page) => {
      await openDrawer(page, "gatedapp");
      const control = remoteToggle(page).locator('[data-part="switch-control"]');
      expect(await control.isDisabled()).toBe(true);
      expect(await remoteToggle(page).locator('[data-tip]').count()).toBe(1);
    },
    { fixture: "status-remote.json" },
  );
});

// The defining case for the "disable only when about to turn ON" refinement:
// a row already remote, password-only, no sign-in gate -- the same gate as
// gatedapp above, but with remote already live. The toggle must stay enabled
// (no disabled attr, no tooltip) so the OFF path is never blocked; the
// server's own refuse check only gates `{enabled:true}` (server.remote.test.ts).
test("an already-remote password-only row keeps its Remote toggle enabled, so it can still be turned off", async () => {
  await withBoard(
    async (page) => {
      await openDrawer(page, "lockedout");
      const toggle = remoteToggle(page);
      const control = toggle.locator('[data-part="switch-control"]');
      expect(await control.isChecked()).toBe(true);
      expect(await control.isDisabled()).toBe(false);
      expect(await toggle.locator('[data-tip]').count()).toBe(0);
    },
    { fixture: "status-remote.json" },
  );
});
