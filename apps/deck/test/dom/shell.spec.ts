import { test, expect } from "bun:test";
import { withBoard, consoleErrors } from "./rig.ts";

test("board shell renders the placeholder", async () => {
  await withBoard(async (page) => {
    expect(await page.isVisible("h1")).toBe(true);
    expect(await page.locator("h1").textContent()).toBe("Deck");
    expect(await page.title()).toBe("Deck");
    expect(consoleErrors(page)).toEqual([]);
  });
});
