import type { FlagKey } from '../../view.ts';

const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  'aria-hidden': true,
  style: { verticalAlign: '-2.5px', flexShrink: 0 } as const,
};

// Geometry from Slack's own brand assets (../../assets/slack/SLA-Slack-icon-*.svg);
// each tile's two paths carried verbatim, just merged into one `d`.
const SLACK_TILES: Array<[brand: string, d: string]> = [
  [
    '#E3066A',
    'M84.039,252.769c0,23.127-18.893,42.02-42.02,42.02S0,275.896,0,252.769s18.893-42.02,42.02-42.02h42.02v42.02Z M105.212,252.769c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02v105.212c0,23.127-18.893,42.02-42.02,42.02s-42.02-18.893-42.02-42.02c0,0,0-105.212,0-105.212Z',
  ],
  [
    '#00B3FF',
    'M147.231,84.039c-23.127,0-42.02-18.893-42.02-42.02S124.104,0,147.231,0s42.02,18.893,42.02,42.02v42.02h-42.02Z M147.231,105.212c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02H42.02c-23.127,0-42.02-18.893-42.02-42.02s18.893-42.02,42.02-42.02c0,0,105.212,0,105.212,0Z',
  ],
  [
    '#41B658',
    'M315.961,147.231c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02-18.893,42.02-42.02,42.02h-42.02v-42.02Z M294.788,147.231c0,23.127-18.893,42.02-42.02,42.02s-42.02-18.893-42.02-42.02V42.02c0-23.127,18.893-42.02,42.02-42.02s42.02,18.893,42.02,42.02v105.212Z',
  ],
  [
    '#FCC003',
    'M252.769,315.961c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02-42.02-18.893-42.02-42.02v-42.02h42.02Z M252.769,294.788c-23.127,0-42.02-18.893-42.02-42.02s18.893-42.02,42.02-42.02h105.212c23.127,0,42.02,18.893,42.02,42.02s-18.893,42.02-42.02,42.02h-105.212Z',
  ],
];

/** The Slack squircle: brand colours by default, `mono` paints every tile
    in currentColor for a control that carries its own state colour. */
export function SlackLogo({ mono = false }: { mono?: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 400 400"
      aria-hidden
      style={ICON.style}
    >
      {SLACK_TILES.map(([brand, d]) => (
        <path key={brand} fill={mono ? 'currentColor' : brand} d={d} />
      ))}
    </svg>
  );
}

export function LinearLogo() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="13"
      height="13"
      fill="currentColor"
      aria-hidden
    >
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1783c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99128 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3904.3487-.984.3258-1.3541-.0443L12.6587 18.074Z" />
    </svg>
  );
}

export function Sun() {
  return (
    <svg
      {...ICON}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="3.3" stroke="none" />
      <path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2M3.2 3.2l1.6 1.6M11.2 11.2l1.6 1.6M12.8 3.2l-1.6 1.6M4.8 11.2l-1.6 1.6" />
    </svg>
  );
}

const GLYPH = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  style: { flexShrink: 0 } as const,
} as const;

const FLAG_PATHS: Record<FlagKey, string> = {
  draft: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  'auto-merge':
    'M4 14a1 1 0 0 1-.8-1.6l8.7-10.5a.5.5 0 0 1 .9.4l-1.3 6.9h7.5a1 1 0 0 1 .8 1.6l-8.7 10.5a.5.5 0 0 1-.9-.4l1.3-6.9Z',
  conflicts:
    'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21V9a9 9 0 0 0 9 9',
  'ci-failing': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM15 9l-6 6M9 9l6 6',
  'ci-running': 'M21 12a9 9 0 1 1-6.2-8.6',
  'stood-down': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM10 9v6M14 9v6',
  stacked:
    'M12.8 2.2a2 2 0 0 0-1.7 0L2.9 6.1a1 1 0 0 0 0 1.8l8.2 3.9a2 2 0 0 0 1.7 0l8.2-3.9a1 1 0 0 0 0-1.8ZM2.3 15.4l9 4.3a2 2 0 0 0 1.5 0l9-4.3M2.3 10.9l9 4.3a2 2 0 0 0 1.5 0l9-4.3',
};

/** The header line's flag icon, 12px, in the flag's own color. */
export function FlagGlyph({ kind }: { kind: FlagKey }) {
  return (
    <svg {...GLYPH}>
      <path d={FLAG_PATHS[kind]} />
    </svg>
  );
}

export function ArrowDownGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}

export function ArrowOutGlyph() {
  return (
    <svg {...GLYPH} width={11} height={11}>
      <path d="M7 7h10v10M7 17 17 7" />
    </svg>
  );
}

export function MessageGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** The row note's mark (B10): a sticky note with its corner folded, drawn
    at the same 13px the row's other tools use. */
export function NoteGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg {...GLYPH} width={size} height={size}>
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2Z" />
      <path d="M14 21v-5a2 2 0 0 1 2-2h5" />
      <path d="M7 8h8M7 12h5" />
    </svg>
  );
}

const MENU_PATHS = {
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8',
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  branch:
    'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15 6a9 9 0 0 0-9 9',
  dismiss: 'M18 6 6 18M6 6l12 12',
  note: 'M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2ZM14 21v-5a2 2 0 0 1 2-2h5M7 8h8M7 12h5',
  checks: 'M3 17l2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8',
  chevron: 'M6 9l6 6 6-6',
} as const;

/** The row menu's non-agent icons: what a click lands on, in place of the
    old trailing "gitlab" / "herdr" hints. */
export function MenuGlyph({ kind }: { kind: keyof typeof MENU_PATHS }) {
  return (
    <svg {...GLYPH} width={13} height={13}>
      <path d={MENU_PATHS[kind]} />
    </svg>
  );
}

/** The agent mark on a verb that launches or jumps into an agent pane. */
export function AgentGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
  );
}

/** The review sheet's record-cluster row icons (DEPTH/EVIDENCE/NOTES):
    lucide-react 1.34.0 path data (ISC licensed, https://lucide.dev), drawn
    inline rather than adding lucide as a dependency. */
const RECORD_ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  style: { flexShrink: 0 } as const,
} as const;

/** Strengths' mark: circle-check with the disc filled in currentColor and
    the check knocked out, matching the mock's solid green badge. */
export function CircleCheckFilledIcon() {
  return (
    <svg {...RECORD_ICON} stroke="none">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="m9 12 2 2 4-4"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Broken link: marks a finding whose location is prose rather than a diff
    anchor, so the label beside it never reads as a file path. */
export function NoAnchorIcon() {
  return (
    <svg {...RECORD_ICON} width={12} height={12}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 4 8" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function SearchCheckIcon() {
  return (
    <svg {...RECORD_ICON}>
      <path d="m8 11 2 2 4-4" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg {...RECORD_ICON}>
      <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export function PencilLineIcon() {
  return (
    <svg {...RECORD_ICON}>
      <path d="M13 21h8" />
      <path d="m15 5 4 4" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  );
}
