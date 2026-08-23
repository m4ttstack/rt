import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from '@ui/core';
import { baseTheme, ThemeIsland } from '@ui/design-system';
import { useState } from 'react';

import { createTheme } from '@ui/core';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { baseTheme, ThemeIsland } from '@ui/design-system';",
  '',
  '// A dev-only route inside a heavily branded app, rendered in the kit',
  "// defaults. `baseSurfaces` restores the --ui-bg-* ramp too, for apps",
  '// that remapped it to their own role ladder.',
  '<ThemeIsland theme={baseTheme} baseSurfaces>',
  '  <PipelineDebugger />',
  '</ThemeIsland>;',
  '',
  '// A fidelity preview: the surrounding chrome runs on one theme, this',
  "// subtree must render exactly as production does. Pass the app's own",
  '// resolver, since a nested provider does not inherit it.',
  '<ThemeIsland theme={appTheme} cssVariablesResolver={appResolver}>',
  '  <LessonPreview />',
  '</ThemeIsland>;',
].join('\n');

// Rows transcribed from src/ui/design-system/ThemeIsland.tsx (ThemeIslandProps).
const PROPS_ROWS = [
  {
    name: 'theme',
    type: 'MantineThemeOverride',
    note: "Required. The theme this subtree renders in, REPLACING the ancestor's rather than merging onto it. Pass baseTheme to get the kit's own look back.",
  },
  {
    name: 'cssVariablesResolver?',
    type: 'CSSVariablesResolver',
    note: "The app's resolver, if it has one. A nested provider does not inherit it, so without this every resolver-injected token reverts to Mantine's stock derivation inside the island.",
  },
  {
    name: 'baseSurfaces?',
    type: 'boolean',
    note: "Also restores the kit's --ui-bg-* / --ui-text-* ramp (the .ui-base-surfaces class). Pair it with theme={baseTheme} in an app that remapped the ramp; the theme half and the CSS half are separate layers.",
  },
  {
    name: 'className? / style?',
    type: 'string / CSSProperties',
    note: 'Applied to the island element, which is a real box (unlike ThemeOverrideWrapper, which is display: contents).',
  },
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. The subtree that renders under the island theme.',
  },
];

const brandTheme = createTheme({
  primaryColor: 'orange',
  defaultRadius: 0,
  components: {
    Card: { defaultProps: { withBorder: true, shadow: 'none' } },
    Badge: { styles: { root: { textTransform: 'uppercase' } } },
  },
});

function DemoPanel({ label }: { label: string }) {
  return (
    <Card p="md" flex={1} miw={220}>
      <Stack gap="xs" align="flex-start">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            {label}
          </Text>
          <Badge variant="light">status</Badge>
        </Group>
        <Switch defaultChecked label="Notify on returns" />
        <Button size="xs">Check out gear</Button>
      </Stack>
    </Card>
  );
}

function ThemeIslandDemo() {
  const [inside, setInside] = useState('baseTheme');

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={inside}
        onChange={setInside}
        data={['baseTheme', 'brand theme']}
        w="fit-content"
      />
      <ThemeIsland theme={brandTheme}>
        <Group align="stretch" gap="md" p="md">
          <DemoPanel label="App brand" />
          <ThemeIsland
            theme={inside === 'baseTheme' ? baseTheme : brandTheme}
            baseSurfaces={inside === 'baseTheme'}
          >
            <DemoPanel label="Island" />
          </ThemeIsland>
        </Group>
      </ThemeIsland>
    </Stack>
  );
}

export function ThemeIslandPage() {
  return (
    <ComponentDoc
      title="ThemeIsland"
      lead="Renders one subtree in a different theme entirely, scoped so nothing leaks to the rest of the page -- the counterpart to ThemeOverrideWrapper, which adds a treatment to the ancestor theme instead of replacing it."
      demoIntro="Both panels sit inside an island carrying a heavy brand (square corners, orange, bordered cards, shouting badges). Switch the inner island between baseTheme and the brand to see the kit's own defaults come back with one import. The rest of this page is untouched either way."
      demo={<ThemeIslandDemo />}
      usage={USAGE}
      usageMinHeight={300}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Why not a bare nested MantineProvider">
        <Text size="sm">
          Nesting MantineProvider by hand gets three things wrong, and each
          fails silently. Its cssVariablesSelector defaults to :root, so the
          &quot;subtree&quot; theme is emitted globally and repaints the whole
          document. Mantine composes scheme blocks as
          selector[data-mantine-color-scheme=&quot;...&quot;], so the attribute
          has to sit on the same element as the scope class or dark mode simply
          does nothing inside the subtree. And MantineProvider runs its own
          color-scheme manager against the document root, seeded from its own
          defaultColorScheme of &apos;light&apos; -- mounting one inside an app
          set to &apos;auto&apos; can flip the entire page light on a
          dark-preference machine. ThemeIsland wires all three.
        </Text>
      </DocSection>
      <DocSection title="Notes">
        <Text size="sm">
          Reach for ThemeOverrideWrapper to ADD a treatment to a subtree, and
          ThemeIsland to REPLACE the theme. Subtracting is the case a merge
          cannot express: mergeThemeOverrides only adds, so removing a brand
          treatment would mean restating every one of them.
        </Text>
        <Text size="sm" c="dimmed">
          For where each kind of theming belongs -- kit-wide defaults in
          base-theme.ts, brand in app-theme.ts, per-subtree overrides, and
          per-call-site presets -- see{' '}
          <Anchor
            component={Link}
            href={docsPath('theming')}
            size="sm"
            fw={500}
          >
            the Theming guide
          </Anchor>
          .
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
