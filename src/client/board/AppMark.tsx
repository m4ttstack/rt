/** The board's own mark, mirroring favicon.svg: console's web recipe
    (32-unit tile, pink canvas, dark glyph) with a merge pictograph in place
    of console's chevron -- board is a merge-request queue, and a kanban-bar
    reading first landed here read as a generic graph icon. Same component
    shape as console's and chat's own AppMark (fixed pixel size, not
    text-relative) so the family stays consistent across apps. The header
    that renders this must be a flex row (not plain inline text) since the
    svg's own `display: block` breaks onto its own line inside inline flow. */
export function AppMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", display: "block" }}
    >
      <rect width="32" height="32" rx="7.2" fill="#ff84ad" />
      <circle cx="22" cy="7" r="4" fill="#1d1830" />
      <line x1="22" y1="11" x2="22" y2="21" stroke="#1d1830" strokeWidth="5" strokeLinecap="round" />
      <circle cx="22" cy="25" r="4" fill="#1d1830" />
      <circle cx="8" cy="25" r="4" fill="#1d1830" />
      <path d="M8 21 V17 Q8 12 13 12 H22" fill="none" stroke="#1d1830" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
