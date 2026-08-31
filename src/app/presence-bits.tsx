import { Box } from '@mattstack/app-kit/core';

export const STATUS_TEXT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--mantine-color-ok-text)',
  idle: 'var(--mantine-color-warn-text)',
};

export const DOT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--tk-dot-ok)',
  idle: 'var(--tk-dot-warn)',
};

export function headTruncatePath(cwd: string): string {
  const segments = cwd.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? cwd;
  return `…/${leaf}`;
}

export function Tag({ handle, room }: { handle: string; room: string }) {
  const isDm = room === 'dm';
  return (
    <Box
      component="span"
      data-testid={`tag-${handle}-${room}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 14,
        padding: '0 var(--mantine-spacing-xs)',
        borderRadius: 'var(--mantine-radius-md)',
        fontSize: 'var(--tk-fs-4xs)',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        border: `1px solid ${
          isDm
            ? 'color-mix(in srgb, var(--tk-purple) 45%, transparent)'
            : 'var(--tk-border-soft)'
        }`,
        color: isDm ? 'var(--tk-purple)' : 'var(--tk-muted-text)',
      }}
    >
      {isDm ? 'dm' : `#${room}`}
    </Box>
  );
}
