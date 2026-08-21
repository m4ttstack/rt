// bun:test's `expect` has no Playwright-locator matchers -- see board.spec.ts's
// header comment for why assertions here read Locator/Page API values
// directly and compare with bun's expect, and browser-side waits use
// page.waitForFunction (which polls in-browser) rather than expect.poll.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard } from "./rig.ts";
import fixture from "../fixture/status.json" with { type: "json" };

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({ has: page.locator("strong", { hasText: name }) });
}

interface PreflightIssue {
  code: string;
  message: string;
  fix?: string;
}

/** A status payload identical to the fixture except orbit is opted in
    (preflight is probed only for opted-in apps -- core/preflight.ts) with
    the given preflight result. Routed in place of GET /api/v1/status so the
    refresh() that onPublicFollows triggers picks it up immediately, rather
    than waiting out the real REFRESH_MS poll. */
function statusWithOrbitPreflight(preflight: PreflightIssue[]): unknown {
  const next = structuredClone(fixture) as { apps: Array<{ name: string; publicFollowsOverride: boolean; preflight: PreflightIssue[] | null }> };
  const orbit = next.apps.find((a) => a.name === "orbit");
  if (!orbit) throw new Error("fixture missing the orbit row");
  orbit.publicFollowsOverride = true;
  orbit.preflight = preflight;
  return next;
}

async function poll(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!check()) throw new Error("poll() timed out waiting for condition");
}

test("port button opens inline edit with a focused, numeric TextField", async () => {
  await withBoard(async (page) => {
    const atlasRow = rowFor(page, "atlas");
    await atlasRow.locator('[aria-label="change development port"]').click();

    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "development port",
    );
    const input = atlasRow.locator('[aria-label="development port"]');
    expect(await input.getAttribute("inputmode")).toBe("numeric");
  });
});

test("Enter with a value PUTs the override; Enter empty cancels with no request", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    let putCount = 0;
    await page.route("**/api/v1/apps/atlas/override", async (route) => {
      putCount++;
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const atlasRow = rowFor(page, "atlas");

    // Enter on an empty input cancels -- no request.
    await atlasRow.locator('[aria-label="change development port"]').click();
    await atlasRow.locator('[aria-label="development port"]').press("Enter");
    expect(putCount).toBe(0);
    expect(await atlasRow.locator('[aria-label="development port"]').count()).toBe(0);

    // Enter with a value submits.
    await atlasRow.locator('[aria-label="change development port"]').click();
    await atlasRow.locator('[aria-label="development port"]').fill("4001");
    await atlasRow.locator('[aria-label="development port"]').press("Enter");
    await poll(() => putCount > 0);
    expect(putBody).toEqual({ devPort: 4001 });
  });
});

test("Escape cancels the edit with no request", async () => {
  await withBoard(async (page) => {
    let putCount = 0;
    await page.route("**/api/v1/apps/atlas/override", async (route) => {
      putCount++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const atlasRow = rowFor(page, "atlas");
    await atlasRow.locator('[aria-label="change development port"]').click();
    await atlasRow.locator('[aria-label="development port"]').fill("4001");
    await atlasRow.locator('[aria-label="development port"]').press("Escape");

    expect(await atlasRow.locator('[aria-label="development port"]').count()).toBe(0);
    expect(putCount).toBe(0);
  });
});

test("blur cancels the edit with no request", async () => {
  await withBoard(async (page) => {
    let putCount = 0;
    await page.route("**/api/v1/apps/atlas/override", async (route) => {
      putCount++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const atlasRow = rowFor(page, "atlas");
    await atlasRow.locator('[aria-label="change development port"]').click();
    await atlasRow.locator('[aria-label="development port"]').fill("4001");
    // Click a non-interactive element: the browser blurs the focused input.
    await page.locator(".board-subline").click();

    expect(await atlasRow.locator('[aria-label="development port"]').count()).toBe(0);
    expect(putCount).toBe(0);
  });
});

test("override row: no struck base port at rest, dev chip carries it in its title", async () => {
  await withBoard(async (page) => {
    const orbitRow = rowFor(page, "orbit");
    expect(await orbitRow.locator("s").count()).toBe(0);

    const chip = orbitRow.locator('[data-part="chip"]', { hasText: "dev" });
    expect(await chip.getAttribute("title")).toBe("dev port override, normally 11007");

    const portButton = orbitRow.locator('[aria-label="change development port"]');
    expect(await portButton.textContent()).toContain("3007");
  });
});

test("hover reveals the revert button and public-too switch; revert clears the override", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/orbit/override", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const orbitRow = rowFor(page, "orbit");
    const revertButton = orbitRow.locator('[aria-label="revert to 11007"]');
    const publicSwitch = orbitRow.locator('.devport-public [data-part="switch-control"]');
    // opacity/pointer-events live on the wrapping .devport-extra, not the
    // button itself -- CSS opacity does not propagate into a descendant's
    // own computed style.
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".devport-extra")!).opacity === "0",
    );

    await orbitRow.hover();
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".devport-extra")!).opacity === "1",
    );
    expect(await publicSwitch.getAttribute("aria-label")).toBe("serve orbit dev port publicly");

    await revertButton.click();
    await poll(() => putBody !== null);
    expect(putBody).toEqual({ devPort: null });
  });
});

