import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import {
  Button,
  Icon,
  useBodyScrollLock,
  useEscapeClose,
} from '@mattstack/tui-kit';
import type { TriageGateState } from './DecisionQueueModal.tsx';

export interface GateSheetQueue {
  /** 0-based position of the active gate in the queue. */
  index: number;
  total: number;
  states: TriageGateState[];
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** "!ref · title" of the gate after this one; omit on the last. */
  nextPeek?: string;
}

/** Paging remounts the face (the host keys it by gate), so the pressed
    chevron and the queue's original opener cross that remount here: the
    outgoing sheet records its opener instead of refocusing it, and the
    incoming one focuses the same chevron. The incoming sheet clears it a
    task later, not on read, because StrictMode mounts effects twice. */
let navHandoff: { label: string; opener: HTMLElement | null } | null = null;

/** The one full-screen frame every decision-queue face renders in: the head
    (title, gate-level actions, queue nav, tag, close) and a body the caller
    fills. */
function GateSheet({
  variant,
  ariaLabel,
  actions,
  queue,
  tag,
  onClose,
  children,
}: {
  variant: 'review' | 'respond' | 'triage';
  ariaLabel: string;
  actions?: ReactNode;
  queue?: GateSheetQueue;
  tag?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = () => {
    navHandoff = null;
    onClose();
  };
  useEscapeClose(close);
  useBodyScrollLock();

  // aria-modal alone does not fence keyboard focus: take focus on mount,
  // keep Tab cycling inside, and hand focus back to the opener on unmount.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const carried = navHandoff;
    const settle = carried
      ? setTimeout(() => {
          if (navHandoff === carried) navHandoff = null;
        }, 0)
      : undefined;
    const opener = carried
      ? carried.opener
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const pressed = carried
      ? sheetRef.current?.querySelector<HTMLButtonElement>(
          `[aria-label="${carried.label}"]`
        )
      : null;
    (pressed && !pressed.disabled ? pressed : sheetRef.current)?.focus();
    return () => {
      clearTimeout(settle);
      if (navHandoff) navHandoff.opener = opener;
      else opener?.focus({ preventScroll: true });
    };
  }, []);
  const page = (label: string, go: () => void) => () => {
    navHandoff = { label, opener: null };
    go();
  };
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = sheetRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const atStart =
      document.activeElement === first || document.activeElement === root;
    if (e.shiftKey && atStart) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`tui-gate-sheet tui-${variant}-sheet`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      ref={sheetRef}
      onKeyDown={trapTab}
    >
      <header className="tui-gate-sheet-head">
        <span className="tui-gate-sheet-lead">
          <span className="tui-gate-sheet-title">decision queue</span>
          {actions && <span className="tui-gate-sheet-actions">{actions}</span>}
        </span>
        {queue ? (
          <nav className="tui-gate-queue-nav" aria-label="gate queue">
            <Button
              type="button"
              iconOnly
              variant="default"
              size="sm"
              onClick={page('previous gate', queue.onPrev)}
              disabled={!queue.canPrev}
              title="previous gate"
              aria-label="previous gate"
            >
              <Icon d="m15 18-6-6 6-6" />
            </Button>
            <span className="tui-gate-queue-where">
              <span
                className="tui-gate-queue-pos"
                title={queue.nextPeek ? `next: ${queue.nextPeek}` : undefined}
              >
                {queue.index + 1} of {queue.total}
              </span>
              <span className="tui-gate-queue-pips">
                {queue.states.map((s, i) => (
                  <i key={i} className="tui-gate-queue-pip" data-state={s} />
                ))}
              </span>
            </span>
            <Button
              type="button"
              iconOnly
              variant="default"
              size="sm"
              onClick={page('next gate', queue.onNext)}
              disabled={!queue.canNext}
              title="next gate"
              aria-label="next gate"
            >
              <Icon d="m9 18 6-6-6-6" />
            </Button>
          </nav>
        ) : (
          <span />
        )}
        <span className="tui-gate-sheet-trail">
          {tag && <span className="tui-gate-sheet-tag">{tag}</span>}
          <button
            type="button"
            className="tui-gate-sheet-close"
            onClick={close}
            aria-label="close"
          >
            ✕
          </button>
        </span>
      </header>
      {children}
    </div>
  );
}

export { GateSheet };
