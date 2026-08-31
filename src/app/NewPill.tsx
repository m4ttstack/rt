import { UnstyledButton } from '@mattstack/app-kit/core';

const ACCENT_TEXT = 'var(--mantine-color-accent-text)';

export interface NewPillProps {
  /** Live arrivals since the viewer scrolled away; 0 reads `latest`. */
  count: number;
  onClick: () => void;
}

/** The follow control, with the one fact a reader who scrolled up wants:
    how much arrived meanwhile. Opaque, so it reads over any message. */
export function NewPill({ count, onClick }: NewPillProps) {
  return (
    <UnstyledButton
      data-testid="new-pill"
      aria-label={
        count > 0 ? `${count} new messages, jump to latest` : 'Jump to latest'
      }
      onClick={onClick}
      style={{
        position: 'absolute',
        right: 30,
        bottom: 30,
        zIndex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--mantine-spacing-xs)',
        height: 26,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-xl)',
        fontSize: 'var(--tk-fs-3xs)',
        fontWeight: 600,
        color: ACCENT_TEXT,
        background: `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), var(--tk-card))`,
        border: `1px solid color-mix(in srgb, ${ACCENT_TEXT} 45%, transparent)`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}
    >
      ↓ {count > 0 ? `${count} new` : 'latest'}
    </UnstyledButton>
  );
}
