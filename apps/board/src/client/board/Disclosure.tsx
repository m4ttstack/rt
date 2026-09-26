import type { KeyboardEvent, ReactNode } from 'react';

import { ICONS } from '@mattstack/tui-kit';

/** A collapsible body that animates height via grid-template-rows, so
    content of any height opens and closes smoothly without measuring. The
    body stays mounted either way (a half-typed field survives a collapse) and
    is `inert` while closed so nothing inside can take focus. tui-kit
    candidate: layout only, no board logic. */
export function Disclosure({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div className={'tui-disclosure' + (open ? ' open' : '')}>
      <div className="tui-disclosure-body" inert={!open}>
        {children}
      </div>
    </div>
  );
}

/** The whole header row is the trigger, chevron included: a row's title is a
    far bigger target than a glyph. Controls that live inside the row (an info
    tip, a clear button) stop propagation so they don't toggle. A div with the
    button role rather than a button, because those inner controls are
    buttons themselves and buttons cannot nest. */
export function DisclosureHead({
  open,
  label,
  onToggle,
  className,
  children,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <div
      className={
        'tui-disclosure-head' +
        (open ? ' open' : '') +
        (className ? ` ${className}` : '')
      }
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${open ? 'collapse' : 'expand'} ${label}`}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="tui-disclosure-chevron" aria-hidden="true">
        {ICONS['chevron-right']}
      </span>
      {children}
    </div>
  );
}
