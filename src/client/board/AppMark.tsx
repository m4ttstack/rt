/** The board's own mark, mirroring favicon.svg: console's web recipe
    (32-unit tile, pink canvas, dark glyph) with a kanban-columns pictograph
    in place of console's chevron. Same component shape as console's and
    chat's own AppMark (fixed pixel size, not text-relative) so the family
    stays consistent across apps. */
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
      <rect x="7.25" y="6" width="4.5" height="19" rx="2.2" fill="#1d1830" />
      <rect x="13.75" y="13" width="4.5" height="12" rx="2.2" fill="#1d1830" />
      <rect x="20.25" y="9" width="4.5" height="16" rx="2.2" fill="#1d1830" />
    </svg>
  );
}
