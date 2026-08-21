// bun:test's `expect` has no Playwright-locator matchers -- see board.spec.ts's
// header comment for why assertions here read Locator/Page API values
// directly and compare with bun's expect.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard } from "./rig.ts";
import fixture from "../fixture/status.json" with { type: "json" };

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({ has: page.locator("strong", { hasText: name }) });
}

async function openAccess(page: Page, name: string) {
  await rowFor(page, name).locator(`[aria-label*="change access"]`).click();
  const modal = page.locator('[data-part="modal"]');
  await modal.waitFor({ state: "visible" });
  return modal;
}

async function poll(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!check()) throw new Error("poll() timed out waiting for condition");
}

/** A status payload identical to the fixture except forecast is published
    with no public URL yet -- the one header variant the shared fixture
    doesn't carry (every published row in it already has a publicUrl). */
function statusWithForecastUnbound(): unknown {
  const next = structuredClone(fixture) as { apps: Array<{ name: string; publicUrl: string | null }> };
  const forecast = next.apps.find((a) => a.name === "forecast");
  if (!forecast) throw new Error("fixture missing the forecast row");
  forecast.publicUrl = null;
  return next;
}

test("access button opens a modal titled Access · <name>; published-with-url header line", async () => {
  await withBoard(async (page) => {
    const summaryButton = rowFor(page, "atlas").locator('[aria-label$=", change access"]');
    const expectedLabel = await summaryButton.getAttribute("aria-label");
    expect(expectedLabel).toEndWith(", change access");

    const modal = await openAccess(page, "atlas");
    expect(await modal.locator('[data-part="modal-title"]').textContent()).toBe("Access · atlas");
    expect(await modal.getByText("Published at https://atlas.mattstack").count()).toBe(1);
  });
});

test("unpublished header line reads 'Not published. These gates apply once it is.'", async () => {
  await withBoard(async (page) => {
    const modal = await openAccess(page, "ledger");
    expect(await modal.getByText("Not published. These gates apply once it is.").count()).toBe(1);
  });
});

test("published-without-url header line", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusWithForecastUnbound()),
      });
    });
    // Reload rather than wait out REFRESH_MS: a fresh navigation re-fetches
    // /api/v1/status, which the route above now intercepts.
    await page.reload();
    await page.waitForSelector("[data-board-ready]");
    const modal = await openAccess(page, "forecast");
    expect(
      await modal.getByText("Published, but no public URL yet: bind a domain to reach it from outside.").count(),
    ).toBe(1);
  });
});

test("password: switch ON with no password reveals the field + a Set button disabled until typed", async () => {
  await withBoard(async (page) => {
    const modal = await openAccess(page, "forecast"); // hasPassword: false in the fixture
    const pwSwitch = modal.locator('[aria-label="require a password"]');
    expect(await pwSwitch.count()).toBe(1);

    await pwSwitch.click();
    const field = modal.locator('[aria-label="new password"]');
    await field.waitFor({ state: "visible" });
    const setButton = modal.getByRole("button", { name: "Set", exact: true });
    expect(await setButton.isDisabled()).toBe(true);

    await field.fill("s3cret");
    expect(await setButton.isDisabled()).toBe(false);
  });
});

test("Set PUTs the password; hint shows only once hasPassword; Change PUTs null on switch-off", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/forecast/password", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const modal = await openAccess(page, "forecast");
    expect(await modal.getByText("A password is set. Changing it signs out anyone holding a session.").count()).toBe(0);

    await modal.locator('[aria-label="require a password"]').click();
    await modal.locator('[aria-label="new password"]').fill("s3cret");
    await modal.getByRole("button", { name: "Set", exact: true }).click();

    await poll(() => putBody !== null);
    expect(putBody).toEqual({ password: "s3cret" });
  });
});

