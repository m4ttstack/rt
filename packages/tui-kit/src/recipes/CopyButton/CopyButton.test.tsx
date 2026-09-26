import { createTheme } from "@soribashi/core";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { CopyButton, type CopyButtonProps } from "./CopyButton.tsx";

/**
 * Browser tier for the CopyButton recipe.
 *
 * Every render goes through `renderWithTheme`; assertions observe
 * rendered behaviour, never emitted CSS text; the one
 * sanctioned structural assertion is `data-part`.
 *
 * THE FAKE-TIMER / REAL-BROWSER-EVENT INTERACTION, spelled out because it is
 * new to this kit (the brief's own warning):
 *
 *  - `navigator.clipboard.writeText` is stubbed per test (real headless
 *    Chromium has no clipboard permission by default, and this kit has no
 *    reason to grant one just to exercise a mock). `Object.defineProperty` is
 *    used rather than `vi.stubGlobal("navigator", ...)`: the latter replaces
 *    the WHOLE `navigator` object, which drops properties `renderWithTheme`'s
 *    surrounding page and other tests in this run still need.
 *  - `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })` — NOT the
 *    default full fake-timer set. The default also fakes
 *    `requestAnimationFrame`/`Date`/`setInterval`, which the vitest-browser
 *    click driver's own actionability/stability polling can depend on inside
 *    the real page; faking those alongside the component's own `setTimeout`
 *    risks the CLICK ITSELF hanging, not just the flash. Narrowing `toFake`
 *    to exactly the two globals the recipe's own `setTimeout(...)` call needs
 *    keeps the driver's machinery on real timers.
 *  - `await button.click()` runs BEFORE relying on the fake clock, and the
 *    flash's assertion goes through `vi.advanceTimersByTimeAsync`, never the
 *    sync `advanceTimersByTime`: `writeText(...).then(...)` resolves via a
 *    microtask, and the `Async` variant is what drains pending microtasks
 *    between each simulated tick (the sync variant does not), so the
 *    `setState(true)` inside the `.then` callback is guaranteed to have run
 *    before the assertion reads `data-copied`.
 *  - `vi.useRealTimers()` runs in a `finally`, so a failed assertion never
 *    leaks fake timers into a later test in the same file.
 *  - EVERY `advanceTimersByTimeAsync` CALL IS WRAPPED IN REACT's `act()`. The
 *    click itself flushes its resulting state update fine on its own — it
 *    crosses a real Playwright/CDP round trip, which gives React's scheduler
 *    a genuine macrotask boundary to flush against. A `setState` made from
 *    INSIDE a callback the FAKE clock fires, by contrast, runs synchronously
 *    within the test's own JS turn, with no such boundary — confirmed by a
 *    minimal repro: without `act()`, `firedCount` (a plain counter alongside
 *    the `setCopied(false)` call) incremented correctly, proving the
 *    `setTimeout` callback DID run, while `data-copied` still read `"true"` in
 *    the DOM immediately after — a real update-scheduled-but-not-yet-committed
 *    gap, not a timer that failed to fire. `act()` forces the pending commit
 *    before the assertion reads the DOM.
 */

/** Advances the fake clock and flushes the React commit it triggers. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Stubs `navigator.clipboard.writeText`; returns a restore function. */
function stubClipboard(impl: (text: string) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return {
    writeText,
    restore: () => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    },
  };
}

