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

async function openDevPort(page: Page, name: string): Promise<void> {
  await openDrawer(page, name);
  await page.locator('[data-part="listgroup-nav"] button', { hasText: "dev port" }).click();
}

/** Polls an async condition -- the dev-port mutation tests intercept a
    request or swap the fixture's GET /status response, and the assertion
    has to wait for the resulting re-render rather than racing it. */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitUntil() timed out");
}

function devPortNav(page: Page) {
  return page
    .locator('[data-part="listgroup-nav"]')
    .filter({ has: page.locator('[data-part="listgroup-label"]', { hasText: "dev port" }) });
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

test("the service-without-route root's status strip keeps the 'no route' suffix (no health to gate it on)", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "stray-agent");
    const status = page.locator('[data-part="sidedrawer"] .drawer-status');
    expect(await status.textContent()).toContain("stopped · exit 1 · no route");
  });
});

test("a restarting drawer row shows the busy state per the atlas: spinner + \"restarting…\", trigger label gone", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/atlas/restart", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );
    await openDrawer(page, "atlas");
    await page.locator('[data-part="listgroup-action"] button', { hasText: "restart service" }).click();

    const busyButton = page.locator('[data-part="listgroup-action"] button[aria-busy="true"]');
    await busyButton.waitFor({ state: "visible" });
    expect((await busyButton.textContent())?.trim()).toBe("restarting…");
    expect(await busyButton.locator('[data-part="spinner"]').count()).toBe(1);
    expect(await busyButton.locator('[data-part="icon"]').count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dev port screens (drawer-states-atlas.html "2 · Dev port"). orbit carries a
// live override (3007, base 11007) in the fixture; atlas has none.
// ---------------------------------------------------------------------------

test("dev port: override-active screen shows assigned + override facts and the atlas footer copy", async () => {
  await withBoard(async (page) => {
    await openDevPort(page, "orbit");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("dev port");
    expect(await page.locator('[data-part="drawer-back"]').textContent()).toBe("‹ orbit");

    const facts = page.locator('[data-part="listgroup-fact"]');
    expect(await facts.count()).toBe(2);
    expect(await facts.nth(0).locator('[data-part="listgroup-label"]').textContent()).toBe("assigned port");
    expect(await facts.nth(0).locator('[data-part="listgroup-value"]').textContent()).toBe("11007");
    expect(await facts.nth(1).locator('[data-part="listgroup-label"]').textContent()).toBe("override");
    expect(await facts.nth(1).locator('[data-part="listgroup-value"]').textContent()).toBe("3007");

    const footers = page.locator('[data-part="listgroup-footer"]');
    expect(await footers.nth(0).textContent()).toBe(
      "the proxy routes orbit.localhost to 3007 while the override is set",
    );
    // orbit's publicFollowsOverride is false in the fixture -- the off copy.
    expect(await footers.nth(1).textContent()).toBe(
      "off: visitors keep getting 11007 while you develop on 3007",
    );

    expect(await page.locator('[data-part="listgroup-action"] button', { hasText: "revert to 11007" }).count()).toBe(
      1,
    );
  });
});

test("dev port: the public-follows-dev toggle calls its mutation", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/orbit/public-follows-override", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await openDevPort(page, "orbit");
    await page.locator('[data-part="listgroup-toggle"] [data-part="switch-control"]').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ follows: true }); // false -> true in the fixture
  });
});

test("dev port: revert calls the override-clear mutation; the screen and the root hint update", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/orbit/override", async (route) => {
      putBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let reverted = false;
    await page.route("**/api/v1/status", async (route) => {
      if (!reverted) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      const orbit = next.apps.find((a) => a.name === "orbit");
      if (!orbit) throw new Error("fixture missing orbit");
      orbit.override = null;
      orbit.port = 11007;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
    });

    await openDevPort(page, "orbit");
    reverted = true;
    await page.locator('[data-part="listgroup-action"] button', { hasText: "revert to 11007" }).click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ devPort: null });

    await waitUntil(
      async () => (await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).count()) === 1,
    );
    expect(await page.locator('[data-part="listgroup-fact"]').count()).toBe(1);
    expect(await page.locator('[data-part="listgroup-footer"]').textContent()).toBe(
      "orbit serves on its assigned port — no override",
    );

    await page.locator('[data-part="drawer-back"]').click();
    expect(await devPortNav(page).locator('[data-part="listgroup-value"]').textContent()).toBe("11007");
  });
});

