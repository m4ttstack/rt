import { Badge, Box } from '@mattstack/app-kit/core';

import type { StoreScope } from './view';

export const SCOPE_COLOR: Record<StoreScope, string> = {
  team: 'purple',
  user: 'cyan',
  machine: 'accent',
};

export function ScopeDot({ scope }: { scope: StoreScope }) {
  return (
    <Box
      component="span"
      w={6}
      h={6}
      style={{
        display: 'inline-block',
        borderRadius: '50%',
        flex: 'none',
        background: `var(--mantine-color-${SCOPE_COLOR[scope]}-filled)`,
      }}
    />
  );
}

export function ScopeBadge({ scope }: { scope: StoreScope }) {
  return (
    <Badge
      variant="light"
      color={SCOPE_COLOR[scope]}
      radius="sm"
      tt="none"
      fw={500}
      lts={0}
      c={`var(--tk-text-${SCOPE_COLOR[scope]}-small)`}
      leftSection={<ScopeDot scope={scope} />}
      style={{
        '--badge-height': '17px',
        '--badge-fz': '12px',
        '--badge-padding-x': '6px',
        paddingInlineStart: 5,
      }}
      styles={{ section: { marginInlineEnd: 4 } }}
    >
      {scope}
    </Badge>
  );
}