describe("CopyButton (browser)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a real button, decoratively iconed, named from `title`", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy to slack" />);

      const button = screen.getByRole("button", { name: "copy to slack" });
      await expect.element(button).toBeVisible();
      expect(screen.container.querySelector("svg")).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("writes `text` to the clipboard on click", async () => {
    const { writeText, restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="mr-board/mr!42" title="copy link" />);
      await screen.getByRole("button", { name: "copy link" }).click();

      expect(writeText).toHaveBeenCalledExactlyOnceWith("mr-board/mr!42");
    } finally {
      restore();
    }
  });

  it("flashes copied for 1200ms, then reverts — icon, title, and data-copied together", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" />);
      const button = screen.getByRole("button", { name: "copy" }).element() as HTMLElement;

      expect(button.hasAttribute("data-copied")).toBe(false);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await screen.getByRole("button", { name: "copy" }).click();
      // Flush the clipboard promise's microtask (setCopied(true) + the
      // setTimeout(1200) registration) without advancing the clock yet.
      await advance(0);

      expect(button.getAttribute("data-copied")).toBe("true");
      expect(button.getAttribute("title")).toBe("copied");

      await advance(1199);
      expect(button.hasAttribute("data-copied")).toBe(true);

      // A few ms of slack past the 1200ms boundary rather than pinning the
      // exact millisecond: the point is "reverts around 1200ms", not
      // asserting the fake-timer engine's own >= vs > firing semantics.
      await advance(50);
      expect(button.hasAttribute("data-copied")).toBe(false);
      expect(button.getAttribute("title")).toBe("copy");
    } finally {
      restore();
    }
  });

  it("swaps the icon glyph while copied (CHECK_ICON), and back (COPY_ICON)", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" />);
      const before = screen.container.querySelector("svg path")?.getAttribute("d");

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await screen.getByRole("button", { name: "copy" }).click();
      await advance(0);

      const during = screen.container.querySelector("svg path")?.getAttribute("d");
      expect(during).not.toBe(before);

      await advance(1250);
      const after = screen.container.querySelector("svg path")?.getAttribute("d");
      expect(after).toBe(before);
    } finally {
      restore();
    }
  });

  it("renders the optional label beside the icon, swapped to 'copied' during the flash", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" label="copy link" />);
      const button = screen.getByRole("button", { name: "copy" }).element() as HTMLElement;
      expect(button.querySelector("span")?.textContent).toBe("copy link");

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await screen.getByRole("button", { name: "copy" }).click();
      await advance(0);

      expect(button.querySelector("span")?.textContent).toBe("copied");
    } finally {
      restore();
    }
  });

  it("omits the label slot entirely when no label is passed", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" />);
      expect(screen.container.querySelector("span")).toBeNull();
    } finally {
      restore();
    }
  });

  it("swallows a rejected clipboard write without throwing or flashing", async () => {
    const { restore } = stubClipboard(() => Promise.reject(new Error("denied")));
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" />);
      const button = screen.getByRole("button", { name: "copy" }).element() as HTMLElement;

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await screen.getByRole("button", { name: "copy" }).click();
      await advance(0);

      expect(button.hasAttribute("data-copied")).toBe(false);
    } finally {
      restore();
    }
  });

  it("stamps its data-part (the kit's cross-boundary hook)", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" />);
      expect(screen.container.querySelectorAll('[data-part="copybutton"]')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("a consumer-supplied data-part does not win", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(
        <CopyButton text="hello" title="copy" data-part="hijacked" />,
      );
      const button = screen.getByRole("button", { name: "copy" }).element() as HTMLElement;

      expect(button.getAttribute("data-part")).toBe("copybutton");
      expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("applies its layered stylesheet to the rendered element", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" />);
      const button = screen.getByRole("button", { name: "copy" }).element() as HTMLElement;

      const style = getComputedStyle(button);
      expect(style.display).toBe("inline-flex");
      expect(style.cursor).toBe("pointer");
      // tuiTheme: --radius-md is 6px.
      expect(style.borderTopLeftRadius).toBe("6px");
    } finally {
      restore();
    }
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const screen = await renderWithTheme(<CopyButton text="hello" title="copy" m="md" />);
      const button = screen.getByRole("button", { name: "copy" }).element() as HTMLElement;

      // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
      expect(getComputedStyle(button).marginTop).toBe("9.6px");
    } finally {
      restore();
    }
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    const { restore } = stubClipboard(() => Promise.resolve());
    try {
      const extended = createTheme({
        extends: tuiTheme,
        components: [CopyButton.extend({ defaultProps: { title: "themed default" } })],
      });

      // KNOWN TYPE GAP (see Segmented.test.tsx's identical case): defaultProps
      // supplied through the theme has no static reflection back onto the
      // required own-prop type, so omitting `title` to prove it comes from
      // the theme still needs a cast — the runtime path (`useProps` merging
      // defaults before render) works regardless.
      const props = { text: "hello" } as unknown as CopyButtonProps;
      const screen = await renderWithTheme(<CopyButton {...props} />, undefined, extended);

      expect(screen.getByRole("button", { name: "themed default" })).toBeTruthy();
    } finally {
      restore();
    }
  });
});
