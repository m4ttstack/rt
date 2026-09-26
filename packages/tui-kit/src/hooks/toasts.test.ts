import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { useToasts } from "./index.ts";

/**
 * useToasts is a real React hook (useState/useRef/useCallback), and this file
 * lives in the node tier (no DOM/jsdom here -- see vitest.node.config.ts).
 * react-test-renderer renders to a plain JS object tree rather than the DOM,
 * so it can drive the hook's state through act() without a browser.
 *
 * The harness component stashes the hook's latest return value into `latest`
 * on every render; tests read `latest` after each act() to see the settled
 * state.
 */
function renderUseToasts() {
  let latest!: ReturnType<typeof useToasts>;
  function Harness() {
    latest = useToasts();
    return null;
  }
  act(() => {
    create(createElement(Harness));
  });
  return {
    get current() {
      return latest;
    },
  };
}

describe("useToasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("addToast assigns increasing ids", () => {
    const hook = renderUseToasts();
    act(() => {
      hook.current.addToast("first");
    });
    act(() => {
      hook.current.addToast("second");
    });
    expect(hook.current.toasts).toEqual([
      { id: 1, text: "first" },
      { id: 2, text: "second" },
    ]);
  });

  it("entries drop after the 3500ms timeout", () => {
    const hook = renderUseToasts();
    act(() => {
      hook.current.addToast("hello");
    });
    expect(hook.current.toasts).toEqual([{ id: 1, text: "hello" }]);

    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(hook.current.toasts).toEqual([{ id: 1, text: "hello" }]);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.current.toasts).toEqual([]);
  });

  it("removes only the timed-out toast, leaving later ones", () => {
    const hook = renderUseToasts();
    act(() => {
      hook.current.addToast("early");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      hook.current.addToast("late");
    });
    // "early" was added at t=0, "late" at t=1000; advance to just past
    // early's 3500ms deadline (t=3501) but well before late's (t=4500).
    act(() => {
      vi.advanceTimersByTime(2501);
    });
    expect(hook.current.toasts).toEqual([{ id: 2, text: "late" }]);
  });
});