test("hint 'Changing it signs out anyone holding a session.' shown when hasPassword; Change removes on switch-off", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/atlas/password", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const modal = await openAccess(page, "atlas"); // hasPassword: true in the fixture
    expect(await modal.getByText("A password is set. Changing it signs out anyone holding a session.").count()).toBe(1);

    const pwSwitch = modal.locator('[aria-label="remove the password"]');
    await pwSwitch.click();

    await poll(() => putBody !== null);
    expect(putBody).toEqual({ password: null });
  });
});

test("failed switch-off leaves the Switch checked (controlled-Switch parity case)", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/atlas/password", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    });

    const modal = await openAccess(page, "atlas");
    const pwSwitch = modal.locator('[data-part="switch-control"]').first();
    expect(await pwSwitch.isChecked()).toBe(true);

    await modal.locator('[aria-label="remove the password"]').click();
    const error = modal.locator('[data-part="alert"]');
    await error.waitFor({ state: "visible" }); // failed request has settled once this appears
    expect(await pwSwitch.isChecked()).toBe(true);
    expect(await error.textContent()).toContain("removing the password failed.");
  });
});

test("oauth: switch reveals radios + textarea + hint; mode flip clears the list; Apply disabled on empty", async () => {
  await withBoard(async (page) => {
    const modal = await openAccess(page, "forecast"); // oauth off in the fixture -> opens on "emails"
    const oauthSwitch = modal.locator('[aria-label="require google sign-in"]');
    await oauthSwitch.click();

    expect(await modal.getByText("Anyone at these domains").count()).toBe(1);
    expect(await modal.getByText("These people").count()).toBe(1);
    expect(await modal.getByText("One per line. Commas work too.").count()).toBe(1);

    const applyButton = modal.getByRole("button", { name: "Apply", exact: true });
    expect(await applyButton.isDisabled()).toBe(true);

    // "off" opens on the emails mode: label + placeholder.
    expect(await modal.getByText("Allowed emails", { exact: true }).count()).toBe(1);
    const list = modal.locator('[data-part="field-input"]').last();
    await list.fill("a@x.dev");
    expect(await applyButton.isDisabled()).toBe(false);

    // Flipping to "Anyone at these domains" clears the list and re-disables Apply.
    await modal.getByText("Anyone at these domains").click();
    expect(await modal.getByText("Allowed domains", { exact: true }).count()).toBe(1);
    expect(await list.inputValue()).toBe("");
    expect(await applyButton.isDisabled()).toBe(true);
  });
});

test("Apply PUTs mode/emails with splitList applied", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/forecast/access", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cfSynced: true }) });
    });

    const modal = await openAccess(page, "forecast"); // "off" -> opens on the emails mode already
    await modal.locator('[aria-label="require google sign-in"]').click();
    const list = modal.locator('[data-part="field-input"]').last();
    await list.fill("a@x.dev, b@y.dev\nc@z.dev");
    await modal.getByRole("button", { name: "Apply", exact: true }).click();

    await poll(() => putBody !== null);
    expect(putBody).toEqual({ mode: "emails", emails: ["a@x.dev", "b@y.dev", "c@z.dev"] });
  });
});

test("cfSynced:false on turn-off renders the Cloudflare-not-updated warning Alert", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/atlas/access", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, cfSynced: false }),
      });
    });

    const modal = await openAccess(page, "atlas"); // oauth mode: emails in the fixture
    const oauthSwitch = modal.locator('[aria-label="turn google sign-in off"]');
    await oauthSwitch.click();

    const alert = modal.locator('[data-part="alert"]');
    await alert.waitFor({ state: "visible" });
    expect(await alert.textContent()).toContain(
      "sign-in is off here, but Cloudflare was not updated, so visitors may still be asked to sign in.",
    );
    expect(await oauthSwitch.count()).toBe(0); // relabeled to "require google sign-in" now that it's off
  });
});

test("footer Done closes the modal", async () => {
  await withBoard(async (page) => {
    const modal = await openAccess(page, "atlas");
    await modal.getByRole("button", { name: "Done" }).click();
    expect(await page.locator('[data-part="modal"]').count()).toBe(0);
  });
});
