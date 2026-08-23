import { Anchor, Group, Paper, Table, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath } from '../docsNav';

const BG_LEVELS_SNIPPET = [
  "import { useSchemeColors } from '@ui/hooks';",
  '',
  'const { bg, text } = useSchemeColors();',
  '// bg.level1 (page) -> bg.level3 step quietly away; bg.level4 is the',
  '// contrast/accent surface (deeper in light, lighter in dark).',
  '',
  '<Paper bg={bg.level2} p="md">',
  '  <Text c={text.muted}>A raised surface on the page background</Text>',
  '</Paper>',
  '',
  '// The levels are also registered as theme colors (every shade the same',
  '// var), so they autocomplete anywhere a Mantine color prop is accepted:',
  '<Paper bg="bg-level-2" p="md" />',
].join('\n');

// The per-scheme definitions behind the ramp, from src/ui/styles/scheme-vars.css.
const SCHEME_VARS_SNIPPET = [
  ":root[data-mantine-color-scheme='light'] {",
  '  --ui-bg-1: var(--mantine-color-body);',
  '  --ui-bg-2: var(--mantine-color-gray-0);',
  '  --ui-bg-3: var(--mantine-color-gray-1);',
  '  --ui-bg-4: var(--mantine-color-gray-3);',
  '}',
  ":root[data-mantine-color-scheme='dark'] {",
  '  --ui-bg-1: var(--mantine-color-body);',
  '  --ui-bg-2: var(--mantine-color-dark-8);',
  '  --ui-bg-3: var(--mantine-color-dark-9);',
  '  --ui-bg-4: var(--mantine-color-dark-5);',
  '}',
].join('\n');

const THEME_OVERRIDE_SNIPPET = [
  "import { ThemeOverrideWrapper } from '@ui/design-system';",
  '',
  "<ThemeOverrideWrapper theme={{ primaryColor: 'teal' }}>",
  '  {/* merged onto the ancestor MantineProvider theme -- this subtree only */}',
  '  <Button>Teal here, indigo everywhere else</Button>',
  '</ThemeOverrideWrapper>',
].join('\n');

const WITH_PROPS_SNIPPET = [
  "import { Badge, TextInput } from '@ui/core';",
  "import type { TextInputProps } from '@ui/core';",
  "import { Icons } from '@ui/icons';",
  '',
  '// Mantine factory components: the typed static .withProps.',
  'const SquareBadge = Badge.withProps({ radius: 0 });',
  '// Polymorphism preserved: <SquareBadge component="a" href="/promo" />',
  '',
  '// Kit shadows / custom components (no static): a small wrapper.',
  'function CompactSearchInput(props: TextInputProps) {',
  '  return (',
  '    <TextInput',
  '      size="xs"',
  '      placeholder="Search…"',
  '      leftSection={<Icons.search size={14} />}',
  '      {...props} // caller props win over the preset',
  '    />',
  '  );',
  '}',
].join('\n');

const THEME_ISLAND_SNIPPET = [
  "import { baseTheme, ThemeIsland } from '@ui/design-system';",
  '',
  '// The kit look, inside an app with a heavy brand. One import, no',
  '// transcription, nothing to keep in sync.',
  '<ThemeIsland theme={baseTheme} baseSurfaces>',
  '  <PipelineDebugger />',
  '</ThemeIsland>;',
].join('\n');

