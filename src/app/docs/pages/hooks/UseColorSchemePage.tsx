import { Badge, Group, SegmentedControl, Stack, Text } from '@ui/core';
import { useColorScheme } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useColorScheme, useLightDark } from '@ui/hooks';",
  '',
  'const { colorScheme, computedColorScheme, isDarkMode, toggleColorScheme,',
  '  setColorScheme, lightDark } = useColorScheme();',
  "// colorScheme: the stored preference -- 'light' | 'dark' | 'auto'",
  "// computedColorScheme: 'auto' resolved against the OS -- 'light' | 'dark'",
  '// isDarkMode / isLightMode: the resolved scheme as a boolean',
  '',
  '// Pick one of two values from the resolved scheme:',
  "const logo = lightDark('/logo-dark.svg', '/logo-light.svg');",
  '',
  '// Or, standalone -- the picker without the rest of the hook:',
  'const pick = useLightDark();',
  "const shadow = pick('sm', 'none');",
].join('\n');

// Rows transcribed from src/ui/hooks/useColorScheme.ts.
const RETURN_ROWS = [
  {
    name: 'isDarkMode / isLightMode',
    type: 'boolean',
    note: 'The RESOLVED scheme as a boolean (follows the OS under auto). Convenient for a quick branch.',
  },
  {
    name: 'colorScheme',
    type: "'light' | 'dark' | 'auto'",
    note: "The raw stored preference (localStorage key 'ui-color-scheme', default 'auto'). Not resolved -- do not render off it directly.",
  },
  {
    name: 'computedColorScheme',
    type: "'light' | 'dark'",
    note: "'auto' resolved against the OS preference -- what most components should render off of. Read synchronously on first render (no default-then-correct flash).",
  },
  {
    name: 'toggleColorScheme',
    type: "(v?: 'light' | 'dark' | boolean) => void",
    note: 'No arg: flips the RESOLVED scheme. A scheme string or an is-dark boolean sets it directly. (toggle is the no-arg alias.)',
  },
  {
    name: 'setColorScheme',
    type: '(value: MantineColorScheme) => void',
    note: "Sets the stored preference, 'auto' included.",
  },
  {
    name: 'lightDark',
    type: '<T>(light: T, dark: T) => T',
    note: 'Picks one of two values from the resolved scheme. Same function useLightDark() returns.',
  },
];

const COMPANION_ROWS = [
  {
    name: 'useLightDark()',
    type: '() => <T>(light: T, dark: T) => T',
    note: 'Returns just the lightDark picker, for components that only need to choose per scheme. Resolves through computedColorScheme, so it follows the OS under auto instead of always falling through to light.',
  },
  {
    name: 'useStoredColorScheme()',
    type: '[value, setValue]',
    note: 'The raw persisted preference pair underneath useColorScheme, through the anti-flash useLocalStorage shadow.',
  },
];

function UseColorSchemeDemo() {
  const { colorScheme, computedColorScheme, setColorScheme, lightDark } =
    useColorScheme();
  const lightDarkSample = lightDark('picked light value', 'picked dark value');

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={colorScheme}
        onChange={value => setColorScheme(value as 'light' | 'dark' | 'auto')}
        data={['light', 'dark', 'auto']}
        w="fit-content"
      />
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          colorScheme:
        </Text>
        <Badge variant="light">{colorScheme}</Badge>
        <Text size="sm" c="dimmed">
          computedColorScheme:
        </Text>
        <Badge variant="light">{computedColorScheme}</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        useLightDark(&apos;picked light value&apos;, &apos;picked dark
        value&apos;) returned: {lightDarkSample}
      </Text>
    </Stack>
  );
}

export function UseColorSchemePage() {
  return (
    <ComponentDoc
      title="useColorScheme"
      lead="The kit's persisted color-scheme preference: the stored value, the resolved value, isDarkMode/isLightMode, a flexible toggle, a setter, and the lightDark picker -- backed by the anti-flash useLocalStorage shadow instead of Mantine's built-in scheme manager. useLightDark() exposes just the picker."
      demoIntro="A real round trip: this control writes the same persisted preference as the rail's toggle, so the whole site re-themes (and the values below update). Pick auto and the computed value follows your OS."
      demo={<UseColorSchemeDemo />}
      usage={USAGE}
      usageMinHeight={250}
      propsTables={[
        { title: 'Returns', rows: RETURN_ROWS },
        { title: 'Companions', rows: COMPANION_ROWS },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Persisting through the shadowed useLocalStorage means the preference
          is available synchronously on first render -- no flash of the wrong
          scheme -- and Mantine&apos;s own state is kept in sync via a
          before-paint layout effect that only fires when the two actually
          differ (Mantine&apos;s setColorScheme briefly suppresses every CSS
          transition on the page as its own anti-flicker move, so calling it on
          every render would freeze unrelated animations). Render off
          computedColorScheme; treat colorScheme as the raw preference, which
          can be &apos;auto&apos;.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
