import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { Button, BUTTON_PARTS } from "./Button.tsx";

/**
 * Browser tier for the Button recipe.
 *
 * Same conventions as Chip.test.tsx: every render goes through
 * `renderWithTheme`, assertions observe rendered behaviour, and `data-part`
 * is the one sanctioned structural assertion.
 */

function buttonOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${BUTTON_PARTS.root}"]`);
  if (!el) throw new Error("no Button rendered");
  return el;
}

describe("Button (browser)", () => {
  it('renders <button type="button"> by default', async () => {
    const screen = await renderWithTheme(<Button>go</Button>);

    const button = buttonOf(screen.container);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  it('type="submit" passes through', async () => {
    const screen = await renderWithTheme(<Button type="submit">save</Button>);

    expect(buttonOf(screen.container).getAttribute("type")).toBe("submit");
  });

  it("stamps data-part, data-variant, and data-intent via getStyles", async () => {
    const screen = await renderWithTheme(
      <Button intent="bad" variant="ghost">
        delete
      </Button>,
    );
    const button = buttonOf(screen.container);

    expect(button.getAttribute("data-part")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("ghost");
    expect(button.getAttribute("data-intent")).toBe("bad");
  });

  it("size=sm stamps data-size=sm, a vocabulary axis emitted by getStyles", async () => {
    const screen = await renderWithTheme(<Button size="sm">small</Button>);

    expect(buttonOf(screen.container).getAttribute("data-size")).toBe("sm");
  });

  it("busy disables the button, sets aria-busy, and embeds a Spinner", async () => {
    const screen = await renderWithTheme(<Button busy>restarting…</Button>);
    const button = buttonOf(screen.container);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.container.querySelectorAll('[data-part="spinner"]')).toHaveLength(1);
    // Children stay rendered alongside the spinner — callers swap the label
    // text themselves rather than the recipe hiding it.
    expect(button.textContent).toContain("restarting…");
  });

  it("disabled passes through", async () => {
    const screen = await renderWithTheme(<Button disabled>go</Button>);

    expect((buttonOf(screen.container) as HTMLButtonElement).disabled).toBe(true);
  });

  it("iconOnly stamps data-icon-only", async () => {
    const screen = await renderWithTheme(
      <Button iconOnly aria-label="Refresh">
        ↻
      </Button>,
    );

    expect(buttonOf(screen.container).hasAttribute("data-icon-only")).toBe(true);
  });

  describe("iconOnly dev warning", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("warns when iconOnly is set without an aria-label", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await renderWithTheme(<Button iconOnly>↻</Button>);

      expect(warn).toHaveBeenCalledWith("tui-kit Button: iconOnly requires an aria-label");
    });

    it("stays silent when iconOnly carries an aria-label", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await renderWithTheme(
        <Button iconOnly aria-label="Refresh">
          ↻
        </Button>,
      );

      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("rejects an out-of-vocabulary variant at the type level", async () => {
    await renderWithTheme(
      // @ts-expect-error -- "filled" is not in the kit's variant vocabulary
      // (BUTTON_VARIANTS is outline/subtle/ghost; theme.ts's variant
      // vocabulary omits soribashi's default "filled").
      <Button variant="filled">go</Button>,
    );
  });
});