test("dev port: the board's own row (self) offers no 'set override…' -- no dead-end into the setting screen", async () => {
  await withBoard(async (page) => {
    // forecast is `self` in the fixture and defensively carries an override
    // in the underlying data (applyOverride would reject one in reality) --
    // devPortValue already hides that override on the root's own nav-row
    // hint (see port.spec.ts), and this screen must agree with it.
    await openDevPort(page, "forecast");
    expect(await page.locator('[data-part="listgroup-fact"]').count()).toBe(1);
    expect(await page.locator('[data-part="listgroup-fact"] [data-part="listgroup-value"]').textContent()).toBe(
      "11003",
    );
    expect(await page.locator('[data-part="listgroup-footer"]').textContent()).toBe(
      "deck serves on this port — overrides don't apply to the board itself",
    );
    expect(await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).count()).toBe(
      0,
    );
  });
});

test("dev port: no override shows 'set override…'; editing has the input + nav save; cancel returns without saving", async () => {
  await withBoard(async (page) => {
    let putCalled = false;
    await page.route("**/api/v1/apps/atlas/override", async (route) => {
      putCalled = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await openDevPort(page, "atlas");
    expect(await page.locator('[data-part="listgroup-fact"]').count()).toBe(1);
    expect(await page.locator('[data-part="listgroup-footer"]').textContent()).toBe(
      "atlas serves on its assigned port — no override",
    );

    await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).click();

    // Editing sits directly on root, same as the view it replaced -- the
    // atlas's own back label reads the row name from both.
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("dev port");
    expect(await page.locator('[data-part="drawer-back"]').textContent()).toBe("‹ atlas");

    const navAction = page.locator('[data-part="drawer-navaction"]');
    expect((await navAction.textContent())?.trim()).toBe("save");
    expect(await navAction.isDisabled()).toBe(true);

    const input = page.getByRole("textbox", { name: "dev port override" });
    await input.fill("5173");
    expect(await navAction.isDisabled()).toBe(false);

    await page.locator('[data-part="listgroup-action"] button', { hasText: "cancel" }).click();

    expect(await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).count()).toBe(1);
    expect(putCalled).toBe(false);
  });
});

test("dev port: save PUTs the override, then shows the override-active state; the root hint updates too", async () => {
  await withBoard(async (page) => {
    let putBody: unknown = null;
    await page.route("**/api/v1/apps/atlas/override", async (route) => {
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
      const atlas = next.apps.find((a) => a.name === "atlas");
      if (!atlas) throw new Error("fixture missing atlas");
      atlas.override = { devPort: 5173, basePort: 11001 };
      atlas.port = 5173;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
    });

    await openDevPort(page, "atlas");
    await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).click();
    await page.getByRole("textbox", { name: "dev port override" }).fill("5173");
    saved = true;
    await page.locator('[data-part="drawer-navaction"]').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ devPort: 5173 });

    await waitUntil(
      async () => (await page.locator('[data-part="listgroup-action"] button', { hasText: "revert to 11001" }).count()) === 1,
    );
    expect(await page.locator('[data-part="listgroup-fact"]').count()).toBe(2);

    await page.locator('[data-part="drawer-back"]').click();
    expect(await devPortNav(page).locator('[data-part="listgroup-value"]').textContent()).toBe("5173 · override");
  });
});

test(
  "dev port: the kit back chevron out of the setting screen clears the draft, so refresh() is not frozen behind it",
  async () => {
    await withBoard(async (page) => {
      let statusHits = 0;
      await page.route("**/api/v1/status", async (route) => {
        statusHits++;
        await route.continue();
      });

      await openDevPort(page, "atlas");
      await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).click();
      await page.getByRole("textbox", { name: "dev port override" }).fill("5173");

      const hitsBeforeBack = statusHits;
      // The kit's own nav-bar back chevron, not the screen's "cancel" row --
      // setting sits directly on root (one pushed frame), so this pops
      // straight to it.
      await page.locator('[data-part="drawer-back"]').click();
      expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("atlas");

      // refresh() bails out before ever calling fetch while board.editing is
      // still set (see useBoardState) -- if the kit chevron left it set, no
      // further /status poll would land, ever.
      await waitUntil(async () => statusHits > hitsBeforeBack, 7000);

      // And the setting screen itself starts from an empty draft on
      // reentry, not whatever was typed before leaving.
      await page.locator('[data-part="listgroup-nav"] button', { hasText: "dev port" }).click();
      await page.locator('[data-part="listgroup-action"] button', { hasText: "set override…" }).click();
      expect(await page.getByRole("textbox", { name: "dev port override" }).inputValue()).toBe("");
    });
  },
  12000,
);

// ---------------------------------------------------------------------------
// Edit screen (drawer-states-atlas.html "4 · Logs, edit, remove", edit phone).
// ---------------------------------------------------------------------------

