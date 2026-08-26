import { useMemo } from 'react';

import { Badge, Group, Stack, Switch, Text, TextInput } from '@ui/core';
import { useStoredUIState, useUIState } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useStoredUIState, useUIState } from '@ui/hooks';",
  '',
  '// [state, setState, deferredValue] -- feed the input from state, the',
  '// expensive render from deferredValue, and typing stays snappy.',
  "const [query, setQuery, deferredQuery] = useUIState('');",
  '',
  '<TextInput value={query} onChange={e => setQuery(e.currentTarget.value)} />;',
  '<HugeFilteredList query={deferredQuery} />;',
  '',
  '// Same tuple, persisted (through the anti-flash useLocalStorage shadow):',
  "const [compact, setCompact] = useStoredUIState(false, 'gear-compact-mode');",
].join('\n');

// Rows transcribed from src/ui/hooks/useUIState.ts.
const UI_STATE_ROWS = [
  {
    name: 'useUIState(defaultValue)',
    type: '[state, setState, deferredValue]',
    note: "Plain useState plus React's useDeferredValue on the same value: state updates immediately (keep inputs responsive), deferredValue lags a render behind under load (feed it to expensive renders).",
  },
  {
    name: 'useStoredUIState(defaultValue, key)',
    type: '[state, setState, deferredValue]',
    note: 'Same tuple, persisted under key through the shadowed useLocalStorage -- the stored value is read synchronously on first render, so no flash of the default.',
  },
  {
    name: 'UIState<T>',
    type: 'type',
    note: "The tuple's exported type, for passing the pair/triple around.",
  },
];

const BIG_LIST = Array.from({ length: 2000 }, (_, i) => {
  const kinds = ['camera', 'mic', 'light', 'tripod', 'cable', 'recorder'];
  return `${kinds[i % kinds.length]}_${String(i).padStart(4, '0')}`;
});

function UseUIStateDemo() {
  const [query, setQuery, deferredQuery] = useUIState('');
  const [compact, setCompact] = useStoredUIState(
    false,
    'docs-use-ui-state-compact'
  );

  const matches = useMemo(
    () => BIG_LIST.filter(name => name.includes(deferredQuery.toLowerCase())),
    [deferredQuery]
  );

  return (
    <Stack gap="sm">
      <TextInput
        label="Filter 2,000 gear tags"
        placeholder="camera"
        value={query}
        onChange={event => setQuery(event.currentTarget.value)}
        maw={280}
      />
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          state:
        </Text>
        <Badge variant="light">{query === '' ? '""' : query}</Badge>
        <Text size="sm" c="dimmed">
          deferredValue:
        </Text>
        <Badge variant="light">
          {deferredQuery === '' ? '""' : deferredQuery}
        </Badge>
        <Badge
          variant="light"
          color={query === deferredQuery ? 'green' : 'orange'}
        >
          {query === deferredQuery ? 'caught up' : 'lagging'}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed">
        {matches.length} match{matches.length === 1 ? '' : 'es'}
        {matches.length > 0 &&
          ` -- ${matches.slice(0, compact ? 3 : 8).join(', ')}${
            matches.length > (compact ? 3 : 8) ? ', ...' : ''
          }`}
      </Text>
      <Switch
        label="Compact results (useStoredUIState -- persists across reloads)"
        checked={compact ?? false}
        onChange={event => setCompact(event.currentTarget.checked)}
      />
    </Stack>
  );
}

export function UseUIStatePage() {
  return (
    <ComponentDoc
      title="useUIState"
      lead="A state value for the UI plus a deferred companion for expensive renders that may lag a frame behind -- [state, setState, deferredValue] -- and useStoredUIState, the same tuple persisted through the kit's anti-flash storage shadow."
      demoIntro="Type in the filter: the input tracks state immediately while the 2,000-row filter reads the deferred value (under load the badges briefly diverge). The compact switch is useStoredUIState -- flip it, reload the page, and it holds."
      demo={<UseUIStateDemo />}
      usage={USAGE}
      usageMinHeight={290}
      propsTables={[{ title: 'API', rows: UI_STATE_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The deferred value is React&apos;s own useDeferredValue: when a render
          is cheap the two stay in lockstep, and under pressure React re-renders
          the deferred consumers at lower priority -- so wire inputs to state
          and heavy trees to deferredValue and the split activates only when
          needed. useStoredUIState goes through the shadowed useLocalStorage
          (never @mantine/hooks directly), so the persisted value arrives
          synchronously on first render; its value type widens with undefined
          for the same TS-signature reason the storage hooks page explains.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
