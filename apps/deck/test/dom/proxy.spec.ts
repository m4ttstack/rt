// bun:test's `expect` has no Playwright-locator matchers -- see board.spec.ts's
// header comment for why assertions here read Locator/Page API values
// directly and compare with bun's expect, and browser-side waits use
// page.waitForFunction rather than expect.poll.
import { test, expect } from "bun:test";
import { withBoard } from "./rig.ts";

async function poll(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!check()) throw new Error("poll() timed out waiting for condition");
}

test("a stale-proxy fixture renders the automatic bad Alert with the stale-routes copy", async () => {
  await withBoard(
    async (page) => {
      const alert = page.locator('[data-part="alert"]');
      await alert.waitFor({ state: "visible" });
      expect(await alert.getAttribute("data-intent")).toBe("bad");
      expect(await alert.textContent()).toContain(
        ".localhost routes are stale. The proxy stopped following routes.json, " +
          "so overrides and renumbered apps are not reaching it. Click reload proxy to resync.",
      );
    },
    { fixture: "status-stale.json" },
  );
});

test("reload proxy: click POSTs to /api/v1/proxy/restart; while waiting the button shows a Spinner, 'restarting…', and is disabled", async () => {
  await withBoard(async (page) => {
    let restartRequested = false;
    await page.route("**/api/v1/proxy/restart", async (route) => {
      restartRequested = true;
      // Never resolves -- the assertions below happen mid-flight; the
      // pending route is torn down when withBoard closes the context.
      await new Promise(() => {});
    });

    await page.locator('button:has-text("reload proxy")').click();
    await poll(() => restartRequested);

    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("restarting…")),
    );

    const button = page.locator('button[aria-busy="true"]');
    expect(await button.count()).toBe(1);
    expect(await button.isDisabled()).toBe(true);
    expect(await button.locator('[data-part="spinner"]').count()).toBe(1);
    expect(await button.textContent()).toContain("restarting…");
  });
});

test("not-authorized restart shows the one-time-setup Alert with the install command in the command block", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/proxy/restart", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "not-authorized",
          installCommand: "sudo portless install-rule --allow-restart",
        }),
      });
    });

    await page.locator('button:has-text("reload proxy")').click();

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-part="alert"]');
      return !!el && (el.textContent ?? "").includes("One-time setup");
    });

    const alert = page.locator('[data-part="alert"]');
    expect(await alert.getAttribute("data-intent")).toBe("bad");
    expect(await alert.textContent()).toContain(
      "One-time setup: the board isn't allowed to restart the proxy yet. " +
        "Run this in a terminal (it validates the rule before activating it), then try again:",
    );
    expect(await alert.locator('[data-part="alert-command"]').textContent()).toBe(
      "sudo portless install-rule --allow-restart",
    );
  });
});

test(
  "successful reload waits out one /healthz drop then shows the ok notice",
  async () => {
    await withBoard(async (page) => {
      let healthzCalls = 0;
      await page.route("**/healthz", async (route) => {
        healthzCalls++;
        // waitForProxy only returns once it has seen a drop and then a
        // recovery, so the first probe must fail before the second succeeds.
        if (healthzCalls === 1) {
          await route.fulfill({ status: 503, body: "down" });
        } else {
          await route.fulfill({ status: 200, body: "ok" });
        }
      });
      await page.route("**/api/v1/proxy/restart", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });

      await page.locator('button:has-text("reload proxy")').click();

      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-part="alert"]');
          return !!el && (el.textContent ?? "").includes("portless proxy restarted");
        },
        undefined,
        { timeout: 8000 },
      );

      const alert = page.locator('[data-part="alert"]');
      expect(await alert.getAttribute("data-intent")).toBe("ok");
      expect(await alert.textContent()).toContain(
        "portless proxy restarted — .localhost now serves the current routes.",
      );
      expect(healthzCalls).toBeGreaterThanOrEqual(2);
    });
  },
  10000,
);

test(
  "the explicit ok notice outranks the automatic stale-proxy banner until its hold expires",
  async () => {
    await withBoard(async (page) => {
      let statusCalls = 0;
      await page.route("**/api/v1/status", async (route) => {
        statusCalls++;
        const body = await route.fetch();
        const json = (await body.json()) as { proxyStale: boolean };
        json.proxyStale = true;
        await route.fulfill({ response: body, json });
      });
      await page.route("**/api/v1/proxy/restart", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });
      // One failure then ok: waitForProxy only returns once it has seen a
      // drop and then a recovery -- an unbroken run of ok responses instead
      // falls through to its own 15s fallback and blows the test budget.
      let healthzCalls = 0;
      await page.route("**/healthz", async (route) => {
        healthzCalls++;
        await route.fulfill({ status: healthzCalls === 1 ? 503 : 200, body: healthzCalls === 1 ? "down" : "ok" });
      });

      await page.locator('button:has-text("reload proxy")').click();

      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-part="alert"]');
          return !!el && (el.textContent ?? "").includes("portless proxy restarted");
        },
        undefined,
        { timeout: 8000 },
      );

      const alert = page.locator('[data-part="alert"]');
      expect(await alert.getAttribute("data-intent")).toBe("ok");

      // Let at least one more automatic refresh (REFRESH_MS) land, every one
      // of which reports proxyStale: true.
      const callsAtNotice = statusCalls;
      await poll(() => statusCalls > callsAtNotice, 8000);

      // The explicit ok notice must still be showing -- its 30s hold has not
      // expired, so the stale-proxy autoBanner must not have overwritten it.
      expect(await alert.getAttribute("data-intent")).toBe("ok");
      expect(await alert.textContent()).toContain("portless proxy restarted");
    });
  },
  15000,
);