test("public-too switch carries parity aria-label/title and PUTs public-follows-override", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/orbit/public-follows-override", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const orbitRow = rowFor(page, "orbit");
    const publicSwitch = orbitRow.locator('.devport-public [data-part="switch-control"]');
    const label = orbitRow.locator('.devport-public');

    expect(await publicSwitch.getAttribute("aria-label")).toBe("serve orbit dev port publicly");
    expect(await label.getAttribute("title")).toBe(
      "the public URL serves 11007 — click to serve the dev port instead",
    );

    await orbitRow.hover();
    await publicSwitch.click();
    await poll(() => putBody !== null);
    expect(putBody).toEqual({ follows: true });
  });
});

test("preflight warn badge + fix code render once opted in and an issue comes back", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/orbit/public-follows-override", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    const body = statusWithOrbitPreflight([
      {
        code: "host-blocked",
        message: "The dev server refuses requests for orbit.mattstack.",
        fix: "Add server.allowedHosts: ['orbit.mattstack'] to the dev server config.",
      },
    ]);
    await page.route("**/api/v1/status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    const orbitRow = rowFor(page, "orbit");
    await orbitRow.hover();
    await orbitRow.locator('.devport-public [data-part="switch-control"]').click();

    const warnBadge = orbitRow.locator('[data-part="badge"]', {
      hasText: "The dev server refuses requests for orbit.mattstack.",
    });
    await warnBadge.waitFor({ state: "visible" });
    const fix = orbitRow.locator("code", { hasText: "server.allowedHosts" });
    expect(await fix.textContent()).toBe("Add server.allowedHosts: ['orbit.mattstack'] to the dev server config.");
  });
});

test("live-publicly success badge renders once opted in with a clean preflight", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/orbit/public-follows-override", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    const body = statusWithOrbitPreflight([]);
    await page.route("**/api/v1/status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    const orbitRow = rowFor(page, "orbit");
    await orbitRow.hover();
    await orbitRow.locator('.devport-public [data-part="switch-control"]').click();

    const successBadge = orbitRow.locator('[data-part="badge"]', { hasText: "live publicly" });
    await successBadge.waitFor({ state: "visible" });
    expect(await successBadge.getAttribute("title")).toBe(
      "the dev server accepts the public hostname and its hot reload reaches the tunnel",
    );
  });
});

test("self row (forecast) is never editable: plain port text, no button", async () => {
  await withBoard(async (page) => {
    const forecastRow = rowFor(page, "forecast");
    expect(await forecastRow.locator('[aria-label="change development port"]').count()).toBe(0);

    const portCell = forecastRow.locator('[data-part="table-cell"]').nth(1);
    expect((await portCell.textContent())?.trim()).toBe("11003");
  });
});
