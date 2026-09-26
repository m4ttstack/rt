import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { ALERT_PARTS, Alert } from "./Alert.tsx";

/**
 * Browser tier for the Alert recipe.
 *
 * Same conventions as Badge.test.tsx/StatusDot.test.tsx: every render goes
 * through `renderWithTheme`, assertions observe rendered behaviour, and the
 * one sanctioned structural assertion is `data-part`.
 *
 * `intent` is REQUIRED here (unlike Badge's optional four-value scalar) --
 * both deck call sites (proxy notice, modal form error) always know their
 * intent, so there is no sane default to fall back to.
 */

function rootOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${ALERT_PARTS.root}"]`);
  if (!el) throw new Error("no Alert root rendered");
  return el;
}

function commandOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${ALERT_PARTS.command}"]`);
}

describe("Alert (browser)", () => {
  it("renders a div with role=alert, data-part, and its children", async () => {
    const screen = await renderWithTheme(<Alert intent="bad">something broke</Alert>);

    const root = rootOf(screen.container);
    expect(root.tagName).toBe("DIV");
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.textContent).toContain("something broke");
  });

  it.each(["ok", "bad"] as const)("intent=%s stamps its own data-intent", async (intent) => {
    const screen = await renderWithTheme(<Alert intent={intent}>x</Alert>);

    expect(rootOf(screen.container).getAttribute("data-intent")).toBe(intent);
  });

  it("renders no command block when command is not given", async () => {
    const screen = await renderWithTheme(<Alert intent="bad">no command here</Alert>);

    expect(commandOf(screen.container)).toBeNull();
  });

  it("renders a <pre data-part=alert-command> with the command text when given", async () => {
    const screen = await renderWithTheme(
      <Alert intent="bad" command="npm install -g mattstack">
        the CLI is out of date
      </Alert>,
    );

    const command = commandOf(screen.container);
    expect(command).not.toBeNull();
    expect(command?.tagName).toBe("PRE");
    expect(command?.textContent).toBe("npm install -g mattstack");
  });

  it("title passes through to the root", async () => {
    const screen = await renderWithTheme(
      <Alert intent="bad" title="Proxy error">
        message
      </Alert>,
    );

    expect(rootOf(screen.container).getAttribute("title")).toBe("Proxy error");
  });

  it("a consumer className passes through and merges with the recipe's own class", async () => {
    const screen = await renderWithTheme(
      <Alert intent="ok" className="app-alert">
        x
      </Alert>,
    );

    const root = rootOf(screen.container);
    expect(root.classList.contains("app-alert")).toBe(true);
    // `display: flex` only exists in Alert.module.css's `.root`, proving the
    // module class survived alongside the consumer's own.
    expect(getComputedStyle(root).display).toBe("flex");
  });
});
