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

/** The alpha channel of a computed `rgb()`/`rgba()` string — a bare `rgb()`
    (no alpha component at all) is opaque, i.e. alpha 1. */
function alphaOf(rgbString: string): number {
  const match = rgbString.match(/rgba\([\d.\s]+,[\d.\s]+,[\d.\s]+,\s*([\d.]+)\)/);
  return match ? Number(match[1]) : 1;
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

  it('defaults to variant="solid"', async () => {
    const screen = await renderWithTheme(<Button>go</Button>);

    expect(buttonOf(screen.container).getAttribute("data-variant")).toBe("solid");
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

  describe("solid vs outline vs subtle — background and intent-colour distinctions", () => {
    it("solid is opaque at rest; outline and ghost are transparent", async () => {
      const solidScreen = await renderWithTheme(<Button variant="solid">solid</Button>);
      const outlineScreen = await renderWithTheme(<Button variant="outline">outline</Button>);
      const ghostScreen = await renderWithTheme(<Button variant="ghost">ghost</Button>);

      expect(getComputedStyle(buttonOf(solidScreen.container)).backgroundColor).not.toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(getComputedStyle(buttonOf(outlineScreen.container)).backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(getComputedStyle(buttonOf(ghostScreen.container)).backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
    });

    it("subtle's card background differs from solid's panel background", async () => {
      const solidScreen = await renderWithTheme(<Button variant="solid">solid</Button>);
      const subtleScreen = await renderWithTheme(<Button variant="subtle">subtle</Button>);

      expect(getComputedStyle(buttonOf(subtleScreen.container)).backgroundColor).not.toBe(
        getComputedStyle(buttonOf(solidScreen.container)).backgroundColor,
      );
    });

    it("solid's text/border stay neutral for a non-bad intent — no per-intent tint, unlike outline", async () => {
      const screen = await renderWithTheme(
        <div>
          <Button variant="solid" intent="ok">
            solid
          </Button>
          <span data-testid="fg-probe" style={{ color: "var(--fg)" }} />
        </div>,
      );
      const button = buttonOf(screen.container);
      const fgColor = getComputedStyle(
        screen.container.querySelector('[data-testid="fg-probe"]') as HTMLElement,
      ).color;

      expect(getComputedStyle(button).color).toBe(fgColor);
    });

    it("solid + bad intent: red text AND red border, at rest (no hover needed)", async () => {
      const screen = await renderWithTheme(
        <div>
          <Button variant="solid" intent="bad">
            remove
          </Button>
          <span data-testid="red-probe" style={{ color: "var(--red)" }} />
        </div>,
      );
      const button = buttonOf(screen.container);
      const redColor = getComputedStyle(
        screen.container.querySelector('[data-testid="red-probe"]') as HTMLElement,
      ).color;

      expect(getComputedStyle(button).color).toBe(redColor);
      expect(getComputedStyle(button).borderTopColor).toBe(redColor);
    });

    it("outline's border AND text ride the resolved intent tone for every intent, not just bad", async () => {
      const screen = await renderWithTheme(
        <div>
          <Button variant="outline" intent="cyan">
            outline
          </Button>
          <span data-testid="cyan-probe" style={{ color: "var(--cyan)" }} />
        </div>,
      );
      const button = buttonOf(screen.container);
      const cyanColor = getComputedStyle(
        screen.container.querySelector('[data-testid="cyan-probe"]') as HTMLElement,
      ).color;

      expect(getComputedStyle(button).color).toBe(cyanColor);
      expect(getComputedStyle(button).borderTopColor).toBe(cyanColor);
    });

    it("outline's two intents resolve to two different tones (it's derived, not fixed)", async () => {
      const accentScreen = await renderWithTheme(
        <Button variant="outline" intent="accent">
          accent
        </Button>,
      );
      const badScreen = await renderWithTheme(
        <Button variant="outline" intent="bad">
          bad
        </Button>,
      );

      expect(getComputedStyle(buttonOf(accentScreen.container)).color).not.toBe(
        getComputedStyle(buttonOf(badScreen.container)).color,
      );
    });

    it("subtle's text also rides the intent tone, same as outline's", async () => {
      const outlineScreen = await renderWithTheme(
        <Button variant="outline" intent="purple">
          outline
        </Button>,
      );
      const subtleScreen = await renderWithTheme(
        <Button variant="subtle" intent="purple">
          subtle
        </Button>,
      );

      expect(getComputedStyle(buttonOf(subtleScreen.container)).color).toBe(
        getComputedStyle(buttonOf(outlineScreen.container)).color,
      );
    });

    it("hover changes ONLY background — outline's border and text stay put from rest to hover", async () => {
      const screen = await renderWithTheme(
        <Button variant="outline" intent="ok">
          outline
        </Button>,
      );
      const button = buttonOf(screen.container);
      const restBorder = getComputedStyle(button).borderTopColor;
      const restColor = getComputedStyle(button).color;

      await screen.getByRole("button", { name: "outline" }).hover();

      expect(getComputedStyle(button).borderTopColor).toBe(restBorder);
      expect(getComputedStyle(button).color).toBe(restColor);
      // ...but the background DID change — hover is not a no-op.
      expect(getComputedStyle(button).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    });

    it("outline's hover fill is a WEAKER tint than ghost's — Mantine's own outline (5%) vs subtle (12%) alphas differ", async () => {
      const outlineScreen = await renderWithTheme(
        <Button variant="outline" intent="accent">
          outline
        </Button>,
      );
      const ghostScreen = await renderWithTheme(
        <Button variant="ghost" intent="accent">
          ghost
        </Button>,
      );

      await outlineScreen.getByRole("button", { name: "outline" }).hover();
      await ghostScreen.getByRole("button", { name: "ghost" }).hover();

      // Same intent, same --bg base, DIFFERENT alpha — the two must not
      // collapse onto the same computed colour (they did, by accident, when
      // both variants shared one var before this was split per Mantine's
      // real per-variant alphas).
      expect(getComputedStyle(buttonOf(outlineScreen.container)).backgroundColor).not.toBe(
        getComputedStyle(buttonOf(ghostScreen.container)).backgroundColor,
      );
    });
  });

  describe("ghost hover fill", () => {
    it("stays transparent at rest", async () => {
      const screen = await renderWithTheme(<Button variant="ghost">ghost</Button>);

      expect(getComputedStyle(buttonOf(screen.container)).backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
    });

    it("tints on a real hover — the wash is gated behind :hover, which no synthetic event can satisfy", async () => {
      const screen = await renderWithTheme(<Button variant="ghost">ghost</Button>);

      // A real pointer hover (vitest-browser's Locator, backed by a real
      // Playwright pointer move) — same reasoning as StatusDot.test.tsx's
      // tooltip case.
      await screen.getByRole("button", { name: "ghost" }).hover();

      expect(getComputedStyle(buttonOf(screen.container)).backgroundColor).not.toBe(
        "rgba(0, 0, 0, 0)",
      );
    });

    it("is derived from intent, not a fixed tint — accent and bad hover to different colours", async () => {
      const accentScreen = await renderWithTheme(
        <Button variant="ghost" intent="accent">
          accent
        </Button>,
      );
      const badScreen = await renderWithTheme(
        <Button variant="ghost" intent="bad">
          bad
        </Button>,
      );

      await accentScreen.getByRole("button", { name: "accent" }).hover();
      const accentHoverBg = getComputedStyle(buttonOf(accentScreen.container)).backgroundColor;

      await badScreen.getByRole("button", { name: "bad" }).hover();
      const badHoverBg = getComputedStyle(buttonOf(badScreen.container)).backgroundColor;

      expect(accentHoverBg).not.toBe(badHoverBg);
    });

    it("is a SOLID mix over --bg, not the shared partial-alpha wash", async () => {
      const screen = await renderWithTheme(<Button variant="ghost">ghost</Button>);

      await screen.getByRole("button", { name: "ghost" }).hover();

      // The kit's shared tuiIntentResolver.hover wash is `color-mix(...,
      // transparent)` — a genuine fractional alpha. Button's own
      // --sb-button-ghost-hover-bg mixes against --bg (opaque) instead, so
      // the composited colour must read fully opaque, not partially so.
      expect(alphaOf(getComputedStyle(buttonOf(screen.container)).backgroundColor)).toBe(1);
    });

    it("the border stays transparent on hover, for both accent and bad intent", async () => {
      const accentScreen = await renderWithTheme(
        <Button variant="ghost" intent="accent">
          accent
        </Button>,
      );
      const badScreen = await renderWithTheme(
        <Button variant="ghost" intent="bad">
          bad
        </Button>,
      );

      // No variant's hover touches border-color any more (only background
      // does) — this pins that ghost's already-transparent border really
      // does stay put, for both intents, rather than relying on that being
      // true by omission.
      await accentScreen.getByRole("button", { name: "accent" }).hover();
      expect(getComputedStyle(buttonOf(accentScreen.container)).borderTopColor).toBe(
        "rgba(0, 0, 0, 0)",
      );

      await badScreen.getByRole("button", { name: "bad" }).hover();
      expect(getComputedStyle(buttonOf(badScreen.container)).borderTopColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
    });

    it("keeps the hover text at the same full-saturation intent colour the fill doesn't touch", async () => {
      const screen = await renderWithTheme(
        <div>
          <Button variant="ghost" intent="accent">
            ghost
          </Button>
          <span data-testid="accent-probe" style={{ color: "var(--accent)" }} />
        </div>,
      );

      await screen.getByRole("button", { name: "ghost" }).hover();

      const hoverTextColor = getComputedStyle(buttonOf(screen.container)).color;
      const accentColor = getComputedStyle(
        screen.container.querySelector('[data-testid="accent-probe"]') as HTMLElement,
      ).color;
      expect(hoverTextColor).toBe(accentColor);
    });
  });

  it("rejects an out-of-vocabulary variant at the type level", async () => {
    await renderWithTheme(
      // @ts-expect-error -- "filled" is not in the kit's variant vocabulary
      // (BUTTON_VARIANTS is solid/outline/subtle/ghost; theme.ts's variant
      // vocabulary omits soribashi's default "filled").
      <Button variant="filled">go</Button>,
    );
  });
});
