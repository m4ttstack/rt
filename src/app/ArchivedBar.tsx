import { Button, Group, Text } from '@mattstack/app-kit/core';

import { dayLabel } from './day-label';

export interface ArchivedBarProps {
  archivedAt: number;
  onReopen: () => void;
  /** Phone chrome: the panel surface and 44px controls. @default false */
  phone?: boolean;
}

/** What replaces the composer on an archived room: when, a reassurance
    that nobody lost their place, and the one way back. */
export function ArchivedBar({
  archivedAt,
  onReopen,
  phone = false,
}: ArchivedBarProps) {
  return (
    <Group
      data-testid="archived-bar"
      justify="space-between"
      wrap="nowrap"
      style={{
        height: 44,
        flex: 'none',
        padding: phone
          ? '0 var(--mantine-spacing-lg)'
          : '0 var(--mantine-spacing-md)',
        marginTop: phone ? 0 : 'var(--mantine-spacing-xs)',
        background: phone ? 'var(--tk-panel)' : undefined,
        borderTop: `1px solid ${phone ? 'var(--tk-border)' : 'var(--tk-border-soft)'}`,
      }}
    >
      <Text
        size="xs"
        truncate
        style={{ color: 'var(--tk-muted-text)', minWidth: 0 }}
      >
        Archived {dayLabel(archivedAt)} · everyone keeps their place
      </Text>
      <Button
        size="xs"
        variant="default"
        radius="md"
        data-testid="archived-reopen"
        onClick={onReopen}
        style={{ flex: 'none', height: phone ? 36 : undefined }}
      >
        Reopen
      </Button>
    </Group>
  );
}
