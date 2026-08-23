import { Alert, Badge, Group, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import type { SlotOutlineNode } from './outline';

export interface SlotNodeProps {
  slot: SlotOutlineNode;
}

/**
 * One binder slot under a verb: its contract, whether it resolved, and (if
 * so) the fill that answers it. A `resolveError` renders honestly instead
 * of a fill row -- the slot still failed to resolve even though it never
 * throws, so the row must say so rather than going quietly blank.
 */
export function SlotNode({ slot }: SlotNodeProps) {
  const { text } = useSchemeColors();

  return (
    <Stack gap={4} data-testid="slot-node" pl="md">
      <Group gap="xs">
        <Icons.link size={12} color={text.muted} />
        <Text size="sm" fw={500}>
          {slot.name}
        </Text>
        <Text size="xs" c={text.muted}>
          {slot.contract}
        </Text>
        {slot.required && (
          <Badge size="xs" variant="light" color="gray">
            required
          </Badge>
        )}
        {!slot.boundTo && (
          <Badge size="xs" variant="light" color="gray">
            unbound
          </Badge>
        )}
      </Group>

      {slot.resolveError && (
        <Alert
          variant="light"
          color="bad"
          icon={<Icons.warning size={14} />}
          py={4}
          data-testid="slot-resolve-error"
        >
          <Text size="xs">{slot.resolveError}</Text>
        </Alert>
      )}

      {slot.fill && (
        <Group gap="xs" pl="lg" data-testid="slot-fill">
          <Icons.checkCircle size={12} color={text.muted} />
          <Text size="xs" c={text.muted} truncate>
            {slot.fill.binding}
          </Text>
          {!slot.fill.registered && (
            <Badge size="xs" variant="light" color="warn">
              unregistered
            </Badge>
          )}
        </Group>
      )}

      {slot.boundTo && !slot.fill && !slot.resolveError && (
        <Text size="xs" c={text.dimmed} pl="lg">
          bound to {slot.boundTo} -- no matching fill in this pack
        </Text>
      )}
    </Stack>
  );
}
