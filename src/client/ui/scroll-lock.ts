/** Counter-based body-scroll lock: any number of Modal/SideDrawer instances
    can be open at once, and they don't have to unmount in the order they
    mounted -- e.g. no focus trap exists today, so a keyboard user can open a
    Modal over an open drawer, then a background poll can drop the drawer's
    row and force-unmount it before the Modal closes. A "restore what I saw"
    scheme (each instance snapshotting overflow at its own mount and writing
    that back at its own unmount) breaks under that ordering: the later-
    closing instance restores the value it saw mid-lock ("hidden"), leaving
    the page stuck unscrollable after everything has closed.

    A shared counter fixes this: the original value is captured only on the
    0->1 transition (the first lock) and restored only on the 1->0 transition
    (the last unlock), so unmount order can't matter -- only the count does.

    Takes a target rather than touching `document.body.style` directly so
    this counting logic is unit-testable without a DOM (see layers.ts for
    the same split: pure stack logic here, the DOM-touching hook in
    hooks.ts). */
interface OverflowTarget {
  overflow: string;
}

let lockCount = 0;
let savedOverflow = "";

/** Take one lock. On the first concurrent lock, snapshots `target.overflow`
    and sets it to "hidden". Later calls just bump the count. */
function acquireScrollLock(target: OverflowTarget): void {
  if (lockCount === 0) {
    savedOverflow = target.overflow;
    target.overflow = "hidden";
  }
  lockCount++;
}

/** Release one lock. Only once the count returns to zero -- every concurrent
    locker has released -- is `target.overflow` restored to the value seen
    before the first lock. */
function releaseScrollLock(target: OverflowTarget): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    target.overflow = savedOverflow;
  }
}

export { acquireScrollLock, releaseScrollLock };
export type { OverflowTarget };
