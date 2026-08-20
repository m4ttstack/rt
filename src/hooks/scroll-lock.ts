/** Counter-based, because instances need not unmount in mount order: a Modal
    can open over a drawer that a background poll then force-unmounts first. A
    per-instance "restore what I saw" scheme breaks under that ordering — the
    later-closing instance restores the value it saw mid-lock ("hidden"),
    leaving the page permanently unscrollable. Capturing on the 0->1 transition
    and restoring on 1->0 makes only the count matter.

    Takes a target rather than touching `document.body.style` so the counting
    is unit-testable without a DOM. */
interface OverflowTarget {
  overflow: string;
}

let lockCount = 0;
let savedOverflow = "";

/** Take one lock. The first snapshots `target.overflow` and sets it to
    "hidden"; later calls just bump the count. */
function acquireScrollLock(target: OverflowTarget): void {
  if (lockCount === 0) {
    savedOverflow = target.overflow;
    target.overflow = "hidden";
  }
  lockCount++;
}

/** Release one lock. `target.overflow` is restored only when the count returns
    to zero, i.e. every concurrent locker has released. */
function releaseScrollLock(target: OverflowTarget): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    target.overflow = savedOverflow;
  }
}

export { acquireScrollLock, releaseScrollLock };
export type { OverflowTarget };
