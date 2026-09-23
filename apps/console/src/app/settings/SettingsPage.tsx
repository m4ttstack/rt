import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CloseButton,
  Group,
  Kbd,
  NavLink,
  PageShell,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  usePageShellContext,
} from '@mattstack/app-kit/core';
import { useHotkeys, useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { useSettingsScope } from '@mattstack/settings-kit/react';
import { isSet } from '@mattstack/settings-kit/shapes';
import { useSearchParams } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { TIER_LABEL, type Tier } from './groups';
import { ScopeDot } from './ScopeBadge';
import { SettingsSection, type Provider } from './SettingsSection';
import {
  buildSections,
  isEditable,
  type ScopeFilter,
  type Section,
} from './view';

const TIERS: Tier[] = ['rt', 'apps', 'suite'];
const SCOPES = ['user', 'team', 'machine'] as const;
const TOOLBAR_ROW = 68;
// The title row and the toolbar row, plus the header's own bottom hairline.
const HEADER_HEIGHT = PAGE_ROW_HEIGHT + TOOLBAR_ROW + 1;

function Index({
  sections,
  filtering,
}: {
  sections: Section[];
  filtering: boolean;
}) {
  const { text } = useSchemeColors();
  const { collapsedSidebar, toggleSidebar } = usePageShellContext();
  const [active, setActive] = useState(() =>
    window.location.hash.replace('#', '')
  );
  return (
    <Box component="nav" aria-label="settings groups" p="12px 12px 20px 16px">
      {TIERS.map((tier, i) => (
        <Box key={tier}>
          <Text
            fz={12}
            fw={500}
            c="var(--tk-text-3)"
            px={8}
            pt={i === 0 ? 8 : 20}
            pb={4}
          >
            {TIER_LABEL[tier]}
          </Text>
          {sections
            .filter(s => s.group.tier === tier)
            .map(s => {
              const empty = filtering && s.shown === 0;
              const current = active === s.group.id;
              return (
                <NavLink
                  key={s.group.id}
                  href={`#${s.group.id}`}
                  label={s.group.label}
                  active={current}
                  leftSection={
                    <Box
                      component="span"
                      aria-hidden
                      w={7}
                      h={7}
                      style={{
                        flex: 'none',
                        borderRadius: '50%',
                        border: '1.5px solid var(--tk-line-1)',
                      }}
                    />
                  }
                  disabled={empty}
                  aria-disabled={empty || undefined}
                  tabIndex={empty ? -1 : undefined}
                  rightSection={
                    <Text fz={12} ff="monospace" c={text.muted}>
                      {filtering ? s.shown : s.total}
                    </Text>
                  }
                  styles={{
                    root: {
                      height: 30,
                      padding: '0 8px 0 20px',
                      borderRadius: 4,
                      background: current ? 'var(--tk-raised)' : undefined,
                      color:
                        current || (filtering && !empty)
                          ? 'var(--tk-text-1)'
                          : 'var(--tk-text-2)',
                      opacity: empty ? 0.45 : undefined,
                      marginBottom: 2,
                    },
                    label: { fontSize: 14, fontWeight: current ? 500 : 400 },
                  }}
                  onClick={e => {
                    e.preventDefault();
                    if (empty) return;
                    setActive(s.group.id);
                    window.history.replaceState(
                      null,
                      '',
                      `${window.location.pathname}${window.location.search}#${s.group.id}`
                    );
                    document
                      .getElementById(`settings-${s.group.id}`)
                      ?.scrollIntoView({ block: 'start' });
                    if (collapsedSidebar) toggleSidebar();
                  }}
                />
              );
            })}
        </Box>
      ))}
    </Box>
  );
}

export function SettingsPage() {
  const { text, bg } = useSchemeColors();
  const store = useSettingsScope('');
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [changedOnly, setChangedOnly] = useState(false);
  const [editableOnly, setEditableOnly] = useState(false);
  const [scope, setScope] = useState<ScopeFilter>('any');
  const filterRef = useRef<HTMLInputElement>(null);
  const [asOf, setAsOf] = useState<Date | null>(null);
  useEffect(() => {
    if (!store.loading && store.error === null) setAsOf(new Date());
  }, [store.loading, store.error]);
  useHotkeys([['/', () => filterRef.current?.focus()]]);

  // A deep link (/settings#board) can only scroll once the sections exist.
  useEffect(() => {
    if (store.loading) return;
    const id = window.location.hash.slice(1);
    if (id)
      document
        .getElementById(`settings-${id}`)
        ?.scrollIntoView({ block: 'start' });
  }, [store.loading]);

  const setQuery = (q: string) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q);
        else next.delete('q');
        return next;
      },
      { replace: true }
    );

  const sections = useMemo(
    () =>
      buildSections(store.defs, { query, changedOnly, editableOnly, scope }),
    [store.defs, query, changedOnly, editableOnly, scope]
  );
  const total = store.defs.length;
  const agentProvider: Provider =
    store.defs.find(d => d.key === 'agent.provider')?.effective.value ===
    'codex'
      ? 'codex'
      : 'claude';
  const shown = sections.reduce((n, s) => n + s.shown, 0);
  const filtering =
    query !== '' || changedOnly || editableOnly || scope !== 'any';
  const visible = sections.filter(s => s.shown > 0);
  const hiddenGroups = sections.length - visible.length;
  const clearAll = () => {
    setQuery('');
    setChangedOnly(false);
    setEditableOnly(false);
    setScope('any');
  };

  return (
    <PageShell
      headerHeight={HEADER_HEIGHT}
      sidebarWidth={232}
      drawerStateKey="console-settings-index"
    >
      <PageShell.Sidebar hideCollapseButton>
        <Index sections={sections} filtering={filtering} />
      </PageShell.Sidebar>
      <PageShell.Main>
        <PageShell.Header px={0} gap={0} align="stretch">
          <Stack gap={0} w="100%">
            <Group
              h={PAGE_ROW_HEIGHT}
              px="lg"
              justify="space-between"
              wrap="nowrap"
              style={{ borderBottom: '1px solid var(--tk-border-soft)' }}
            >
              <Title
                order={2}
                size="h5"
                fw={700}
                style={{ whiteSpace: 'nowrap' }}
              >
                Settings
              </Title>
              {asOf && (
                <Group gap={6} wrap="nowrap">
                  <Text fz={12} ff="monospace" c={text.muted}>
                    {'>_ rt settings list'}
                  </Text>
                  <Text fz={12} c={text.muted}>
                    {`${total} keys · as of ${asOf.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                  </Text>
                </Group>
              )}
            </Group>
            <Group gap={12} px={32} h={TOOLBAR_ROW} wrap="nowrap">
              <TextInput
                ref={filterRef}
                aria-label="filter settings"
                style={{ flex: 1 }}
                leftSection={<Icons.search size={16} />}
                placeholder={`Filter ${total} settings by key or description`}
                styles={{ input: { fontSize: 14 } }}
                value={query}
                onTextChange={setQuery}
                onKeyDown={e => {
                  if (e.key === 'Escape' && query !== '') {
                    e.stopPropagation();
                    setQuery('');
                  }
                }}
                rightSectionWidth={query ? 110 : 36}
                rightSection={
                  query ? (
                    <Group gap={6} wrap="nowrap">
                      <Text
                        fz={12}
                        c={text.muted}
                      >{`${shown} of ${total}`}</Text>
                      <CloseButton
                        size="sm"
                        aria-label="clear filter"
                        onClick={() => setQuery('')}
                      />
                    </Group>
                  ) : (
                    <Kbd size="xs">/</Kbd>
                  )
                }
              />
              <Chip
                checked={changedOnly}
                onChange={setChangedOnly}
                variant="outline"
                size="sm"
                styles={{
                  label: {
                    height: 30,
                    paddingInline: 12,
                    fontSize: 12,
                    fontWeight: 500,
                  },
                }}
              >
                Changed{' '}
                <Text span inherit ff="monospace">
                  {store.defs.filter(isSet).length}
                </Text>
              </Chip>
              <Chip
                checked={editableOnly}
                onChange={setEditableOnly}
                variant="outline"
                size="sm"
                styles={{
                  label: {
                    height: 30,
                    paddingInline: 12,
                    fontSize: 12,
                    fontWeight: 500,
                  },
                }}
              >
                Editable{' '}
                <Text span inherit ff="monospace">
                  {store.defs.filter(isEditable).length}
                </Text>
              </Chip>
              <SegmentedControl
                size="xs"
                withItemsBorders={false}
                styles={{ label: { fontSize: 12, fontWeight: 500 } }}
                value={scope}
                onChange={v => setScope(v as ScopeFilter)}
                data={[
                  { value: 'any', label: 'any' },
                  ...SCOPES.map(s => ({
                    value: s,
                    label: (
                      <Group gap={6} wrap="nowrap">
                        <ScopeDot scope={s} />
                        <span>{s}</span>
                      </Group>
                    ),
                  })),
                ]}
              />
            </Group>
          </Stack>
        </PageShell.Header>
        <PageShell.Content contentContainer={false} bg={bg.level3}>
          <Box px={32} pb={32}>
            {store.error && (
              <Alert
                color="bad"
                variant="light"
                mt="md"
                icon={<Icons.error size={14} />}
              >
                <Text fz={12}>{store.error}</Text>
              </Alert>
            )}
            {store.loading ? (
              <Stack gap="md" pt={28}>
                {[220, 280, 180, 240].map(w => (
                  <Group key={w} justify="space-between">
                    <Stack gap={8}>
                      <Skeleton h={12} w={w} />
                      <Skeleton h={10} w={w + 160} />
                    </Stack>
                    <Skeleton h={30} w={200} />
                  </Group>
                ))}
              </Stack>
            ) : visible.length === 0 && total > 0 ? (
              <Stack align="center" gap={10} py={48}>
                <Icons.search size={24} color={text.muted} />
                <Text fz={14} fw={500}>
                  {query
                    ? `No settings match “${query}”`
                    : 'No settings match these filters'}
                </Text>
                <Text fz={12} c={text.muted}>
                  The filter reads key names and descriptions, not values.
                </Text>
                <Button
                  size="xs"
                  h={28}
                  fz={12}
                  variant="default"
                  onClick={clearAll}
                >
                  Clear filter
                </Button>
              </Stack>
            ) : (
              visible.map(s => (
                <SettingsSection
                  key={s.group.id}
                  section={s}
                  store={store}
                  query={query}
                  filtering={filtering}
                  agentProvider={agentProvider}
                />
              ))
            )}
            {filtering && visible.length > 0 && hiddenGroups > 0 && (
              <Group gap={8} pt={20}>
                <Icons.eyeOff size={14} color={text.muted} />
                <Text fz={12} c={text.muted}>
                  {hiddenGroups === 1
                    ? '1 group has no match.'
                    : `${hiddenGroups} groups have no match.`}
                </Text>
                <Button size="compact-xs" variant="default" onClick={clearAll}>
                  Clear filter
                </Button>
              </Group>
            )}
          </Box>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
