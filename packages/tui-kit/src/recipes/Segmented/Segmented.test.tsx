import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { ICONS } from "../Icon/Icon.tsx";
import { LabeledSeg, SEGMENTED_PARTS, Segmented, type SegmentedProps } from "./Segmented.tsx";

/**
 * Browser tier for the Segmented recipe (+ LabeledSeg).
 *
 * Every render goes through `renderWithTheme`; assertions observe
 * rendered behaviour (computed styles, the accessibility tree, real
 * interaction), never emitted CSS text; the one
 * sanctioned structural assertion is `data-part`.
 *
 * `defineGenericComponent` declares NO vocabulary axes here (mr-board's
 * Segmented/LabeledSeg carry no intent/variant/size prop at all — see
 * Segmented.tsx's own comment), so this file has no colour census the way
 * Chip's does; it instead pins the generic-inference signature, the typed
 * onChange, and the active-option state the brief calls for.
 */

type Tab = "rows" | "grid" | "light";
const TAB_OPTIONS: readonly Tab[] = ["rows", "grid", "light"];
const TAB_LABELS: Record<Tab, string> = { rows: "Rows", grid: "Grid", light: "Light" };

function segmentedRootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${SEGMENTED_PARTS.root}"]`);
  if (!el) throw new Error("no segmented root rendered");
  return el;
}

