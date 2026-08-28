const BG = '#161224';
const FG = '#FF6B9D';

export interface MattstackMarkProps {
  /** Rendered svg side in px. @default 28 */
  size?: number;
  /** Accessible name / tooltip title. @default 'mattstack' */
  title?: string;
  /** Render as a decorative image: `aria-hidden`, no role/name/title. @default false */
  decorative?: boolean;
}

/**
 * The shared mattstack platform mark, reproduced from the `.app` iconset
 * (`repo-tools/rt-tray/make-icon.swift`): a plum rounded square carrying a
 * monospace `m` beside the lucide-"layers" glyph, both in rose pink. Palette
 * and geometry are parity anchors to the installer/tray icon -- keep them in
 * sync with that source.
 */
export function MattstackMark({
  size = 28,
  title = 'mattstack',
  decorative = false,
}: MattstackMarkProps) {
  return (
    <svg
      {...(decorative
        ? { 'aria-hidden': 'true' }
        : { role: 'img', 'aria-label': title })}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative && <title>{title}</title>}
      <rect width="64" height="64" rx="14.4" fill={BG} />
      <text
        x="13"
        y="40.5"
        fontFamily="'SF Mono', ui-monospace, Menlo, monospace"
        fontSize="25.6"
        fontWeight={500}
        fill={FG}
      >
        m
      </text>
      <g
        transform="translate(31.6 22.4) scale(0.8)"
        fill="none"
        stroke={FG}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2.5 L21.8 7 L12 11.5 L2.2 7 Z" />
        <path d="M2.2 12.3 L12 16.8 L21.8 12.3" />
        <path d="M2.2 17.3 L12 21.8 L21.8 17.3" />
      </g>
    </svg>
  );
}
