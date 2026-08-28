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
    expect(await appsTable.locator('[data-part="table-row"]').count()).toBe(4);

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

test("service column shows dim pid N, or exit N as bad-tone text (no pill)", async () => {
  await withBoard(async (page) => {
    const atlasService = rowFor(page, "atlas").locator('[data-part="table-cell"]').nth(3);
    expect(await atlasService.textContent()).toBe("pid 5123");

    const ledgerService = rowFor(page, "ledger").locator('[data-part="table-cell"]').nth(3);
    expect(await ledgerService.textContent()).toBe("exit 1");
    // Plain text, not a Badge -- pills are reserved for the health column.
    expect(await ledgerService.locator('[data-part="badge"]').count()).toBe(0);

    const exitColor = await ledgerService.locator(".t-bad").evaluate((el) => getComputedStyle(el).color);
    const redProbe = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--red)";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(exitColor).toBe(redProbe);
  });
});

test("leading health dot: ok tone for a healthy row, bad tone for an unreachable one", async () => {
  await withBoard(async (page) => {
    // Computed colour against a same-token probe, not the emitted style
    // text -- the --sd-color custom property is StatusDot's own internal
    // wiring, not a contract this app should assert the literal form of.
    const dotColor = (rowName: string) =>
      rowFor(page, rowName).locator('[data-part="statusdot-dot"]').evaluate((el) => getComputedStyle(el).color);
    const probeColor = (token: string) =>
      page.evaluate((t) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${t})`;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      }, token);

    expect(await dotColor("atlas")).toBe(await probeColor("--dot-ok"));
    expect(await dotColor("ledger")).toBe(await probeColor("--dot-bad"));
  });
});

test("restart button is visible without hovering the row", async () => {
  await withBoard(async (page) => {
    const restart = rowFor(page, "atlas").locator('[aria-label="restart atlas"]');
    expect(await restart.isVisible()).toBe(true);
  });
});

test("every row carries a focusable chevron with a details aria-label", async () => {
  await withBoard(async (page) => {
    const appsTable = page.locator("table").first();
    expect(await appsTable.locator('[data-part="row-chevron"]').count()).toBe(4);

    const atlasChevron = rowFor(page, "atlas").locator('[data-part="row-chevron"]');
    expect(await atlasChevron.getAttribute("aria-label")).toBe("details for atlas");

    await atlasChevron.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-part"))).toBe("row-chevron");
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

test("subline: healthy fraction renders in bad tone when an app is down (3/4 fixture)", async () => {
  await withBoard(async (page) => {
    const fraction = page.locator(".board-subline .t-bad", { hasText: "healthy" });
    expect(await fraction.textContent()).toBe("3/4 healthy");

    const fractionColor = await fraction.evaluate((el) => getComputedStyle(el).color);
    const redProbe = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--red)";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(fractionColor).toBe(redProbe);
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
    const spinner = healthCell.locator('[data-part="spinner"]');
    expect(await spinner.count()).toBe(1);
    // Computed `animation-name` is the specified ident even when no matching
    // `@keyframes` exists (the ring then sits on frame zero). Walk the sheets
    // so a hash-mismatch (Bun CSS modules vs. the kit Spinner) fails this.
    const keyframes = await spinner.evaluate((el) => {
      const name = getComputedStyle(el).animationName;
      if (!name || name === "none") return { name, found: false };
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule instanceof CSSKeyframesRule && rule.name === name) return true;
          if ("cssRules" in rule && rule.cssRules && walk(rule.cssRules)) return true;
        }
        return false;
      };
      for (const sheet of document.styleSheets) {
        try {
          if (walk(sheet.cssRules)) return { name, found: true };
        } catch {
          /* opaque sheet */
        }
      }
      return { name, found: false };
    });
    expect(keyframes.found).toBe(true);
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

test("public switch flips optimistically before the PUT resolves, and reverts when the server never confirms", async () => {
  await withBoard(async (page) => {
    // ledger is unpublished in the fixture; hold the PUT open long enough to
    // observe the optimistic state, then let the poll (still serving the
    // unchanged fixture) act as the server refusing to confirm.
    let releasePut: () => void = () => {};
    const putHeld = new Promise<void>((r) => (releasePut = r));
    await page.route("**/api/v1/apps/ledger/publish", async (route) => {
      await putHeld;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    const sw = rowFor(page, "ledger").locator('[role="switch"]');
    expect(await sw.isChecked()).toBe(false);
    await sw.click();
    // Optimistic: shown state flips while the request is still in flight.
    await poll(() => true, 50);
    expect(await sw.isChecked()).toBe(true);
    releasePut();
    // Canonical hand-off: the refresh returns the unchanged fixture, so the
    // switch snaps back instead of lying about the server's state.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && (await sw.isChecked())) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await sw.isChecked()).toBe(false);
  });
});
