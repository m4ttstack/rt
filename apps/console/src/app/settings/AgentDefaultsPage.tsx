import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Group,
  LazyLoader,
  PageShell,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { notifications } from '@mattstack/app-kit/notifications';
import { useSuspenseQuery } from '@tanstack/react-query';

import type { ExplainRowWire, SettingDefWire } from '../../server/settings';
import { client } from '../api';
import { PAGE_ROW_HEIGHT } from '../chrome';
import { analyzeChain } from '../config/chain';
import {
  useAgentModels,
  useSetSetting,
  useSettingsPrefix,
} from '../config/useSettings';

type Provider = 'claude' | 'codex';
type Scope = 'user' | 'machine';

type ExplainPayload = { def: SettingDefWire; rows: ExplainRowWire[] } | null;

/**
 * A key's current effective value, or `null` when the registry doesn't know
 * it yet -- the transitional state before rt-client republishes the
 * provider-scoped agent.* keys (see the page-level banner). Shares its query
 * key with `useExplainKey`/`useSetSetting` so a successful write here
 * refetches through the same invalidation, and it stays a suspense query
 * (like `useExplainKey`) so an uncontrolled field's `defaultValue` is never
 * set from a value that later arrives async.
 */
function useCurrentValue(key: string) {
  return useSuspenseQuery({
    queryKey: ['settings', 'explain', key],
    queryFn: async (): Promise<ExplainPayload> => {
      const res = await client.api.settings.explain[':key'].$get({
        param: { key },
      });
      // The route's only non-200 response is 404 (unknown key) -- treated
      // as "unset" here rather than thrown, so a key the registry doesn't
      // know yet degrades this field instead of blanking the whole page.
      if (!res.ok) return null;
      return res.json();
    },
  });
}

function winnerValue(explain: ExplainPayload): unknown {
  if (!explain) return undefined;
  const verdict = analyzeChain(explain.def, explain.rows);
  return verdict.kind === 'scalar' ? verdict.winner?.value : undefined;
}

function stringValue(explain: ExplainPayload): string {
  const value = winnerValue(explain);
  return typeof value === 'string' ? value : '';
}

function boolValue(explain: ExplainPayload): boolean {
  return winnerValue(explain) === true;
}

/** Which layer currently wins for this field, 'user' or 'machine' when a
    real scope wins, null when nothing does (default/unset/pending). Seeds
    a field's own write-scope control on mount. A `machine.repo`/`user.repo`
    winner also reads as its non-repo scope here -- sound today because
    every agent.* def declares `repoScoped: false`. */
function winningScope(explain: ExplainPayload): Scope | null {
  if (!explain) return null;
  const verdict = analyzeChain(explain.def, explain.rows);
  if (verdict.kind !== 'scalar' || !verdict.winner) return null;
  return verdict.winner.scope === 'machine' ? 'machine' : 'user';
}

function useFieldScope(explain: ExplainPayload) {
  return useState<Scope>(() => winningScope(explain) ?? 'user');
}

function notifySetError(err: unknown, key: string) {
  const message = err instanceof Error ? err.message : `failed to save ${key}`;
  notifications.error(message);
}

const SCOPE_OPTIONS = [
  { label: 'user', value: 'user' },
  { label: 'machine', value: 'machine' },
];

const SCOPE_HINT =
  'User settings are stored in your home repo, machine settings live only on this machine';

/** One label + per-field write-scope control over an input, capping the
    control's width so it reads as a settings row instead of a full-bleed
    input. The scope control both shows and sets where THIS field's next
    write goes. */
function SettingRow({
  label,
  scope,
  onScopeChange,
  children,
}: {
  label: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  children: ReactNode;
}) {
  return (
    <Box maw={360}>
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Tooltip label={SCOPE_HINT} openDelay={500}>
          <SegmentedControl
            aria-label={`${label} scope`}
            size="xs"
            data={SCOPE_OPTIONS}
            value={scope}
            onChange={v => onScopeChange(v as Scope)}
          />
        </Tooltip>
      </Group>
      {children}
    </Box>
  );
}

/** A text-valued setting field: owns its own current-value read, write
    scope, and mutation, so mounting it under `key={settingKey}` (done by
    every caller whose key changes with the selected provider) resets scope
    and value together instead of leaving a stale scope pointed at a store
    the new key was never read from. */
function TextSettingField({
  settingKey,
  label,
  placeholder,
}: {
  settingKey: string;
  label: string;
  placeholder?: string;
}) {
  const current = useCurrentValue(settingKey);
  const [scope, setScope] = useFieldScope(current.data);
  const mutation = useSetSetting(settingKey);
  const initialValue = stringValue(current.data);
  return (
    <SettingRow label={label} scope={scope} onScopeChange={setScope}>
      <TextInput
        aria-label={label}
        placeholder={placeholder}
        defaultValue={initialValue}
        onBlur={e => {
          if (e.currentTarget.value === initialValue) return;
          mutation.mutate(
            { value: e.currentTarget.value || undefined, scope },
            { onError: err => notifySetError(err, settingKey) }
          );
        }}
      />
    </SettingRow>
  );
}

