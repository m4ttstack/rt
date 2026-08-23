import { Stack, Text, TextInput } from '@ui/core';
import { useLocalStorage, useSessionStorage } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useLocalStorage, useSessionStorage } from '@ui/hooks';",
  '',
  'const [name, setName] = useLocalStorage({',
  "  key: 'workspace-name',",
  "  defaultValue: '',",
  '});',
  '',
  '// Explicitly opting back into the effect-based read (rarely wanted):',
  'const [flag] = useLocalStorage({',
  "  key: 'some-flag',",
  '  defaultValue: false,',
  '  getInitialValueInEffect: true,',
  '});',
].join('\n');

// Rows transcribed from src/ui/hooks/useStorage.ts.
const API_ROWS = [
  {
    name: 'useLocalStorage(props)',
    type: '[value, setValue, remove]',
    note: "Mantine's useLocalStorage with getInitialValueInEffect hard-coded to false: the stored value is read synchronously on first render. All of Mantine's own options (key, defaultValue, serialize/deserialize, ...) pass through, including opting back in explicitly.",
  },
  {
    name: 'useSessionStorage(props)',
    type: '[value, setValue, remove]',
    note: 'Same shadow over sessionStorage: survives reloads within the tab, resets when the tab closes.',
  },
  {
    name: 'StorageHookProps<T>',
    type: 'type',
    note: "The props type both shadows accept -- Mantine's own parameter type, exported for wrappers.",
  },
];

function UseStorageDemo() {
  const [localValue, setLocalValue] = useLocalStorage({
    key: 'docs-storage-demo-local',
    defaultValue: '',
  });
  const [sessionValue, setSessionValue] = useSessionStorage({
    key: 'docs-storage-demo-session',
    defaultValue: '',
  });

  return (
    <Stack gap="sm" maw={360}>
      <TextInput
        label="useLocalStorage"
        description="Survives reloads and new tabs. Type something, reload the page: no flash of empty."
        placeholder="Persisted locally"
        value={localValue ?? ''}
        onChange={event => setLocalValue(event.currentTarget.value)}
      />
      <TextInput
        label="useSessionStorage"
        description="Survives reloads in this tab only; a new tab starts fresh."
        placeholder="Persisted for this tab"
        value={sessionValue ?? ''}
        onChange={event => setSessionValue(event.currentTarget.value)}
      />
    </Stack>
  );
}

export function UseStoragePage() {
  return (
    <ComponentDoc
      title="Storage hooks"
      lead="The kit shadows Mantine's useLocalStorage and useSessionStorage with one change: getInitialValueInEffect defaults to false, so the stored value is read synchronously on first render instead of after first paint -- no flash of the default value."
      demoIntro="Both fields persist as you type. The localStorage one is the anti-flash story: reload the page and the value is there on the very first frame, not filled in a beat later."
      demo={<UseStorageDemo />}
      usage={USAGE}
      usageMinHeight={330}
      propsTables={[{ title: 'API', rows: API_ROWS }]}
    >
      <DocSection title="The getInitialValueInEffect story">
        <Text size="sm">
          Mantine&apos;s own default is true: the hook returns defaultValue on
          the first render and reads storage in an effect, after paint -- a
          guaranteed one-frame flash of the default for anything visible
          (sidebar states, scheme preferences, saved filters). The shadows
          hard-code false, and because they are named exports placed after
          @ui/hooks&apos; export * from &apos;@mantine/hooks&apos;, every caller
          importing from @ui/hooks gets the fixed versions. Callers can still
          pass getInitialValueInEffect: true per call to opt back in. Inside the
          kit itself, only src/ui/hooks/useStorage.ts may reach the real
          @mantine/hooks versions.
        </Text>
        <Text size="sm">
          Honesty notes: only these two hooks are shadowed --
          readLocalStorageValue and readSessionStorageValue re-export from
          @mantine/hooks unchanged. And collapsing Mantine&apos;s overloads into
          one signature widens the returned value to T | undefined even with a
          defaultValue supplied; at runtime it is never undefined when a
          defaultValue is given, so a ?? fallback exists purely to satisfy the
          type (useColorScheme does exactly that).
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
