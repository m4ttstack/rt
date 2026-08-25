import { Alert, LazyLoader, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { analyzeChain } from './chain';
import { LayerRow, type VerdictRole } from './LayerRow';
import { useExplainKey, useSetSetting } from './useSettings';

function ExplainKeyPageContent({ settingKey }: { settingKey: string }) {
  const { data, dataUpdatedAt } = useExplainKey(settingKey);
  const { text } = useSchemeColors();
  const verdict = analyzeChain(data.def, data.rows);
  const setMutation = useSetSetting(settingKey);

  const roleOf = (row: (typeof data.rows)[number]): VerdictRole => {
    if (verdict.kind === 'composite')
      return verdict.contributors.includes(row) ? 'contributor' : 'inert';
    if (verdict.winner === row) return 'winner';
    return verdict.overridden.includes(row) ? 'overridden' : 'inert';
  };

  return (
    <Stack gap="lg" p="lg" data-testid="explain-key">
      <CommandProvenance
        command={`rt settings explain ${settingKey}`}
        asOf={dataUpdatedAt}
      />
      <Stack gap={4}>
        <Text fw={700} size="lg">
          {settingKey}
        </Text>
        <Text size="sm" c={text.muted}>
          {data.def.description}
        </Text>
      </Stack>
      <Text size="md" data-testid="explain-sentence">
        {verdict.sentence}
      </Text>
      {verdict.kind === 'composite' && (
        <Text size="xs" c={text.muted}>
          Deep merge, key by key; lists replace atomically — an array is a
          leaf, never merged.
        </Text>
      )}
      {data.def.secret && (
        <Alert variant="light" icon={<Icons.warning size={14} />}>
          <Text size="xs">
            Secret key: the console shows presence and store only. Rotate with{' '}
            <Text span ff="monospace" size="xs">
              rt secrets rotate {settingKey.split('.')[0]}{' '}
              {settingKey.split('.').slice(1).join('.')}
            </Text>{' '}
            — the value is prompted, never a CLI argument.
          </Text>
        </Alert>
      )}
      <Stack gap={6}>
        {data.rows.map(row => (
          <LayerRow
            key={`${row.scope}:${row.file ?? 'default'}`}
            def={data.def}
            row={row}
            role={roleOf(row)}
            onApply={(value, scope) => setMutation.mutate({ value, scope })}
            applying={setMutation.isPending}
            applyError={setMutation.error?.message ?? null}
          />
        ))}
      </Stack>
    </Stack>
  );
}

/**
 * Why is this value this? The plain sentence first, then the stack —
 * weakest-first, exactly as the resolver reads it. Reached from the palette
 * only: config is a lens, not a surface, so no rail entry points here.
 */
export function ExplainKeyPage({ settingKey }: { settingKey: string }) {
  return (
    <LazyLoader>
      <ExplainKeyPageContent settingKey={settingKey} />
    </LazyLoader>
  );
}
