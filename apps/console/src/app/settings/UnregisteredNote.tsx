import { Box, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import type { Unregistered } from './useConsoleSettings';

/** Keys found in a store that no registry def names, so no reader sees
    them. */
export function UnregisteredNote({ entries }: { entries: Unregistered[] }) {
  const { text } = useSchemeColors();
  if (entries.length === 0) return null;
  const n = entries.length;
  return (
    <Box pt={28} data-testid="unregistered-note">
      <Group gap={8} wrap="nowrap" pb={6}>
        <Icons.info size={14} color={text.muted} />
        <Text fz={12} c={text.muted}>
          {`${n} ${n === 1 ? 'key' : 'keys'} in your stores ${n === 1 ? 'is' : 'are'} not registered; rt ignores ${n === 1 ? 'it' : 'them'}.`}
        </Text>
      </Group>
      <Stack gap={2} pl={22}>
        {entries.map(e => (
          <Group
            key={`${e.scope}:${e.key}`}
            gap={12}
            wrap="nowrap"
            style={{ minWidth: 0 }}
          >
            <Text fz={12} ff="monospace">
              {e.key}
            </Text>
            <Text fz={12} c={text.muted}>
              {e.scope}
            </Text>
            <Text
              fz={12}
              ff="monospace"
              c={text.muted}
              truncate
              title={e.file}
              style={{ flex: 1, minWidth: 0 }}
            >
              {e.file}
            </Text>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}
