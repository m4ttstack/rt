import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { modals } from '@mattstack/app-kit/modals';

import { issueWhere, type DivergedIssue } from './issues';
import { JsonBlock } from './JsonBlock';

/** An older store name that changed after the current one was written.
    Removing it goes through settings-kit's prune, forced, since a diverged
    name is refused otherwise; until then the issue stays listed. */
export function DivergedPanel({
  issue,
  onPrune,
}: {
  issue: DivergedIssue;
  onPrune: () => void;
}) {
  const { text } = useSchemeColors();
  return (
    <Stack
      gap={6}
      py={10}
      style={{ borderBottom: '1px solid var(--tk-border-soft)' }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text fz={12} c="var(--tk-text-warn-small)">
          {`${issueWhere(issue)} · the older name ${issue.storeName} still holds a different value`}
        </Text>
        <Button
          size="compact-xs"
          variant="default"
          onClick={() =>
            modals.confirm({
              title: `Remove ${issue.storeName}`,
              destructive: true,
              labels: { confirm: 'Remove' },
              message: (
                <Stack gap={8}>
                  <Text fz={14}>
                    {`Deletes ${issue.storeName} and its baseline from the ${issueWhere(issue)} store. The current value stays. This older value goes:`}
                  </Text>
                  <JsonBlock value={issue.olderValue} maxHeight={200} />
                </Stack>
              ),
              onConfirm: onPrune,
            })
          }
        >
          Remove the older name
        </Button>
      </Group>
      <Text fz={12} c={text.muted}>
        Fix a layer above to keep either value; Save always writes the current
        name.
      </Text>
    </Stack>
  );
}
