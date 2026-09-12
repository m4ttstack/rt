const ICON = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  'aria-hidden': true,
  style: { verticalAlign: '-2.5px', flexShrink: 0 } as const,
};

export function SlackLogo() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      aria-hidden
      style={ICON.style}
    >
      <path
        fill="#E01E5A"
        d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z"
      />
      <path
        fill="#36C5F0"
        d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z"
      />
      <path
        fill="#2EB67D"
        d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z"
      />
      <path
        fill="#ECB22E"
        d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z"
      />
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
