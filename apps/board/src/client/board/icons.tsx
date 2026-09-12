const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  'aria-hidden': true,
  style: { verticalAlign: '-2.5px', flexShrink: 0 } as const,
};

const SLACK_TILES: Array<[brand: string, d: string]> = [
  ['#E01E5A', 'M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z'],
  ['#36C5F0', 'M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z'],
  [
    '#2EB67D',
    'M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z',
  ],
  [
    '#ECB22E',
    'M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z',
  ],
];

/** The Slack squircle: brand colours by default, `mono` paints every tile
    in currentColor for a control that carries its own state colour. */
export function SlackLogo({ mono = false }: { mono?: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
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

export function Eyes() {
  return (
    <svg {...ICON} fill="currentColor">
      <ellipse cx="4.6" cy="8" rx="3.1" ry="5.2" />
      <ellipse cx="11.4" cy="8" rx="3.1" ry="5.2" />
      <circle cx="4" cy="9" r="1.4" fill="var(--bg)" />
      <circle cx="10.8" cy="9" r="1.4" fill="var(--bg)" />
    </svg>
  );
}

export function Bubble() {
  return (
    <svg {...ICON} fill="currentColor">
      <path d="M2.5 2.5h11a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H8.4L5 14.5v-3H2.5a1.2 1.2 0 0 1-1.2-1.2V3.7a1.2 1.2 0 0 1 1.2-1.2z" />
      <circle cx="5.6" cy="7" r="1.05" fill="var(--bg)" />
      <circle cx="10.4" cy="7" r="1.05" fill="var(--bg)" />
    </svg>
  );
}

export function DiscCheck() {
  return (
    <svg {...ICON} fill="currentColor">
      <circle cx="8" cy="8" r="6.6" />
      <path
        d="M5.1 8.3l1.9 1.9 3.9-4.5"
        fill="none"
        stroke="var(--bg)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
