import { SoribashiProvider } from "@soribashi/core";
import { describe, expect, it, vi } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { SWITCH_PARTS, Switch } from "./Switch.tsx";

/**
 * Browser tier for the Switch recipe.
 *
 * Same conventions as SelectBox/StatusDot: every render goes through
 * `renderWithTheme`, assertions observe rendered behaviour, and the one
 * sanctioned structural assertion is `data-part`.
 *
 * The controlled-re-render case below is the reason this recipe exists: it
 * is the direct replacement for the old board's manual
 * `ev.target.checked` snap-back on a failed action.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${SWITCH_PARTS.root}"]`);
  if (!el) throw new Error("no Switch root rendered");
  return el;
}

function controlOf(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-part="${SWITCH_PARTS.control}"]`);
  if (!el) throw new Error("no Switch control rendered");
  return el;
}

function labelOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${SWITCH_PARTS.label}"]`);
}

describe("Switch (browser)", () => {
  it("renders a label wrapping a role=switch checkbox input", async () => {
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} aria-label="published" />,
    );

    const root = rootOf(screen.container);
    expect(root.tagName).toBe("LABEL");
    const control = controlOf(screen.container);
    expect(control.tagName).toBe("INPUT");
    expect(control.type).toBe("checkbox");
    expect(control.getAttribute("role")).toBe("switch");
    expect(root.contains(control)).toBe(true);
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is a CONTRACT between the kit and mr-board's stylesheet, not a
    // consumer-facing prop -- same pin as StatusDot.test.tsx/Badge's peers.
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} aria-label="x" data-part="hijacked" />,
    );

    expect(rootOf(screen.container).getAttribute("data-part")).toBe(SWITCH_PARTS.root);
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("checked reflects the prop", async () => {
    const screenOff = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} aria-label="x" />,
    );
    expect(controlOf(screenOff.container).checked).toBe(false);

    const screenOn = await renderWithTheme(
      <Switch checked={true} onChange={() => {}} aria-label="x" />,
    );
    expect(controlOf(screenOn.container).checked).toBe(true);
  });

  it("clicking fires onChange with the click event", async () => {
    const onChange = vi.fn();
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={onChange} aria-label="x" />,
    );
    const control = controlOf(screen.container);

    control.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].target).toBe(control);
  });

  it("controlled only: a click cannot leave the input out of sync with checked", async () => {
    // The whole reason Switch exists: a click flips the DOM checkbox
    // natively before React's own controlled-input contract restores it to
    // match `checked` -- so a caller whose action fails, and never calls
    // setChecked, gets the snap-back for free. No `ev.target.checked` hack
    // required on the caller's side.
    const onChange = vi.fn();
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={onChange} aria-label="x" />,
    );
    const control = controlOf(screen.container);

    control.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].target).toBe(control);
    // By the time the click call returns, React's controlled-input contract
    // has already put the DOM back in sync with the unchanged `checked`
    // prop -- `target` is a live reference to `control`, so this is the
    // same node the handler saw, now restored.
    expect(control.checked).toBe(false);

    // Re-rendering with the same unchanged prop (a real parent re-render
    // triggered by something unrelated) is equally stable.
    await screen.rerender(
      <SoribashiProvider theme={tuiTheme}>
        <Switch checked={false} onChange={onChange} aria-label="x" />
      </SoribashiProvider>,
    );

    expect(control.checked).toBe(false);
  });

  it("label renders in [data-part=switch-label]", async () => {
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} label="Password protected" />,
    );

    expect(labelOf(screen.container)?.textContent).toBe("Password protected");
  });

  it("aria-label passes to the input", async () => {
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} aria-label="published" />,
    );

    expect(controlOf(screen.container).getAttribute("aria-label")).toBe("published");
  });

  it("title lands on the wrapping label (hover target), not the input", async () => {
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} aria-label="x" title="toggle publish" />,
    );

    expect(rootOf(screen.container).getAttribute("title")).toBe("toggle publish");
    expect(controlOf(screen.container).hasAttribute("title")).toBe(false);
  });

  it("disabled disables the input", async () => {
    const screen = await renderWithTheme(
      <Switch checked={false} onChange={() => {}} aria-label="x" disabled />,
    );

    expect(controlOf(screen.container).disabled).toBe(true);
  });
});
