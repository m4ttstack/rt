// bun:test's `expect` has no Playwright-locator matchers -- see board.spec.ts's
// header comment for why assertions here read Locator/Page API values
// directly and compare with bun's expect.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard } from "./rig.ts";

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({ has: page.locator("strong", { hasText: name }) });
}

test("override row: plain port number, dev chip carries the base port in its tooltip, no click handler", async () => {
  await withBoard(async (page) => {
    const orbitRow = rowFor(page, "orbit");
    const portCell = orbitRow.locator('[data-part="table-cell"]').nth(1);
    expect((await portCell.textContent())?.trim()).toBe("3007dev");

    const chip = orbitRow.locator('[data-part="chip"]', { hasText: "dev" });
    expect(await chip.evaluate((el) => el.tagName)).toBe("SPAN"); // display-only: no button, no click handler
    const chipTooltip = chip.locator("xpath=..");
    expect(await chipTooltip.getAttribute("data-tip")).toBe("dev port override, normally 11007");
  });
});

test("self row (forecast): plain port text, no dev chip even though its override is set", async () => {
  await withBoard(async (page) => {
    const forecastRow = rowFor(page, "forecast");
    const portCell = forecastRow.locator('[data-part="table-cell"]').nth(1);
    expect((await portCell.textContent())?.trim()).toBe("11003");
    expect(await forecastRow.locator('[data-part="chip"]', { hasText: "dev" }).count()).toBe(0);
  });
});

test("atlas (no override): plain port number, no dev chip", async () => {
  await withBoard(async (page) => {
    const atlasRow = rowFor(page, "atlas");
    const portCell = atlasRow.locator('[data-part="table-cell"]').nth(1);
    expect((await portCell.textContent())?.trim()).toBe("11001");
    expect(await atlasRow.locator('[data-part="chip"]', { hasText: "dev" }).count()).toBe(0);
  });
});
