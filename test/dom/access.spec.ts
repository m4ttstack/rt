// Access lives in the drawer now (drawer-states-atlas.html "3 · Access") --
// AccessModal is retired. atlas carries a password + oauth emails mode (2
// entries) in the fixture; forecast/ledger/orbit carry neither.
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

async function openAccess(page: Page, name: string): Promise<void> {
  await openDrawer(page, name);
  await page
    .locator('[data-part="listgroup-nav"]')
    .filter({ has: page.locator('[data-part="listgroup-label"]', { hasText: "access" }) })
    .locator("button")
    .click();
  await page.waitForSelector('[data-part="drawer-title"]', { hasText: "access" });
}

function accessNav(page: Page, label: string) {
  return page
    .locator('[data-part="listgroup-nav"]')
    .filter({ has: page.locator('[data-part="listgroup-label"]', { hasText: label }) });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitUntil() timed out");
}

test("access glyph cell is gone from the table", async () => {
  await withBoard(async (page) => {
    expect(await page.locator('[aria-label$=", change access"]').count()).toBe(0);
    expect(await page.locator("th", { hasText: "access" }).count()).toBe(0);
  });
});

test("AccessModal is gone: no Access · <name> modal is reachable", async () => {
  await withBoard(async (page) => {
    await openAccess(page, "atlas");
    expect(await page.locator('[aria-label^="Access ·"]').count()).toBe(0);
    expect(await page.locator('[data-part="modal"]').count()).toBe(0);
  });
});

test("root: password value set/not set, sign-in toggle, who hidden until sign-in is on", async () => {
  await withBoard(async (page) => {
    await openAccess(page, "atlas"); // hasPassword true, oauth emails x2 in the fixture
    expect(await accessNav(page, "password").locator('[data-part="listgroup-value"]').textContent()).toBe("set");
    const toggle = page.locator('[data-part="listgroup-toggle"] [data-part="switch-control"]');
    expect(await toggle.isChecked()).toBe(true);
    expect(await accessNav(page, "who").locator('[data-part="listgroup-value"]').textContent()).toBe("2 people");

    await page.locator('[data-part="drawer-close"]').click();
    await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached" });

    await openAccess(page, "forecast"); // no password, oauth off in the fixture
    expect(await accessNav(page, "password").locator('[data-part="listgroup-value"]').textContent()).toBe(
      "not set",
    );
    expect(await page.locator('[data-part="listgroup-toggle"] [data-part="switch-control"]').isChecked()).toBe(
      false,
    );
    expect(await accessNav(page, "who").count()).toBe(0);
    expect(
      await page.locator('[data-part="listgroup-footer"]', {
        hasText: "forecast is open — anyone who can reach the tunnel gets in",
      }).count(),
    ).toBe(1);
  });
});

test("password: set flow -- input + nav save PUTs the password, then the root hint reads 'set'", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/forecast/password", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let saved = false;
    await page.route("**/api/v1/status", async (route) => {
      if (!saved) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      const forecast = next.apps.find((a) => a.name === "forecast");
      if (!forecast) throw new Error("fixture missing forecast");
      forecast.hasPassword = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
    });

    await openAccess(page, "forecast");
    await accessNav(page, "password").locator("button").click();
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("password");
    expect(await page.locator('[data-part="drawer-back"]').textContent()).toBe("‹ access");

    const navAction = page.locator('[data-part="drawer-navaction"]');
    expect((await navAction.textContent())?.trim()).toBe("save");
    expect(await navAction.isDisabled()).toBe(true);

    const input = page.locator('[aria-label="new password"]');
    await input.fill("s3cret");
    expect(await navAction.isDisabled()).toBe(false);
    saved = true;
    await navAction.click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ password: "s3cret" });

    await page.waitForSelector('[data-part="drawer-title"]', { hasText: "access" });
    await waitUntil(
      async () => (await accessNav(page, "password").locator('[data-part="listgroup-value"]').textContent()) === "set",
    );
  });
});

test("password: remove -- no confirm, PUTs password:null immediately", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/atlas/password", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let removed = false;
    await page.route("**/api/v1/status", async (route) => {
      if (!removed) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      const atlas = next.apps.find((a) => a.name === "atlas");
      if (!atlas) throw new Error("fixture missing atlas");
      atlas.hasPassword = false;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
    });

    await openAccess(page, "atlas"); // hasPassword true in the fixture
    await accessNav(page, "password").locator("button").click();

    const danger = page.locator('button[data-intent="bad"]', { hasText: "remove password" });
    expect(await danger.count()).toBe(1);
    removed = true;
    await danger.click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ password: null });

    await waitUntil(async () => (await danger.count()) === 0); // hasPassword false -> the row disappears
  });
});

