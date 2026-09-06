import { test, expect } from "bun:test";
import { acquireScrollLock, releaseScrollLock } from "@mattstack/tui-kit/hooks";
import type { OverflowTarget } from "@mattstack/tui-kit/hooks";

test("two acquires + out-of-order releases restore the original value exactly once", () => {
  const target: OverflowTarget = { overflow: "visible" };
  acquireScrollLock(target); // drawer opens
  expect(target.overflow).toBe("hidden");
  acquireScrollLock(target); // modal opens over it; body's already hidden
  expect(target.overflow).toBe("hidden");
  // Drawer force-unmounts first (out of the order it mounted in) -- the
  // modal is still open, so the lock must hold.
  releaseScrollLock(target);
  expect(target.overflow).toBe("hidden");
  // Modal closes last -- only now does the original value come back, and
  // only once.
  releaseScrollLock(target);
  expect(target.overflow).toBe("visible");
});

test("releases in mount order also restore exactly once", () => {
  const target: OverflowTarget = { overflow: "auto" };
  acquireScrollLock(target);
  acquireScrollLock(target);
  releaseScrollLock(target); // last-in releases first
  expect(target.overflow).toBe("hidden");
  releaseScrollLock(target); // first-in releases last
  expect(target.overflow).toBe("auto");
});

test("a fresh acquire after full release re-captures the current value", () => {
  const target: OverflowTarget = { overflow: "scroll" };
  acquireScrollLock(target);
  releaseScrollLock(target);
  expect(target.overflow).toBe("scroll");
  // Something else changes the value while nothing holds the lock.
  target.overflow = "clip";
  acquireScrollLock(target);
  expect(target.overflow).toBe("hidden");
  releaseScrollLock(target);
  expect(target.overflow).toBe("clip");
});

test("an extra release past zero is a no-op, not a negative count", () => {
  const target: OverflowTarget = { overflow: "auto" };
  acquireScrollLock(target);
  releaseScrollLock(target);
  expect(target.overflow).toBe("auto");
  releaseScrollLock(target); // stray release with nothing locked
  expect(target.overflow).toBe("auto");
  // The count didn't go negative: one fresh acquire is enough to lock again,
  // it doesn't need to "pay off" a phantom extra release first.
  acquireScrollLock(target);
  expect(target.overflow).toBe("hidden");
  releaseScrollLock(target);
  expect(target.overflow).toBe("auto");
});
