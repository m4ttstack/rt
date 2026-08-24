import { Group, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';

export interface AttentionEmptyStateProps {
  pack: string;
  /**
   * How many roster verbs `rt skills check` actually compared, or null when
   * it never answered. Null is the difference between "measured, and clean"
   * and "not measured" -- an empty list means both, and only one of them is
   * good news.
   */
  checkedVerbs: number | null;
}

/**
 * What the filter shows when nothing needs attention: the outcome this
 * surface exists to reach, said as a result rather than as a blank panel.
 * The second line states what was compared, so "empty" reads as measured --
 * and never claims to cover pipeline stages, which `rt skills check` does
 * not.
 */
export function AttentionEmptyState({
  pack,
  checkedVerbs,
}: AttentionEmptyStateProps) {
  const { text } = useSchemeColors();

  if (checkedVerbs === null) {
    return (
      <Stack gap={4} py="xl" data-testid="attention-empty">
        <Text fw={600} size="lg">
          Nothing to show.
        </Text>
        <Text size="xs" c={text.muted}>
          rt skills check did not answer for {pack}, so no row could state its
          drift. This list is empty because nothing was measured, not because
          nothing has drifted.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={4} py="xl" data-testid="attention-empty">
      <Group gap="xs" wrap="nowrap">
        <Icons.checkCircle size={18} color={text.highContrast('ok')} />
        <Text fw={600} size="lg" c={text.highContrast('ok')}>
          Nothing needs attention.
        </Text>
      </Group>
      <Text size="xs" c={text.muted}>
        rt skills check compared {checkedVerbs}{' '}
        {checkedVerbs === 1 ? 'roster verb' : 'roster verbs'} in {pack} against
        a fresh compile; none differed. Pipeline stages compile into the
        orchestrator rather than to artifacts of their own, so check does not
        cover them.
      </Text>
    </Stack>
  );
}