test("password: a failed save renders the Alert inside the password screen", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/forecast/password", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    });

    await openAccess(page, "forecast");
    await accessNav(page, "password").locator("button").click();
    await page.locator('[aria-label="new password"]').fill("s3cret");
    await page.locator('[data-part="drawer-navaction"]').click();

    const alert = page.locator('[data-part="alert"]');
    await alert.waitFor({ state: "visible" });
    expect(await alert.textContent()).toContain("saving the password failed, the board did not answer.");
    // A failed save does not navigate away.
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("password");
  });
});

test("who: mode switch clears entries; entries add/remove; save disabled on empty", async () => {
  await withBoard(async (page) => {
    await openAccess(page, "forecast"); // oauth off -> opens on "these people" (emails)
    await page.locator('[data-part="listgroup-toggle"] [data-part="switch-control"]').click();
    await accessNav(page, "who").locator("button").click();
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("who");

    const navAction = page.locator('[data-part="drawer-navaction"]');
    expect(await navAction.isDisabled()).toBe(true);

    const draft = page.getByRole("textbox", { name: "add email" });
    await draft.fill("a@x.dev");
    await draft.press("Enter");
    expect(await page.locator('[aria-label="remove a@x.dev"]').count()).toBe(1);
    expect(await navAction.isDisabled()).toBe(false);
    expect(await draft.inputValue()).toBe("");

    // Flipping mode clears the entries and re-disables save.
    await page.locator('[role="radio"]', { hasText: "anyone at these domains" }).click();
    expect(await page.locator('[aria-label="remove a@x.dev"]').count()).toBe(0);
    expect(await navAction.isDisabled()).toBe(true);
    expect(await page.getByRole("textbox", { name: "add domain" }).count()).toBe(1);

    await page.getByRole("textbox", { name: "add domain" }).fill("corp.co");
    await page.locator('[aria-label="add domain"]').press("Enter");
    expect(await page.locator('[aria-label="remove corp.co"]').count()).toBe(1);

    await page.locator('[aria-label="remove corp.co"]').click();
    expect(await page.locator('[aria-label="remove corp.co"]').count()).toBe(0);
    expect(await navAction.isDisabled()).toBe(true);
  });
});

test("who: save PUTs mode + the composed entries, then returns to the access root", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/forecast/access", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cfSynced: true }) });
    });

    await openAccess(page, "forecast");
    await page.locator('[data-part="listgroup-toggle"] [data-part="switch-control"]').click();
    await accessNav(page, "who").locator("button").click();

    const draft = page.getByRole("textbox", { name: "add email" });
    await draft.fill("a@x.dev");
    await draft.press("Enter");
    await draft.fill("b@y.dev");
    await draft.press("Enter");

    await page.locator('[data-part="drawer-navaction"]').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ mode: "emails", emails: ["a@x.dev", "b@y.dev"] });
    await page.waitForSelector('[data-part="drawer-title"]', { hasText: "access" });
  });
});

test("who: an apply error renders the Alert inside the who screen and does not navigate away", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/forecast/access", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Cloudflare rejected the request" }),
      });
    });

    await openAccess(page, "forecast");
    await page.locator('[data-part="listgroup-toggle"] [data-part="switch-control"]').click();
    await accessNav(page, "who").locator("button").click();

    const draft = page.getByRole("textbox", { name: "add email" });
    await draft.fill("a@x.dev");
    await draft.press("Enter");
    await page.locator('[data-part="drawer-navaction"]').click();

    const alert = page.locator('[data-part="alert"]');
    await alert.waitFor({ state: "visible" });
    expect(await alert.textContent()).toContain("Cloudflare rejected the request");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("who");
  });
});

test("root: a teardown failure on turn-off surfaces here even though the toggle already reads off", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/atlas/access", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, cfSynced: false }),
      });
    });

    await openAccess(page, "atlas"); // oauth on (emails) in the fixture
    const oauthSwitch = page.locator('[aria-label="turn google sign-in off"]');
    await oauthSwitch.click();

    const alert = page.locator('[data-part="alert"]');
    await alert.waitFor({ state: "visible" });
    expect(await alert.textContent()).toContain(
      "sign-in is off here, but Cloudflare was not updated, so visitors may still be asked to sign in.",
    );
    expect(await page.locator('[aria-label="require google sign-in"]').count()).toBe(1); // relabeled, now off
    expect(await accessNav(page, "who").count()).toBe(0);
  });
});
