import { useState } from 'react';

import { Alert, LazyLoader, PageShell, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { CommandProvenance } from '../runs/CommandProvenance';
import { analyzeChain } from './chain';
import { LayerRow, type VerdictRole } from './LayerRow';
import { useExplainKey, useSetSetting } from './useSettings';

function rowId(row: { scope: string; file: string | null }): string {
  return `${row.scope}:${row.file ?? 'default'}`;
}

function ExplainKeyPageContent({ settingKey }: { settingKey: string }) {
  const { data, dataUpdatedAt } = useExplainKey(settingKey);
  const { text } = useSchemeColors();
  const verdict = analyzeChain(data.def, data.rows);
  const setMutation = useSetSetting(settingKey);
  const [applyingRowId, setApplyingRowId] = useState<string | null>(null);

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
      <Text size="sm" c={text.muted}>
        {data.def.description}
      </Text>
      <Text size="md" data-testid="explain-sentence">
        {verdict.sentence}
      </Text>
      {verdict.kind === 'composite' && (
        <Text size="xs" c={text.muted}>
          Deep merge, key by key; lists replace atomically — an array is a leaf,
          never merged.
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
        {data.rows.map(row => {
          const id = rowId(row);
          const isApplyingRow = applyingRowId === id;
          return (
            <LayerRow
              key={id}
              def={data.def}
              row={row}
              role={roleOf(row)}
              onApply={(value, scope) => {
                setApplyingRowId(id);
                setMutation.mutate(
                  { value, scope },
                  {
                    onSettled: (_data, error) => {
                      if (!error) setApplyingRowId(null);
                    },
                  }
                );
              }}
              applying={isApplyingRow && setMutation.isPending}
              applyLocked={setMutation.isPending && !isApplyingRow}
              applyError={
                isApplyingRow ? (setMutation.error?.message ?? null) : null
              }
              onResetError={() => {
                if (!isApplyingRow) return;
                setMutation.reset();
                setApplyingRowId(null);
              }}
            />
          );
        })}
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
    <PageShell title={settingKey}>
      <LazyLoader>
        <ExplainKeyPageContent settingKey={settingKey} />
      </LazyLoader>
    </PageShell>
  );
}
