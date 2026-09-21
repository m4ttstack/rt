import { Box } from '@mattstack/app-kit/core';

export const STATUS_TEXT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--mantine-color-ok-text)',
  idle: 'var(--mantine-color-warn-text)',
};

export const DOT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--tk-fill-ok)',
  idle: 'var(--tk-fill-warn)',
};

/** `.doing` and every other extra-small meta line. Used to have a dimmer
    `MUTED_XS_DIM` sibling for a `kind: 'path'` task line, back when
    `--tk-muted`/`--tk-muted-text` were two different shades; the mapping
    table bands both aliases onto the same role token in `color`, so that
    distinction is gone by design -- one constant now covers every small
    meta line regardless of task kind. */
export const MUTED_XS = {
  fontSize: 'var(--tk-fs-3xs)',
  color: 'var(--tk-text-4)',
} as const;

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
        // A pill on a 14px chip, and the artboards' smallest type step --
        // neither lands on a Mantine radius or font-size token.
        borderRadius: 7,
        fontSize: 'var(--tk-fs-5xs)',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        border: `1px solid ${
          isDm
            ? 'color-mix(in srgb, var(--tk-fill-purple) 45%, transparent)'
            : 'var(--tk-border-soft)'
        }`,
        color: isDm ? 'var(--tk-text-purple-small)' : 'var(--tk-text-4)',
      }}
    >
      {isDm ? 'dm' : `#${room}`}
    </Box>
  );
}
