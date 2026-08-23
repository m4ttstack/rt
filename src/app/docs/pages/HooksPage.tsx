import { Anchor, Table, Text } from '@ui/core';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath, type DocsSlug } from '../docsNav';

const SCHEME_HOOKS_SNIPPET = [
  "import { useColorScheme, useLightDark } from '@ui/hooks';",
  '',
  'const { colorScheme, computedColorScheme, isDarkMode, toggleColorScheme,',
  '  setColorScheme, lightDark } = useColorScheme();',
  "// colorScheme: the stored preference -- 'light' | 'dark' | 'auto'",
  "// computedColorScheme: 'auto' resolved against the OS -- 'light' | 'dark'",
  '// isDarkMode / isLightMode: the resolved scheme as a boolean',
  '// Backed by the kit useLocalStorage shadow: read synchronously on first',
  '// render, so there is no flash of the wrong scheme.',
  '',
  '// lightDark picks a value per resolved scheme; useLightDark() is the',
  '// standalone picker (the same function without the rest of the hook):',
  'const pick = useLightDark();',
  "const shadow = pick('sm', 'none');",
].join('\n');

// The load-bearing storage shadow, quoted from src/ui/hooks/useStorage.ts.
const STORAGE_SNIPPET = [
  "import { useLocalStorage, useSessionStorage } from '@ui/hooks';",
  '',
  "// Mantine's own getInitialValueInEffect defaults to true, which reads the",
  '// stored value in an effect (after first paint) -- a guaranteed flash of',
  '// the default value. The kit shadows both storage hooks to read',
  '// synchronously on first render instead (still overridable per call):',
  'const [value, setValue] = useLocalStorage({',
  "  key: 'sidebar-collapsed',",
  '  defaultValue: false,',
  '});',
].join('\n');

// One-liners transcribed from src/ui/hooks/** doc comments; each row links
// to the hook's reference page (pair hooks share one).
const HOOKS: { name: string; purpose: string; slug: DocsSlug }[] = [
  {
    name: 'useSchemeColors()',
    purpose:
      'The layered bg.level1..4 elevation tokens plus text.normal/muted/dimmed, as scheme-aware CSS var references.',
    slug: 'hooks/use-scheme-colors',
  },
  {
    name: 'useColorScheme()',
    purpose:
      'Persisted scheme preference: { colorScheme, computedColorScheme, isDarkMode, isLightMode, toggleColorScheme, setColorScheme, lightDark }.',
    slug: 'hooks/use-color-scheme',
  },
  {
    name: 'useLightDark()',
    purpose:
      'Returns the lightDark(light, dark) picker, resolving against the computed scheme.',
    slug: 'hooks/use-color-scheme',
  },
  {
    name: 'useStoredColorScheme()',
    purpose:
      "The raw persisted 'light' | 'dark' | 'auto' preference as a [value, set] pair.",
    slug: 'hooks/use-color-scheme',
  },
  {
    name: 'useLocalStorage / useSessionStorage',
    purpose:
      "Mantine's storage hooks shadowed with getInitialValueInEffect: false -- the stored value is read synchronously on first render, so there is no flash of the default.",
    slug: 'hooks/use-storage',
  },
  {
    name: 'useUIState(defaultValue)',
    purpose:
      'Returns [state, setState, deferredValue] -- the deferred value lets expensive renders lag a frame behind.',
    slug: 'hooks/use-ui-state',
  },
  {
    name: 'useStoredUIState(defaultValue, key)',
    purpose: 'Same tuple, persisted through the useLocalStorage shadow.',
    slug: 'hooks/use-ui-state',
  },
  {
    name: 'useIsMobile()',
    purpose:
      "True once the viewport is measured and at/below the theme's sm breakpoint.",
    slug: 'hooks/use-is-mobile',
  },
  {
    name: 'useHasOverflowX()',
    purpose:
      'Returns { ref, hasOverflow }; tracks horizontal overflow via a ResizeObserver.',
    slug: 'hooks/use-has-overflow-x',
  },
  {
    name: 'useHoverableTextStyle()',
    purpose:
      'Dotted-underline style object for text that should read as clickable.',
    slug: 'hooks/use-hoverable-text-style',
  },
];

// Hooks documented with their compound components rather than in the Hooks
// group.
const COMPONENT_HOOKS: { name: string; purpose: string; slug: DocsSlug }[] = [
  {
    name: 'useRailState()',
    purpose:
      "The rail chrome's open/expand wiring (mobile expand-then-open rule included) -- on the RailShell page.",
    slug: 'components/rail-shell',
  },
  {
    name: 'usePageShellContext()',
    purpose:
      "Read the shell's shared state from custom sub-components -- on the PageShell page.",
    slug: 'components/page-shell',
  },
];

export function HooksPage() {
  return (
    <DocPage
      title="Hooks"
      lead="Everything from @mantine/hooks re-exported unchanged from @ui/hooks, plus the kit's own scheme, storage, and utility hooks -- and two deliberate shadows that fix a first-paint flash."
    >
      <DocSection title="Reference">
        <Text size="sm">
          This table is the cheat sheet; every hook name links to its full
          reference page (live demo, options, returns) in the Hooks sidebar
          group.
        </Text>
        <Table.ScrollContainer minWidth={520}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Hook</Table.Th>
                <Table.Th>What it does</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...HOOKS, ...COMPONENT_HOOKS].map(({ name, purpose, slug }) => (
                <Table.Tr key={name}>
                  <Table.Td>
                    <Anchor
                      component={Link}
                      href={docsPath(slug)}
                      size="sm"
                      fw={600}
                      ff="monospace"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{purpose}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed">
          useRailState and usePageShellContext only exist as part of their
          compound components, so their rows link to the RailShell and PageShell
          reference pages instead of a hooks page.
        </Text>
      </DocSection>

      <DocSection title="Color scheme hooks">
        <Text size="sm">
          The kit persists the scheme preference itself (localStorage key
          ui-color-scheme) instead of using Mantine&apos;s built-in scheme
          manager, so the preference is available synchronously on first render.
          Render off computedColorScheme; treat colorScheme as the raw
          preference, which can be &apos;auto&apos;.
        </Text>
        <CodeBlock code={SCHEME_HOOKS_SNIPPET} language="tsx" minHeight={214} />
      </DocSection>

      <DocSection title="Storage hooks: the anti-flash shadow">
        <Text size="sm">
          Always import storage hooks from @ui/hooks, never @mantine/hooks
          directly (the import wall bans the raw import in app code anyway). The
          shadowing is the load-bearing bit:
        </Text>
        <CodeBlock code={STORAGE_SNIPPET} language="tsx" minHeight={236} />
        <Text size="xs" c="dimmed">
          Inside the kit itself, only src/ui/hooks/useStorage.ts is allowed to
          reach the real @mantine/hooks versions. Callers can still opt back
          into the effect-based read explicitly by passing
          getInitialValueInEffect: true.
        </Text>
      </DocSection>
    </DocPage>
  );
}
