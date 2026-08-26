import { Group, Paper, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icon } from '@ui/icons';
import type { IconName } from '@ui/icons';
import { CodeBlock } from '../../components/CodeBlock';
import { DocPage, DocSection } from '../DocPage';

const USAGE_SNIPPET = [
  "import { Icon, ICON_NAMES, Icons } from '@ui/icons';",
  '',
  '// By registry name (typed: name is the IconName union):',
  '<Icon name="trash" size={16} />',
  '',
  '// Or directly, when the icon is statically known:',
  '<Icons.search size={14} />',
  '',
  '// Or enumerate the whole registry (icon pickers, galleries):',
  'ICON_NAMES.map(name => <Icon key={name} name={name} />);',
].join('\n');

const ADD_ICON_SNIPPET = [
  '// src/ui/icons/Icons.ts',
  "import { Trash2 } from 'lucide-react';",
  "import { lucideWrapperFn } from './lucideWrapperFn';",
  '',
  'const ActionIcons = {',
  '  trash: lucideWrapperFn(Trash2),',
  '  // add yours to whichever category object fits...',
  '};',
  '',
  '// ...which is spread into the exported registry:',
  'export const Icons = {',
  '  ...ActionIcons,',
  '  // ...NavigationIcons, UIControlIcons, FeedbackIcons, MiscIcons,',
  '  ...BrandIcons, // spread last so brand icons can shadow generic names',
  '};',
].join('\n');

const BRAND_ICON_SNIPPET = [
  '// src/ui/icons/brand-icons/',
  "import type { IconComponent, IconProps } from '../types';",
  "import { MyLogo } from './MyLogo';",
  '',
  'export const BrandIcons = {',
  '  myLogo: ({ size = 16, ...rest }: IconProps) => (',
  '    <MyLogo width={size} height={size} {...rest} />',
  '  ),',
  '} satisfies Record<string, IconComponent>;',
].join('\n');

const SAMPLE_ICONS: IconName[] = [
  'search',
  'trash',
  'settings',
  'bell',
  'check',
  'warning',
  'layers',
  'terminal',
];

function IconStrip() {
  const { bg } = useSchemeColors();

  return (
    <Group gap="sm" wrap="wrap">
      {SAMPLE_ICONS.map(name => (
        <Paper key={name} withBorder bg={bg.level2} p="sm" w={96}>
          <Stack gap={6} align="center">
            <Icon name={name} size={18} />
            <Text size="xs" ff="monospace" c="dimmed">
              {name}
            </Text>
          </Stack>
        </Paper>
      ))}
    </Group>
  );
}

export function IconsPage() {
  return (
    <DocPage
      title="Icons"
      lead="All icons go through the registry in src/ui/icons/Icons.ts -- nothing imports lucide-react directly outside that file (the import wall bans it), and react-icons is banned outright. A closed, typed name union means every <Icon name> is checked at compile time."
    >
      <DocSection title="Using icons">
        <Text size="sm">
          Import Icon (dynamic lookup by name) or Icons (the registry object)
          from @ui/icons. Every entry accepts the full lucide/SVG prop surface
          (IconProps = LucideProps): size (default 16), strokeWidth (default
          1.5, lighter than lucide&apos;s own 2), color, className, style, and
          any SVG attribute. A few from the registry:
        </Text>
        <IconStrip />
        <CodeBlock code={USAGE_SNIPPET} language="tsx" minHeight={230} />
        <Text size="xs" c="dimmed">
          Names come in two flavors that both autocomplete: literal glyph names
          (trash, plus) and semantic aliases (delete, add, cancel, help,
          success) pointing at the same icons. ICON_NAMES is the registry&apos;s
          runtime name list (typed as the IconName union, derived from the
          registry so it can&apos;t drift); ICON_CATEGORIES groups them.
          registry-builder entries can pass a second {'{ filled: true }'} arg
          for a solid glyph. For a searchable gallery, open the Icons/Registry
          story in Storybook (bun run storybook).
        </Text>
      </DocSection>

      <DocSection title="Adding a lucide icon">
        <Text size="sm">
          Import it from lucide-react at the top of Icons.ts, wrap it with
          lucideWrapperFn (which adapts a LucideIcon to the kit&apos;s prop
          surface), and add it to whichever category object fits. IconName is
          derived from the registry itself (keyof typeof Icons), so the new
          entry is immediately a valid <code>&lt;Icon name&gt;</code> value with
          no separate list to update.
        </Text>
        <CodeBlock code={ADD_ICON_SNIPPET} language="ts" minHeight={320} />
        <Text size="xs" c="dimmed">
          src/ui/icons/Icons.test.ts guards the registry against any entry that
          resolves to undefined (e.g. a typo&apos;d lucide import name that
          silently imports undefined).
        </Text>
      </DocSection>

      <DocSection title="Brand icons">
        <Text size="sm">
          src/ui/icons/brand-icons is an intentionally empty slot for a
          product&apos;s own logo/brand SVGs, spread into the registry last so a
          brand icon can shadow a generic name if it ever needs to. Wrap each
          SVG so it satisfies IconComponent -- same contract as a wrapped lucide
          icon.
        </Text>
        <CodeBlock code={BRAND_ICON_SNIPPET} language="tsx" minHeight={214} />
        <Text size="xs" c="dimmed">
          Using satisfies (rather than a Record type annotation) keeps the
          inferred type as the literal object with no index signature, so
          spreading BrandIcons into Icons doesn&apos;t widen IconName to a bare
          string.
        </Text>
      </DocSection>
    </DocPage>
  );
}
