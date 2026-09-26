import { useState, type ReactNode } from 'react';
import {
  Box,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';

import { useAgentModels } from '../config/useSettings';
import { SettingRow } from './SettingRow';
import type { RowStore } from './useRowSave';
import type { Section, StoreScope } from './view';

const SUBHEAD: Record<
  StoreScope,
  { label: string; note: string; color: string }
> = {
  team: {
    label: 'Team',
    note: 'shared with everyone through the team repo',
    color: 'var(--tk-text-purple-small)',
  },
  user: {
    label: 'You',
    note: 'your home repo, follows you to every machine',
    color: 'var(--tk-text-cyan-small)',
  },
  machine: {
    label: 'This machine',
    note: 'never leaves this Mac',
    color: 'var(--tk-text-accent-small)',
  },
};

export type Provider = 'claude' | 'codex';

function Header({
  section,
  count,
  right,
}: {
  section: Section;
  count: string;
  right?: ReactNode;
}) {
  const { text } = useSchemeColors();
  return (
    <Stack gap={4} pt={28} pb={8}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap={8}>
          <Title order={2} size={16} fw={700}>
            {section.group.label}
          </Title>
          <Text fz={12} ff="monospace" c={text.muted}>
            {count}
          </Text>
        </Group>
        {right}
      </Group>
      {section.group.blurb && (
        <Text fz={12} c={text.muted}>
          {section.group.blurb}
        </Text>
      )}
    </Stack>
  );
}

function countText(filtering: boolean, shown: number, total: number) {
  return filtering ? `${shown} of ${total}` : String(total);
}

function AgentsSection({
  section,
  store,
  query,
  filtering,
  initialProvider,
  onExplain,
}: {
  section: Section;
  store: RowStore;
  query: string;
  filtering: boolean;
  initialProvider: Provider;
  onExplain: (key: string) => void;
}) {
  const all = section.subsections.flatMap(s => s.defs);
  const [chosen, setChosen] = useState<Provider>(initialProvider);
  const shownFor = (p: Provider) =>
    all.some(d => d.key.startsWith(`agent.${p}.`));
  const other: Provider = chosen === 'claude' ? 'codex' : 'claude';
  // Derived, never written back: clearing the filter returns to `chosen`.
  const provider = !shownFor(chosen) && shownFor(other) ? other : chosen;
  const models = useAgentModels(provider);
  const suggestions = (models.data?.models ?? []).map(m => m.value);
  const defs = all.filter(
    d => d.key === 'agent.provider' || d.key.startsWith(`agent.${provider}.`)
  );
  return (
    <Box component="section" id="settings-agents">
      <Header
        section={section}
        count={countText(filtering, defs.length, section.total)}
        right={
          <SegmentedControl
            size="xs"
            withItemsBorders={false}
            styles={{ label: { fontSize: 12, fontWeight: 500 } }}
            value={provider}
            onChange={v => setChosen(v as Provider)}
            data={[
              { value: 'claude', label: 'Claude' },
              { value: 'codex', label: 'Codex' },
            ]}
          />
        }
      />
      {defs.map(def => (
        <SettingRow
          key={def.key}
          def={def}
          store={store}
          subhead={null}
          query={query}
          suggestions={def.key.endsWith('.model') ? suggestions : undefined}
          onExplain={onExplain}
        />
      ))}
    </Box>
  );
}

export function SettingsSection({
  section,
  store,
  query,
  filtering,
  agentProvider,
  onExplain,
}: {
  section: Section;
  store: RowStore;
  query: string;
  filtering: boolean;
  agentProvider: Provider;
  onExplain: (key: string) => void;
}) {
  const { text } = useSchemeColors();
  if (section.group.id === 'agents')
    return (
      <AgentsSection
        section={section}
        store={store}
        query={query}
        filtering={filtering}
        initialProvider={agentProvider}
        onExplain={onExplain}
      />
    );
  return (
    <Box component="section" id={`settings-${section.group.id}`}>
      <Header
        section={section}
        count={countText(filtering, section.shown, section.total)}
      />
      {section.subsections.map(sub => (
        <Box key={sub.scope ?? 'all'}>
          {sub.scope && (
            <Group
              gap={8}
              pt={22}
              pb={6}
              wrap="nowrap"
              style={{ borderBottom: '1px solid var(--tk-line-2)' }}
            >
              <Text
                fz={12}
                fw={500}
                tt="uppercase"
                lts={0.6}
                c={SUBHEAD[sub.scope].color}
              >
                {SUBHEAD[sub.scope].label}
              </Text>
              <Text fz={12} ff="monospace" c={text.muted}>
                {sub.defs.length}
              </Text>
              <Text fz={12} c={text.muted}>
                {`· ${SUBHEAD[sub.scope].note}`}
              </Text>
            </Group>
          )}
          {sub.defs.map(def => (
            <SettingRow
              key={def.key}
              def={def}
              store={store}
              subhead={sub.scope}
              query={query}
              onExplain={onExplain}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}
