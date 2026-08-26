import { Table, Text } from '@ui/core';
import { CodeBlock } from '../../components/CodeBlock';
import { DocPage, DocSection } from '../DocPage';

// The real rule message from eslint.config.js's `mantineWall` helper.
const WRONG_VS_RIGHT = [
  '// Banned in app code (src/app/**, src/main.tsx) -- ESLint reports:',
  "//   Import from '@ui/core' instead. The kit barrel adds fixed",
  '//   defaults and overrides.',
  "import { Button } from '@mantine/core';",
  '',
  '// The fix is always the same one-line change:',
  "import { Button } from '@ui/core';",
].join('\n');

// The stricter kit-internal rule, quoted from eslint.config.js.
const KIT_INTERNAL_RULE = [
  "// Inside src/ui/** a second, stricter rule applies: even kit code can't",
  '// import the raw Mantine Table/TextInput past their shadows.',
  "'no-restricted-imports': ['error', {",
  '  paths: [{',
  "    name: '@mantine/core',",
  "    importNames: ['Table', 'TextInput'],",
  "    message: 'Use the shadowed versions from @ui/core.',",
  '  }],',
  '}]',
].join('\n');

// How the barrel layers shadows on top of the star export, from
// src/ui/core/index.ts.
const BARREL_ORDER = [
  "export * from '@mantine/core';",
  "export * from '@mantine/dates';",
  '',
  '// Named exports win over colliding star-exported names, so these',
  '// shadows replace the Mantine originals for every @ui/core caller.',
  "export { Table } from './table/Table';",
  "export { TextInput } from './text-input/TextInput';",
].join('\n');

const WALL_MAP: { banned: string; barrel: string }[] = [
  { banned: '@mantine/core', barrel: '@ui/core' },
  { banned: '@mantine/hooks', barrel: '@ui/hooks' },
  { banned: '@mantine/form', barrel: '@ui/forms' },
  { banned: '@mantine/modals', barrel: '@ui/modals' },
  { banned: '@mantine/notifications', barrel: '@ui/notifications' },
  { banned: '@mantine/spotlight', barrel: '@ui/spotlight' },
  { banned: '@mantine/code-highlight', barrel: '@ui/lazy' },
  { banned: '@mantine/dates', barrel: '@ui/core' },
  { banned: 'lucide-react / react-icons', barrel: '@ui/icons' },
  { banned: 'codemirror / @codemirror/*', barrel: '@ui/lazy' },
];

export function ImportWallsPage() {
  return (
    <DocPage
      title="Import walls"
      lead="App code never imports Mantine packages directly. An ESLint no-restricted-imports rule maps each Mantine package to the @ui/* barrel that replaces it, so the kit's defaults and overrides are the only way anything Mantine-shaped enters the app."
    >
      <DocSection title="Why">
        <Text size="sm">
          The barrels re-export all of Mantine (@ui/core is{' '}
          <code>export * from &apos;@mantine/core&apos;</code> plus
          @mantine/dates), then layer the kit on top: two shadowed components
          with kit defaults (Table, TextInput), the kit&apos;s own components,
          and the typed facades. One theme of defaults, one place to fix a
          component for every caller.
        </Text>
        <CodeBlock code={WRONG_VS_RIGHT} language="tsx" minHeight={172} />
      </DocSection>

      <DocSection title="What maps where">
        <Table.ScrollContainer minWidth={420}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Banned in app code</Table.Th>
                <Table.Th>Import instead</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {WALL_MAP.map(({ banned, barrel }) => (
                <Table.Tr key={banned}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {banned}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {barrel}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed">
          Never disable the rule at a call site in app code -- the point of the
          wall is that app code never needs to. The rule is scoped to everything
          under src/ except the kit itself, so it applies to src/app/** and
          src/main.tsx alike.
        </Text>
      </DocSection>

      <DocSection title="Inside the kit: the shadow rule">
        <Text size="sm">
          The kit&apos;s own files are subject to a second wall: nothing under
          src/ui/** may import the named Table/TextInput exports straight from
          @mantine/core (their shadow definition files are the one sanctioned
          exception, documented inline). Any kit component that needs a table or
          text input goes through @ui/core, same as app code does.
        </Text>
        <CodeBlock code={KIT_INTERNAL_RULE} language="js" minHeight={214} />
      </DocSection>

      <DocSection title="How shadowing works">
        <Text size="sm">
          Per the ES module spec, a named export always wins over a colliding
          name introduced by an <code>export *</code> in the same module. The
          convention in the barrels is still to place shadows after the star
          line, so each barrel reads top-to-bottom as &quot;everything from
          Mantine, then the kit&apos;s overrides on top&quot;.
        </Text>
        <CodeBlock code={BARREL_ORDER} language="ts" minHeight={172} />
      </DocSection>
    </DocPage>
  );
}