async function openEdit(page: Page, name: string): Promise<void> {
  await openDrawer(page, name);
  await page.locator('[data-part="listgroup-nav"] button', { hasText: "edit app" }).click();
}

test("edit app: a user service row shows name, base port, command and directory, prefilled from the row", async () => {
  await withBoard(async (page) => {
    await openEdit(page, "orbit");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("edit app");
    expect(await page.locator('[data-part="drawer-back"]').textContent()).toBe("‹ orbit");

    const drawer = page.locator('[data-part="sidedrawer"]');
    expect(await drawer.locator('[data-part="field"]').count()).toBe(4);
    expect(await drawer.getByRole("textbox", { name: "name" }).inputValue()).toBe("orbit");
    expect(await drawer.getByRole("textbox", { name: "base port" }).inputValue()).toBe("11007"); // orbit overrides: base 11007, dev 3007
    expect(await drawer.getByRole("textbox", { name: "command" }).inputValue()).toBe("bun run dev");

    const navAction = page.locator('[data-part="drawer-navaction"]');
    expect((await navAction.textContent())?.trim()).toBe("save");
    expect(await navAction.isDisabled()).toBe(false);
  });
});

test("edit app: a managed row offers no edit nav — the resolver owns its shape; source replaces it", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    const drawer = page.locator('[data-part="sidedrawer"]');
    expect(await drawer.locator('[data-part="listgroup-nav"] button', { hasText: "edit app" }).count()).toBe(0);
    expect(await drawer.locator('[data-part="listgroup-nav"] button', { hasText: "source" }).count()).toBe(1);
  });
});

test("source screen: facts, relink, and Unlink PATCHes dev:null", async () => {
  await withBoard(async (page) => {
    let patchBody: unknown = null;
    await page.route("**/api/v1/apps/atlas", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await openDrawer(page, "atlas");
    await page.locator('[data-part="listgroup-nav"] button', { hasText: "source" }).click();
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("source");
    const drawer = page.locator('[data-part="sidedrawer"]');
    expect(await drawer.getByText("/Users/matt/Documents/GitHub/atlas").count()).toBe(1);
    expect(await drawer.getByText("build · deploy").count()).toBe(1);

    await drawer.locator('[data-part="listgroup-action"] button', { hasText: "Unlink" }).click();
    await waitUntil(async () => patchBody !== null);
    expect(patchBody).toEqual({ dev: null });
  });
});

test("edit app: an external row shows only name and base port", async () => {
  await withBoard(
    async (page) => {
      await openEdit(page, "atlas");
      const drawer = page.locator('[data-part="sidedrawer"]');
      expect(await drawer.locator('[data-part="field"]').count()).toBe(2);
      expect(await drawer.getByRole("textbox", { name: "name" }).inputValue()).toBe("orbit");
      expect(await drawer.getByRole("textbox", { name: "base port" }).inputValue()).toBe("11001");
      expect(await drawer.getByText("command", { exact: true }).count()).toBe(0);
      expect(await drawer.getByText("directory", { exact: true }).count()).toBe(0);
    },
    { fixture: "status-external.json" },
  );
});

test("edit app: save PATCHes the edit payload and pops back to root", async () => {
  await withBoard(async (page) => {
    let patchBody: unknown = null;
    await page.route("**/api/v1/apps/orbit", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await openEdit(page, "orbit");
    await page.getByRole("textbox", { name: "base port" }).fill("12345");
    await page.locator('[data-part="drawer-navaction"]').click();

    await waitUntil(async () => patchBody !== null);
    expect(patchBody).toEqual({
      name: "orbit",
      port: 12345,
      command: ["bun", "run", "dev"],
      workingDirectory: "/Users/matt/Documents/GitHub/orbit",
    });

    await waitUntil(async () => (await page.locator('[data-part="drawer-title"]').textContent()) === "orbit");
    expect(await page.locator('[data-part="drawer-back"]').count()).toBe(0);
  });
});

test("edit app: an API validation error renders inline on the name field; the screen stays open", async () => {
  await withBoard(async (page) => {
    await page.route("**/api/v1/apps/orbit", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "name taken" }) });
    });

    await openEdit(page, "orbit");
    await page.locator('[data-part="drawer-navaction"]').click();

    const fieldError = page.locator('[data-part="sidedrawer"] [data-part="field-error"]');
    await fieldError.waitFor({ state: "visible" });
    expect(await fieldError.textContent()).toBe("name taken");
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("edit app");
  });
});

