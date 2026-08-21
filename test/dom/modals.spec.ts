// bun:test's `expect` has no Playwright-locator matchers -- see board.spec.ts's
// header comment for why assertions here read Locator/Page API values
// directly and compare with bun's expect.
import { test, expect } from "bun:test";
import type { Page } from "playwright";
import { withBoard, consoleErrors } from "./rig.ts";

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

test("add app opens the Add modal: switch first, then a focused Name field with pattern; external toggles the field set", async () => {
  await withBoard(async (page) => {
    await page.locator("button", { hasText: "add app" }).click();
    const modal = page.locator('[data-part="modal"]');
    await modal.waitFor({ state: "visible" });

    const formChildren = modal.locator(".modal-form > label");
    expect(await formChildren.nth(0).getAttribute("data-part")).toBe("switch");
    expect(await formChildren.nth(1).getAttribute("data-part")).toBe("field");

    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "app-name");
    expect(await modal.locator('[name="app-name"]').getAttribute("pattern")).toBe("[a-z0-9][a-z0-9.-]*");

    // external=false: Command + Working directory + the next-port hint.
    expect(await modal.getByText("Command", { exact: true }).count()).toBe(1);
    expect(await modal.getByText("Working directory", { exact: true }).count()).toBe(1);
    expect(await modal.getByText("Will be assigned port 11012 (PORT env).").count()).toBe(1);
    expect(await modal.getByText("Port it listens on", { exact: true }).count()).toBe(0);

    // external=true: swaps to the static-port field.
    await modal.locator('[data-part="switch-control"]').click();
    expect(await modal.getByText("Port it listens on", { exact: true }).count()).toBe(1);
    expect(await modal.getByText("Command", { exact: true }).count()).toBe(0);
    expect(await modal.getByText("Working directory", { exact: true }).count()).toBe(0);

    expect(consoleErrors(page)).toEqual([]);
  });
});

test("add app submit POSTs the addPayload shape; API error renders in the modal Alert and keeps it open", async () => {
  await withBoard(async (page) => {
    let postBody: unknown = null;
    await page.route("**/api/v1/apps", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postBody = route.request().postDataJSON();
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "name taken" }) });
    });

    await page.locator("button", { hasText: "add app" }).click();
    const modal = page.locator('[data-part="modal"]');
    await modal.locator('[name="app-name"]').fill("newapp");
    await modal.getByPlaceholder("bun src/server.ts").fill("bun run start");
    await modal.getByPlaceholder("/Users/you/code/myapp").fill("/Users/matt/code/newapp");
    await modal.locator('button[type="submit"]').click();

    await poll(() => postBody !== null);
    expect(postBody).toEqual({
      name: "newapp",
      command: ["bun", "run", "start"],
      workingDirectory: "/Users/matt/code/newapp",
    });

    const alert = modal.locator('[data-part="alert"]');
    await alert.waitFor({ state: "visible" });
    expect(await alert.textContent()).toContain("name taken");
    expect(await page.locator('[data-part="modal"]').count()).toBe(1);
  });
});

test("edit button opens Edit modal titled Edit <name> with service fields; submit PATCHes editPatch, error keeps it open", async () => {
  await withBoard(async (page) => {
    let patchBody: unknown = null;
    await page.route("**/api/v1/apps/orbit", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchBody = route.request().postDataJSON();
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "bad edit" }) });
    });

    const orbitRow = rowFor(page, "orbit");
    await orbitRow.locator('[aria-label="edit orbit"]').click();

    const modal = page.locator('[data-part="modal"]');
    expect(await modal.locator('[data-part="modal-title"]').textContent()).toBe("Edit orbit");

    expect(await modal.getByLabel("Name", { exact: true }).inputValue()).toBe("orbit");
    expect(await modal.getByLabel("Base port").inputValue()).toBe("11007");
    expect(await modal.getByLabel("Command").inputValue()).toBe("bun run dev");
    expect(await modal.getByLabel("Working directory").inputValue()).toBe("/Users/matt/Documents/GitHub/orbit");

    await modal.locator('button[type="submit"]').click();

    await poll(() => patchBody !== null);
    expect(patchBody).toEqual({
      name: "orbit",
      port: 11007,
      command: ["bun", "run", "dev"],
      workingDirectory: "/Users/matt/Documents/GitHub/orbit",
    });

    const alert = modal.locator('[data-part="alert"]');
    await alert.waitFor({ state: "visible" });
    expect(await alert.textContent()).toContain("bad edit");
    expect(await page.locator('[data-part="modal"]').count()).toBe(1);
  });
});

test("remove button opens ConfirmDialog with the remove copy; confirm DELETEs and surfaces API error via the notice Alert; cancel sends no request", async () => {
  await withBoard(async (page) => {
    let deleteCount = 0;
    await page.route("**/api/v1/apps/orbit", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      deleteCount++;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Managed by mattstack - `rt uninstall orbit`" }),
      });
    });

    const orbitRow = rowFor(page, "orbit");

    // Cancel: dialog closes, no request.
    await orbitRow.locator('[aria-label="remove orbit"]').click();
    const dialog = page.locator('[data-part="modal"]');
    expect(await dialog.locator('[data-part="modal-title"]').textContent()).toBe("Remove orbit?");
    expect(await dialog.locator('[data-part="confirmdialog-body"]').textContent()).toBe(
      "This deletes its service and route.",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await page.locator('[data-part="modal"]').count()).toBe(0);
    expect(deleteCount).toBe(0);

    // Confirm: DELETE fires; the API's message surfaces verbatim in the notice Alert.
    await orbitRow.locator('[aria-label="remove orbit"]').click();
    await page.locator('[data-part="modal"]').getByRole("button", { name: "Remove" }).click();
    await poll(() => deleteCount > 0);

    const notice = page.locator('[data-part="alert"]');
    await notice.waitFor({ state: "visible" });
    expect(await notice.textContent()).toContain("Managed by mattstack - `rt uninstall orbit`");
  });
});
