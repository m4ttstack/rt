import { Badge, Group, Paper, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import type { ExplainRowWire, SettingDefWire } from '../../server/settings';
import { shortValue } from './chain';

export type VerdictRole = 'winner' | 'overridden' | 'contributor' | 'inert';

export interface LayerRowProps {
  def: SettingDefWire;
  row: ExplainRowWire;
  role: VerdictRole;
}

/** `default` and the repo rungs are never write targets in v1; everything
    else maps 1:1 onto a store scope. */
export function writeScopeOf(
  row: ExplainRowWire
): 'user' | 'team' | 'machine' | null {
  return row.scope === 'user' || row.scope === 'team' || row.scope === 'machine'
    ? row.scope
    : null;
}

export function LayerRow({ def, row, role }: LayerRowProps) {
  const { text } = useSchemeColors();
  const rowId = `${row.scope}${row.file ? `:${row.file}` : ''}`;

  return (
    <Paper
      radius="sm"
      px="md"
      py={8}
      data-testid={`layer-row-${rowId}`}
      data-winner={role === 'winner' || undefined}
      data-overridden={role === 'overridden' || undefined}
    >
      <Group gap="md" wrap="nowrap" align="baseline">
        <Text size="sm" fw={role === 'winner' ? 700 : 500} w={104} style={{ flex: 'none' }}>
          {row.scope}
        </Text>
        {role === 'winner' && <Badge size="xs">wins</Badge>}
        {role === 'contributor' && (
          <Badge size="xs" variant="light">
            contributes
          </Badge>
        )}
        {row.shadowed && (
          <Badge size="xs" variant="light" color="warn">
            ignored — teamLocked
          </Badge>
        )}
        {row.invalid && (
          <Badge size="xs" variant="light" color="bad">
            refused
          </Badge>
        )}
        <RowBody def={def} row={row} role={role} />
        <Text size="xs" c={text.dimmed} ff="monospace" truncate style={{ flex: 1 }}>
          {row.file ?? 'registry default'}
        </Text>
      </Group>
      {row.invalid && (
        <Text size="xs" c={text.muted} pl={104}>
          {row.invalid}
        </Text>
      )}
    </Paper>
  );
}

function RowBody({ def, row, role }: LayerRowProps) {
  const { text } = useSchemeColors();

  if (!row.present)
    return (
      <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
        not set at this layer
      </Text>
    );
  if (def.secret)
    return (
      <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
        value present — never shown here
      </Text>
    );
  return (
    <Text
      size="sm"
      ff="monospace"
      style={{
        flex: 'none',
        textDecoration: role === 'overridden' ? 'line-through' : undefined,
      }}
      data-testid={`layer-value-${row.scope}`}
    >
      {shortValue(row.value)}
    </Text>
  );
}