/** Same self-contained-field shape as `TextSettingField`, for the one
    boolean setting on this page. */
function YoloSettingField({ settingKey }: { settingKey: string }) {
  const current = useCurrentValue(settingKey);
  const [scope, setScope] = useFieldScope(current.data);
  const mutation = useSetSetting(settingKey);
  return (
    <Group justify="space-between" maw={360}>
      <Switch
        label="Bypass permission prompts (--yolo)"
        defaultChecked={boolValue(current.data)}
        onChange={e => {
          mutation.mutate(
            { value: e.currentTarget.checked, scope },
            { onError: err => notifySetError(err, settingKey) }
          );
        }}
      />
      <Tooltip label={SCOPE_HINT} openDelay={500}>
        <SegmentedControl
          aria-label="Bypass permission prompts scope"
          size="xs"
          data={SCOPE_OPTIONS}
          value={scope}
          onChange={v => setScope(v as Scope)}
        />
      </Tooltip>
    </Group>
  );
}

function ProviderModelField({ provider }: { provider: Provider }) {
  const key = `agent.${provider}.model`;
  const { data } = useAgentModels(provider);
  const current = useCurrentValue(key);
  const [scope, setScope] = useFieldScope(current.data);
  const mutation = useSetSetting(key);
  const options = (data?.models ?? []).map(m => ({
    value: m.value,
    label: m.label,
  }));
  const initialValue = stringValue(current.data);
  return (
    <SettingRow label="Model" scope={scope} onScopeChange={setScope}>
      <Autocomplete
        aria-label="Model"
        placeholder="provider default"
        data={options}
        defaultValue={initialValue}
        clearable
        onBlur={e => {
          if (e.currentTarget.value === initialValue) return;
          mutation.mutate(
            { value: e.currentTarget.value || undefined, scope },
            { onError: err => notifySetError(err, key) }
          );
        }}
      />
    </SettingRow>
  );
}

function AgentDefaultsPageContent() {
  const { bg, border } = useSchemeColors();
  const { data: defsData, error: defsError } = useSettingsPrefix('agent.');
  const defs = defsData?.defs;
  const schemaReady = defs?.some(d => d.key === 'agent.provider') ?? true;

  const providerExplain = useCurrentValue('agent.provider');
  const [providerScope, setProviderScope] = useFieldScope(providerExplain.data);
  const providerMutation = useSetSetting('agent.provider');
  const provider = (stringValue(providerExplain.data) || 'claude') as Provider;

  const effortKey = `agent.${provider}.effort`;
  const extraArgsKey = `agent.${provider}.extraArgs`;
  const yoloKey = `agent.${provider}.yolo`;

  return (
    <Paper
      bg={bg.level4}
      radius="md"
      p="xl"
      maw={620}
      mx="auto"
      mt="xl"
      style={{ border: `1px solid ${border.default}` }}
    >
      <Stack gap="md" data-testid="agent-defaults">
        <Title order={3}>Agent defaults</Title>
        <Text size="sm">
          These apply to every future <code>rt agent start</code> that does not
          pass its own flag. Each field&apos;s <code>user</code>/
          <code>machine</code> control picks where THAT field&apos;s next change
          is written.
        </Text>
        {defsError && <Alert color="red">{(defsError as Error).message}</Alert>}
        {!schemaReady && (
          <Alert color="yellow" data-testid="schema-pending-alert">
            This build&apos;s settings registry doesn&apos;t have the
            provider-scoped <code>agent.*</code> keys yet (pending an{' '}
            <code>@mattstack/rt-client</code> publish) -- changes below may not
            persist until it lands.
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <SettingRow
            label="Default agent"
            scope={providerScope}
            onScopeChange={setProviderScope}
          >
            <Select
              aria-label="Default agent"
              data={[
                { value: 'claude', label: 'Claude' },
                { value: 'codex', label: 'Codex' },
              ]}
              value={provider}
              allowDeselect={false}
              onChange={v =>
                providerMutation.mutate(
                  { value: v ?? 'claude', scope: providerScope },
                  { onError: err => notifySetError(err, 'agent.provider') }
                )
              }
            />
          </SettingRow>
          <ProviderModelField key={`${provider}-model`} provider={provider} />
          <TextSettingField
            key={effortKey}
            settingKey={effortKey}
            label="Effort"
            placeholder={
              provider === 'codex'
                ? 'e.g. medium, high'
                : 'e.g. low, medium, high'
            }
          />
          {provider === 'claude' && (
            <TextSettingField
              settingKey="agent.claude.account"
              label="Account"
              placeholder="cswap account email; unset uses default"
            />
          )}
          <TextSettingField
            key={extraArgsKey}
            settingKey={extraArgsKey}
            label="Extra args"
            placeholder="raw flags appended to every launch"
          />
        </SimpleGrid>
        <YoloSettingField key={yoloKey} settingKey={yoloKey} />
      </Stack>
    </Paper>
  );
}

export function AgentDefaultsPage() {
  return (
    <PageShell title="Settings" headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <LazyLoader>
        <AgentDefaultsPageContent />
      </LazyLoader>
    </PageShell>
  );
}