// Transcribed from src/ui/design-system/base-theme.ts.
const THEME_DEFAULTS: { setting: string; value: string; why: string }[] = [
  {
    setting: 'primaryColor',
    value: 'indigo',
    why: 'The kit accent, used by every filled control.',
  },
  {
    setting: 'colors',
    value: 'bg-level-1 ... bg-level-4 (every shade = var(--ui-bg-N))',
    why: 'The background ramp as named, autocompleting colors -- bg="bg-level-2" works anywhere a color prop is accepted.',
  },
  {
    setting: 'primaryShade',
    value: '{ light: 7, dark: 7 }',
    why: "Mantine's default (6) reads pale against the level-2/3 surfaces; 7 holds contrast in both schemes. Object form deliberately: a scalar here collapses to {} when merged with an app theme's object form, which blanks the page.",
  },
  {
    setting: 'defaultRadius',
    value: 'md',
    why: 'One radius everywhere unless a component opts out.',
  },
  {
    setting: 'headings.fontWeight',
    value: '500',
    why: 'Medium headings instead of bold.',
  },
  {
    setting: 'Paper / Card',
    value: 'shadow: none, withBorder: false',
    why: 'Flat by default; opt into shadow/withBorder per usage.',
  },
  { setting: 'Button', value: 'fw: 500', why: 'Medium button labels.' },
  {
    setting: 'Modal',
    value: 'centered: true, padding: lg',
    why: 'Modals center and breathe by default.',
  },
  {
    setting: 'Group',
    value: "wrap: 'nowrap', gap: 'xs'",
    why: 'The common case is a tight row of controls on one line, not a wrapping container.',
  },
  {
    setting: 'Select',
    value: 'allowDeselect: false',
    why: "Re-clicking the selected option shouldn't silently empty the field.",
  },
  {
    setting: 'Badge',
    value: "variant: 'light', fw: 500, textTransform: none",
    why: 'Badges read as labels, not shouting (Mantine uppercases by default).',
  },
  {
    setting: 'Code',
    value: 'fz: sm',
    why: 'Inline code sits a step below body text.',
  },
  {
    setting: 'NavLink',
    value: 'fz: sm',
    why: 'Nav labels sit a step below body text (token, not a hardcoded px).',
  },
  {
    setting: 'ScrollArea',
    value: "type: 'auto'",
    why: 'Scrollbars appear on hover/scroll rather than always showing.',
  },
  {
    setting: 'Switch',
    value: 'label/track cursor: pointer',
    why: 'The whole switch is a click target; the cursor says so.',
  },
  {
    setting: 'TextInput variants',
    value: "variant: 'underline' | 'borderless'",
    why: "Two extra input looks beyond Mantine's own, via the theme classNames.",
  },
  {
    setting: 'breakpoints.xxl',
    value: '1920px',
    why: 'One step past xl for layouts that keep growing on very wide displays.',
  },
  {
    setting: 'Tooltip',
    value:
      "withArrow, openDelay: 500, position: 'bottom', offset: 10, multiline, w: auto, maw: 400, p: sm / px: md, transition: 'pop-top-left' (400ms, pops down)",
    why: 'Arrowed tooltips that pop down out of the hovered element, do not fire on drive-by hovers, and give long labels room to wrap.',
  },
  {
    setting: 'Menu',
    value:
      "transition: 'pop-top-left', shadow: md; dropdown p: xs / miw: 200; item p: sm; divider my: xs",
    why: 'Dropdowns share the tooltip pop-in, lift off the page, and carry roomier density.',
  },
  {
    setting: 'Popover / HoverCard',
    value: 'shadow: md',
    why: 'Floating layers separate from the page consistently (their built-in fade stays).',
  },
  {
    setting: 'Notification',
    value: 'shadow: md (via classNames)',
    why: 'Notifications read as floating layers, like menus and popovers.',
  },
  {
    setting: 'Anchor',
    value: "underline: 'hover', c: 'blue'",
    why: 'Links underline on hover and read as links regardless of the accent color.',
  },
];

function BgLevelSwatches() {
  const { bg } = useSchemeColors();
  const levels = [
    { label: 'bg.level1', value: bg.level1, description: 'page' },
    { label: 'bg.level2', value: bg.level2, description: 'surface' },
    { label: 'bg.level3', value: bg.level3, description: 'nested' },
    { label: 'bg.level4', value: bg.level4, description: 'accent' },
  ];

  return (
    <Group gap="sm" wrap="wrap">
      {levels.map(({ label, value, description }) => (
        <Paper key={label} bg={value} withBorder p="sm" w={132}>
          <Text size="xs" fw={600} ff="monospace">
            {label}
          </Text>
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        </Paper>
      ))}
    </Group>
  );
}

