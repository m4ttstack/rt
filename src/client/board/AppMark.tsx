/** The board's own mark (mirrors favicon.svg), inline for the header title
    where a literal img/object would need an extra request. Sized in `em` so
    it tracks the surrounding text. */
export function AppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width="1em" height="1em" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1d1830" />
      <circle cx="23" cy="5" r="4" fill="#ff84ad" />
      <line x1="23" y1="9" x2="23" y2="23" stroke="#ff84ad" strokeWidth="4" strokeLinecap="round" />
      <circle cx="23" cy="27" r="4" fill="#ff84ad" />
      <circle cx="7" cy="27" r="4" fill="#a78bfa" />
      <path d="M7 23 V 18 Q 7 12 13 12 H 16" fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 8 L 20 12 L 15 16" fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