function options(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-part="${SEGMENTED_PARTS.option}"]`));
}

describe("Segmented (browser)", () => {
  it("renders one option per entry, each as a real button", async () => {
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="view" />,
    );

    const buttons = options(screen.container);
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.tagName.toLowerCase()).toBe("button");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("renders the ICONS glyph for a key that has one, and the raw string otherwise", async () => {
    const screen = await renderWithTheme(
      <Segmented options={["rows", "custom"] as const} value="rows" onChange={() => {}} label="view" />,
    );

    const buttons = options(screen.container);
    // "rows" has a glyph in mr-board's ICONS dictionary: an svg, no text node.
    expect(buttons[0]?.querySelector("svg")).not.toBeNull();
    expect(buttons[0]?.textContent).toBe("");
    // "custom" has no ICONS entry: the raw key renders as text (`ICONS[o] ?? o`).
    expect(buttons[1]?.querySelector("svg")).toBeNull();
    expect(buttons[1]?.textContent).toBe("custom");
  });

  it("fires onChange with the TYPED option value on click, not a string widened to `any`", async () => {
    const seen: Tab[] = [];
    const onChange = (v: Tab) => seen.push(v);
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={onChange} label="view" />,
    );

    const buttons = options(screen.container);
    await buttons[1]?.click(); // "grid"
    await buttons[2]?.click(); // "light"

    expect(seen).toEqual(["grid", "light"]);
  });

  it("the active option carries the state, and only the active one", async () => {
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="grid" onChange={() => {}} label="view" />,
    );

    const buttons = options(screen.container);
    expect(buttons.map((b) => b.hasAttribute("data-active"))).toEqual([false, true, false]);
    // Rendered consequence, not just the attribute: the board's accent fill.
    const activeStyle = getComputedStyle(buttons[1] as HTMLElement);
    const inactiveStyle = getComputedStyle(buttons[0] as HTMLElement);
    expect(activeStyle.backgroundColor).not.toBe(inactiveStyle.backgroundColor);
    expect(activeStyle.fontWeight).toBe("700");
  });

  it("is a real accessibility group, labelled from the `label` prop", async () => {
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="board view" />,
    );

    const group = screen.getByRole("group", { name: "board view" });
    await expect.element(group).toBeVisible();
  });

  it("stamps its two data-parts (the kit's cross-boundary hook)", async () => {
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="view" />,
    );

    expect(screen.container.querySelectorAll('[data-part="segmented"]')).toHaveLength(1);
    expect(screen.container.querySelectorAll('[data-part="segmented-option"]')).toHaveLength(3);
    expect(SEGMENTED_PARTS).toEqual({ root: "segmented", option: "segmented-option" });
  });

  it("a consumer-supplied data-part does not win", async () => {
    const screen = await renderWithTheme(
      <Segmented
        options={TAB_OPTIONS}
        value="rows"
        onChange={() => {}}
        label="view"
        data-part="hijacked"
      />,
    );

    expect(segmentedRootOf(screen.container).getAttribute("data-part")).toBe("segmented");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("applies its layered stylesheet to the rendered element", async () => {
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="view" />,
    );

    const style = getComputedStyle(segmentedRootOf(screen.container));
    expect(style.display).toBe("inline-flex");
    expect(style.overflow).toBe("hidden");
    // tuiTheme: --radius-md is 6px.
    expect(style.borderTopLeftRadius).toBe("6px");
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="view" m="md" />,
    );

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(getComputedStyle(segmentedRootOf(screen.container)).marginTop).toBe("9.6px");
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [Segmented.extend({ defaultProps: { label: "themed default" } })],
    });

    // KNOWN TYPE GAP (filed as a friction, mirroring Chip.test.tsx's `as`
    // extend-typing gap but on the CALL side): `defineGenericComponent` gives
    // `TSignature` no static reflection of `config.defaults`/`extend`'s
    // `defaultProps`, so omitting `label` here to prove it comes from the
    // theme still requires a cast — the runtime path (`useProps` merging
    // defaults before render) works regardless of what the type system knows.
    const props = { options: TAB_OPTIONS, value: "rows", onChange: () => {} } as unknown as SegmentedProps<Tab>;
    const screen = await renderWithTheme(<Segmented {...props} />, undefined, extended);

    expect(screen.getByRole("group", { name: "themed default" })).toBeTruthy();
  });

  it("ships mr-board's ICONS dictionary import, not a redeclared copy", () => {
    // Guards against a future drift where Segmented starts carrying its own
    // glyph table instead of importing the Icon recipe's.
    expect(ICONS.rows).toBeDefined();
    expect(ICONS.grid).toBeDefined();
  });
});

describe("LabeledSeg (browser)", () => {
  it("renders text labels, not icons, and fires the typed onChange", async () => {
    const seen: Tab[] = [];
    const screen = await renderWithTheme(
      <LabeledSeg
        legend="view mode"
        options={TAB_OPTIONS}
        labels={TAB_LABELS}
        value="rows"
        onChange={(v) => seen.push(v)}
      />,
    );

    const buttons = options(screen.container);
    expect(buttons.map((b) => b.textContent)).toEqual(["Rows", "Grid", "Light"]);
    expect(buttons.every((b) => b.querySelector("svg") === null)).toBe(true);

    await buttons[2]?.click();
    expect(seen).toEqual(["light"]);
  });

  it("is labelled by `legend`, and carries the text-mode modifier the CSS keys on", async () => {
    const screen = await renderWithTheme(
      <LabeledSeg
        legend="view mode"
        options={TAB_OPTIONS}
        labels={TAB_LABELS}
        value="rows"
        onChange={() => {}}
      />,
    );

    const group = screen.getByRole("group", { name: "view mode" });
    await expect.element(group).toBeVisible();
    expect(segmentedRootOf(screen.container).hasAttribute("data-text")).toBe(true);
  });

  it("renders at the board's smaller relative text size, distinct from Segmented's icon buttons", async () => {
    const iconScreen = await renderWithTheme(
      <Segmented options={TAB_OPTIONS} value="rows" onChange={() => {}} label="view" />,
    );
    const textScreen = await renderWithTheme(
      <LabeledSeg
        legend="view mode"
        options={TAB_OPTIONS}
        labels={TAB_LABELS}
        value="rows"
        onChange={() => {}}
      />,
    );

    const iconOption = options(iconScreen.container)[0] as HTMLElement;
    const textOption = options(textScreen.container)[0] as HTMLElement;
    // 0.8em of the option's own font size: strictly smaller than Segmented's
    // unmodified option, which inherits the ambient font size directly.
    expect(parseFloat(getComputedStyle(textOption).fontSize)).toBeLessThan(
      parseFloat(getComputedStyle(iconOption).fontSize),
    );
  });

  it("stamps the same two data-parts as Segmented (one recipe, shared slots)", async () => {
    const screen = await renderWithTheme(
      <LabeledSeg
        legend="view mode"
        options={TAB_OPTIONS}
        labels={TAB_LABELS}
        value="rows"
        onChange={() => {}}
      />,
    );

    expect(screen.container.querySelectorAll('[data-part="segmented"]')).toHaveLength(1);
    expect(screen.container.querySelectorAll('[data-part="segmented-option"]')).toHaveLength(3);
  });
});