export function ThemingPage() {
  return (
    <DocPage
      title="Theming & layered backgrounds"
      lead="One theme of kit-wide defaults, a four-level scheme-aware background ramp, and two override escape hatches: a per-subtree theme wrapper and per-call-site prop presets."
    >
      <DocSection title="The background ramp: bg.level1 to bg.level4">
        <Text size="sm">
          Surfaces never hardcode a gray: useSchemeColors exposes four elevation
          tokens, bg.level1 through bg.level4, backed by CSS variables that swap
          per color scheme automatically. These swatches are live -- flip the
          header&apos;s scheme toggle and watch them re-resolve:
        </Text>
        <BgLevelSwatches />
        <CodeBlock code={BG_LEVELS_SNIPPET} language="tsx" minHeight={214} />
        <Text size="sm">
          level1 is the page itself, level2 the default surface (cards, panels),
          level3 a surface nested inside that (wells, content areas), and level4
          the contrast/accent surface (hover/active states; the Table
          shadow&apos;s header accent uses it). Levels 1 through 3 step
          progressively away from the page in the quiet direction -- gradually
          deeper greys in light, gradually deeper darks in dark -- while level4
          is the deliberate contrast step, deeper still in light but lighter in
          dark, so an accent surface always reads as distinct from the page.
        </Text>
        <CodeBlock code={SCHEME_VARS_SNIPPET} language="css" minHeight={278} />
        <Text size="sm">
          The contract, though, is four scheme-aware surface <em>slots</em>, not
          the ordering: re-theming apps may remap the four vars to role-based
          surfaces (page/card/well/pill) that are not a lightness ladder, and
          that&apos;s supported. Kit components therefore never bake in the
          ordering -- a component that reads a slot for its own surface exposes
          an override point defaulting to the kit value
          (AnimatedBorderBox&apos;s static interior fill reads --abb-fill,
          falling back to --ui-bg-2). See AGENTS.md section 4 for the full
          contract.
        </Text>
      </DocSection>

      <DocSection title="Kit-wide theme defaults">
        <Text size="sm">
          Defaults live in src/ui/design-system/base-theme.ts, via createTheme and
          Mantine&apos;s string-keyed components map (the theme&apos;s typed
          defaults() helper) -- deliberately not each component&apos;s own{' '}
          <code>.extend({'{ defaultProps }'})</code>, which would import every
          extended component into the theme module and pin it into bundles that
          never render it. Add a new component-wide default the same way
          (importing only the Props type) -- it applies to every instance
          app-wide.
        </Text>
        <Table.ScrollContainer minWidth={560}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Setting</Table.Th>
                <Table.Th>Default</Table.Th>
                <Table.Th>Why</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {THEME_DEFAULTS.map(({ setting, value, why }) => (
                <Table.Tr key={setting}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {setting}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace" c="dimmed">
                      {value}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{why}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed">
          primaryShade is tuned for the default indigo on the default
          background ramp. If a re-theme re-tunes it, dark mode generally wants
          the <em>lighter</em> of the two shades (a brighter accent holds
          contrast on dark surfaces) -- and consider autoContrast so filled
          variants keep readable labels. Keep the {'{ light, dark }'} object
          form: Mantine&apos;s deepMerge collapses a scalar to {'{}'} when the
          other theme in a nested pair uses the object form.
        </Text>
      </DocSection>

      <DocSection title="Per-subtree overrides: ThemeOverrideWrapper">
        <Text size="sm">
          For one section that needs something different (a different
          primaryColor, a different component default), ThemeOverrideWrapper
          merges a partial override onto whatever MantineProvider is already in
          the tree. It requires an ancestor provider -- always true inside the
          app.
        </Text>
        <CodeBlock
          code={THEME_OVERRIDE_SNIPPET}
          language="tsx"
          minHeight={150}
        />
        <Text size="sm" c="dimmed">
          <Anchor
            component={Link}
            href={docsPath('components/theme-override-wrapper')}
            size="sm"
            fw={500}
          >
            ThemeOverrideWrapper&apos;s reference page
          </Anchor>{' '}
          has the props table and a live side-by-side scoped-theme demo.
        </Text>
      </DocSection>

      <DocSection title="Per-subtree baselines: ThemeIsland">
        <Text size="sm">
          The wrapper above ADDS a treatment. It cannot remove one: merging only
          adds, so an absent key inherits the ancestor&apos;s value and undoing
          a brand would mean individually restating every treatment in it. When
          the ask is &quot;make this route look like the kit again&quot; -- a
          dev tool, an embedded admin view, a print layout -- provide a baseline
          instead of subtracting from a brand.
        </Text>
        <CodeBlock code={THEME_ISLAND_SNIPPET} language="tsx" minHeight={150} />
        <Text size="sm">
          That works because baseTheme is a separate kit-owned export the app
          brand merges ON TOP of, rather than a file the brand edits in place.
          The brand lives in app-theme.ts, which is the only theme file a
          consuming app touches; base-theme.ts and theme.ts stay byte-identical
          to the kit and fast-forward on every sync. baseSurfaces restores the
          --ui-bg-* ramp the same way, for apps that remapped it.
        </Text>
        <Text size="sm" c="dimmed">
          <Anchor
            component={Link}
            href={docsPath('components/theme-island')}
            size="sm"
            fw={500}
          >
            ThemeIsland&apos;s reference page
          </Anchor>{' '}
          covers the props and why a bare nested MantineProvider gets subtree
          theming wrong three different ways, each silently.
        </Text>
      </DocSection>

      <DocSection title="Deep-linking a scheme">
        <Text size="sm">
          Two small escape hatches for code that needs the color scheme outside
          a component tree. <code>getColorSchemeFromDocument()</code> reads the
          resolved scheme straight off <code>{'document.documentElement'}</code>
          &apos;s <code>data-mantine-color-scheme</code> attribute -- for
          non-React / module-scope code that needs it without a hook.{' '}
          <code>ThemeInitializer</code>, mounted once near the app root, applies
          a <code>?theme=dark</code> or <code>?theme=light</code> URL query
          param to the persisted preference on mount and then strips it from the
          URL -- handy for deep-linking a scheme into docs, embeds, or
          screenshots.
        </Text>
      </DocSection>

      <DocSection title="Per-call-site presets: .withProps and small wrappers">
        <Text size="sm">
          For Mantine&apos;s own factory components (Button, Badge, Paper, ...),
          use the typed static .withProps they all carry (Badge.withProps(
          {'{ radius: 0 }'})): the preset is type-checked against the
          component&apos;s real props, and the returned component keeps the
          factory&apos;s full typing -- verified to include the polymorphic
          component/renderRoot surface, so a preset Badge still renders as an
          anchor with a typed href.
        </Text>
        <CodeBlock code={WITH_PROPS_SNIPPET} language="tsx" minHeight={406} />
        <Text size="xs" c="dimmed">
          Kit shadows and your own components (plain function or forwardRef,
          like the kit&apos;s TextInput shadow) have no static .withProps. For
          those, write a small wrapper component that spreads caller props after
          the defaults -- callers can then override any preset value, and the
          wrapper&apos;s prop type stays the component&apos;s own. The
          kit&apos;s ContentContainer (Container.withProps in
          src/ui/core/content-container/) shows the static in kit code;
          CompactSearchInput in the snippet above shows the wrapper pattern.
        </Text>
      </DocSection>
    </DocPage>
  );
}
