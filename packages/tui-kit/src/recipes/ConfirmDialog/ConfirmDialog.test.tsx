import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { CONFIRMDIALOG_PARTS, ConfirmDialog } from "./ConfirmDialog.tsx";

/**
 * Browser tier for the ConfirmDialog recipe.
 *
 * Same conventions as Modal.test.tsx: every render goes through
 * `renderWithTheme`, assertions observe rendered behaviour, and `data-part`
 * is the one sanctioned structural assertion.
 */

function bodyOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${CONFIRMDIALOG_PARTS.body}"]`);
  if (!el) throw new Error("no ConfirmDialog body rendered");
  return el;
}

const noop = () => {};

describe("ConfirmDialog (browser)", () => {
  it("renders nothing when closed", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open={false}
        title="Remove myapp?"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
      >
        This deletes its service and route.
      </ConfirmDialog>,
    );

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders a Modal titled via `title`, ariaLabel defaulting to the title string", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="Remove myapp?"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
      >
        This deletes its service and route.
      </ConfirmDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Remove myapp?" });
    await expect.element(dialog).toBeVisible();
    expect(screen.container.textContent).toContain("Remove myapp?");
  });

  it("renders the body children inside the body slot", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="Remove myapp?"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
      >
        This deletes its service and route.
      </ConfirmDialog>,
    );

    expect(bodyOf(screen.container).textContent).toBe("This deletes its service and route.");
  });

  it("renders a cancel button (default label 'Cancel') and the confirm button, confirm intent 'bad' by default", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="Remove myapp?"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
      >
        body
      </ConfirmDialog>,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" }).element() as HTMLElement;
    const confirm = screen.getByRole("button", { name: "Remove" }).element() as HTMLElement;
    expect(confirm.getAttribute("data-intent")).toBe("bad");
    expect(cancel).not.toBeNull();
  });

  it("cancelLabel overrides the default cancel label", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Remove"
        cancelLabel="Keep it"
        onConfirm={noop}
        onCancel={noop}
      >
        body
      </ConfirmDialog>,
    );

    await expect.element(screen.getByRole("button", { name: "Keep it" })).toBeVisible();
  });

  it("intent='accent' overrides the confirm button's default 'bad' intent", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Save"
        intent="accent"
        onConfirm={noop}
        onCancel={noop}
      >
        body
      </ConfirmDialog>,
    );

    const confirm = screen.getByRole("button", { name: "Save" }).element() as HTMLElement;
    expect(confirm.getAttribute("data-intent")).toBe("accent");
  });

  it("clicking confirm fires onConfirm, not onCancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        body
      </ConfirmDialog>,
    );

    await screen.getByRole("button", { name: "Remove" }).click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clicking cancel fires onCancel, not onConfirm", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        body
      </ConfirmDialog>,
    );

    await screen.getByRole("button", { name: "Cancel" }).click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Modal's close path (Escape) fires onCancel", async () => {
    const onCancel = vi.fn();
    await renderWithTheme(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={onCancel}
      >
        body
      </ConfirmDialog>,
    );

    await userEvent.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("focuses the cancel button on mount (destructive default-safe)", async () => {
    const screen = await renderWithTheme(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
      >
        body
      </ConfirmDialog>,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" }).element();
    expect(document.activeElement).toBe(cancel);
  });
});