test("edit app: cancel via the kit back chevron discards the draft without saving", async () => {
  await withBoard(async (page) => {
    let patchCalled = false;
    await page.route("**/api/v1/apps/orbit", async (route) => {
      if (route.request().method() === "PATCH") patchCalled = true;
      await route.continue();
    });

    await openEdit(page, "orbit");
    await page.getByRole("textbox", { name: "name" }).fill("scratch");
    await page.locator('[data-part="drawer-back"]').click();

    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("orbit");
    expect(patchCalled).toBe(false);
  });
});

test("edit app: the kit back chevron clears the draft; reentering starts fresh, not resuming the discarded edit", async () => {
  await withBoard(async (page) => {
    await openEdit(page, "orbit");
    const drawer = page.locator('[data-part="sidedrawer"]');
    await drawer.getByRole("textbox", { name: "name" }).fill("scratch");
    await drawer.getByRole("textbox", { name: "command" }).fill("garbage");

    await page.locator('[data-part="drawer-back"]').click();
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("orbit");
    // Drawer's already open on root -- reenter via the nav row, not the
    // table chevron (which the open drawer panel now overlaps).
    await page.locator('[data-part="listgroup-nav"] button', { hasText: "edit app" }).click();

    expect(await drawer.getByRole("textbox", { name: "name" }).inputValue()).toBe("orbit");
    expect(await drawer.getByRole("textbox", { name: "command" }).inputValue()).toBe("bun run dev");
  });
});

// ---------------------------------------------------------------------------
// Remove flow (drawer-states-atlas.html "4 · Logs, edit, remove", remove
// sheet): the danger row opens the kit ConfirmDialog over the root.
// ---------------------------------------------------------------------------

test("remove: the danger row opens the ConfirmDialog with the atlas's blast-radius copy", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    await page.locator('[data-part="listgroup-action"] button', { hasText: "remove app" }).click();

    const dialog = page.locator('[data-part="modal"]');
    await dialog.waitFor({ state: "visible" });
    expect(await dialog.locator('[data-part="modal-title"]').textContent()).toBe("remove atlas?");
    expect(await dialog.locator('[data-part="confirmdialog-body"]').textContent()).toBe(
      "its route, launchd service, and access config are deleted. the code stays.",
    );
    // The sidedrawer stays mounted underneath -- remove is a sheet over the
    // root, not a screen that replaces it.
    expect(await page.locator('[data-part="sidedrawer"]').count()).toBe(1);
  });
});

test("remove: cancel closes the dialog without deleting; the drawer stays open", async () => {
  await withBoard(async (page) => {
    let deleteCalled = false;
    await page.route("**/api/v1/apps/atlas", async (route) => {
      if (route.request().method() === "DELETE") deleteCalled = true;
      await route.continue();
    });

    await openDrawer(page, "atlas");
    await page.locator('[data-part="listgroup-action"] button', { hasText: "remove app" }).click();
    await page.locator('[data-part="modal"] button', { hasText: "cancel" }).click();
    await page.waitForSelector('[data-part="modal"]', { state: "detached" });

    expect(deleteCalled).toBe(false);
    expect(await page.locator('[data-part="sidedrawer"]').count()).toBe(1);
  });
});

test(
  "remove: confirm DELETEs the app and closes the drawer",
  async () => {
    await withBoard(async (page) => {
      let deleteCalled = false;
      await page.route("**/api/v1/apps/atlas", async (route) => {
        if (route.request().method() !== "DELETE") {
          await route.continue();
          return;
        }
        deleteCalled = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      });
      let removed = false;
      await page.route("**/api/v1/status", async (route) => {
        if (!removed) {
          await route.continue();
          return;
        }
        const next = structuredClone(fixture) as typeof fixture;
        next.apps = next.apps.filter((a) => a.name !== "atlas");
        next.total -= 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
      });

      await openDrawer(page, "atlas");
      await page.locator('[data-part="listgroup-action"] button', { hasText: "remove app" }).click();
      removed = true;
      await page.locator('[data-part="modal"] button', { hasText: "remove app" }).click();

      await waitUntil(async () => deleteCalled);
      await page.waitForSelector('[data-part="sidedrawer"]', { state: "detached", timeout: 8000 });
    });
  },
  12000,
);

test("remove: ArrowDown while the confirm dialog is open does not retarget the drawer", async () => {
  await withBoard(async (page) => {
    await openDrawer(page, "atlas");
    await page.locator('[data-part="listgroup-action"] button', { hasText: "remove app" }).click();
    const dialog = page.locator('[data-part="modal"]');
    await dialog.waitFor({ state: "visible" });

    await page.keyboard.press("ArrowDown");

    expect(await dialog.isVisible()).toBe(true);
    expect(await page.locator('[data-part="drawer-title"]').textContent()).toBe("atlas");
  });
});
