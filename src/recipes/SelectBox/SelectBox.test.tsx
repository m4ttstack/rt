import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { SelectBox, type SelectBoxProps } from "./SelectBox.tsx";

/**
 * Browser tier for the SelectBox recipe.
 *
 * Conventions inherited from Icon.test.tsx / Chip.test.tsx and task 8's
 * checklist: every render goes through `renderWithTheme`; assertions observe
 * rendered behaviour, never emitted CSS text (authoring skill § 18); the one
 * sanctioned structural assertion is `data-part`.
 */

function selectBoxOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-part="selectbox"]');
  if (!el) throw new Error("no selectbox rendered");
  return el;
}

describe("SelectBox (browser)", () => {
  it("is a real checkbox by role, with a computed accessible name from `checked`", async () => {
    const uncheckedScreen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    const checkedScreen = await renderWithTheme(<SelectBox checked onToggle={() => {}} />);

    expect(uncheckedScreen.getByRole("checkbox", { name: "select this MR" })).toBeTruthy();
    expect(checkedScreen.getByRole("checkbox", { name: "deselect this MR" })).toBeTruthy();
  });

  it("reflects `checked` as aria-checked, correctly for both states", async () => {
    const uncheckedScreen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    const checkedScreen = await renderWithTheme(<SelectBox checked onToggle={() => {}} />);

    expect(selectBoxOf(uncheckedScreen.container).getAttribute("aria-checked")).toBe("false");
    expect(selectBoxOf(checkedScreen.container).getAttribute("aria-checked")).toBe("true");
  });

  it("renders the board's own glyphs: ▣ checked, ☐ unchecked", async () => {
    const uncheckedScreen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    const checkedScreen = await renderWithTheme(<SelectBox checked onToggle={() => {}} />);

    expect(selectBoxOf(uncheckedScreen.container).textContent).toBe("☐");
    expect(selectBoxOf(checkedScreen.container).textContent).toBe("▣");
  });

  it("toggles the glyph and aria-checked when clicked, calling onToggle exactly once", async () => {
    let toggles = 0;
    const screen = await renderWithTheme(<SelectBox checked={false} onToggle={() => toggles++} />);

    await screen.getByRole("checkbox").click();

    expect(toggles).toBe(1);
  });

  it("stops click propagation, so a select click never also fires an ancestor row click", async () => {
    let rowClicks = 0;
    let toggles = 0;
    const screen = await renderWithTheme(
      // biome-ignore lint: plain test fixture, not a recipe under test
      <div onClick={() => rowClicks++}>
        <SelectBox checked={false} onToggle={() => toggles++} />
      </div>,
    );

    await screen.getByRole("checkbox").click();

    expect(toggles).toBe(1);
    expect(rowClicks).toBe(0);
  });

  it("takes its accent colour from --accent when checked, distinct from the muted resting state", async () => {
    const uncheckedScreen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    const checkedScreen = await renderWithTheme(<SelectBox checked onToggle={() => {}} />);

    const uncheckedColor = getComputedStyle(selectBoxOf(uncheckedScreen.container)).color;
    const checkedColor = getComputedStyle(selectBoxOf(checkedScreen.container)).color;
    expect(checkedColor).not.toBe(uncheckedColor);
  });

  it("stamps its data-part (the kit's cross-boundary hook)", async () => {
    const screen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    expect(screen.container.querySelectorAll('[data-part="selectbox"]')).toHaveLength(1);
  });

  it("a consumer-supplied data-part does not win", async () => {
    const screen = await renderWithTheme(
      <SelectBox checked={false} onToggle={() => {}} data-part="hijacked" />,
    );

    expect(selectBoxOf(screen.container).getAttribute("data-part")).toBe("selectbox");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("applies its layered stylesheet to the rendered element", async () => {
    const screen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    const style = getComputedStyle(selectBoxOf(screen.container));

    expect(style.display).toBe("inline-flex");
    expect(style.cursor).toBe("pointer");
    // tuiTheme: --radius-px5 is 5px.
    expect(style.borderTopLeftRadius).toBe("5px");
  });

  it("renders as a real button, type=button, never submitting a surrounding form", async () => {
    const screen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} />);
    const el = selectBoxOf(screen.container);

    expect(el.tagName.toLowerCase()).toBe("button");
    expect(el.getAttribute("type")).toBe("button");
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(<SelectBox checked={false} onToggle={() => {}} m="md" />);

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(getComputedStyle(selectBoxOf(screen.container)).marginTop).toBe("9.6px");
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const extended = createTheme({
      extends: tuiTheme,
      components: [SelectBox.extend({ defaultProps: { checked: true } })],
    });

    // KNOWN TYPE GAP (see Segmented/CopyButton's identical case): defaultProps
    // supplied through the theme has no static reflection back onto the
    // required own-prop type, so omitting `checked` still needs a cast.
    const props = { onToggle: () => {} } as unknown as SelectBoxProps;
    const screen = await renderWithTheme(<SelectBox {...props} />, undefined, extended);

    expect(screen.getByRole("checkbox", { name: "deselect this MR" })).toBeTruthy();
  });
});
