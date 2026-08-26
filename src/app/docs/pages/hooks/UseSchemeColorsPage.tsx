import { Box, Group, Paper, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useSchemeColors } from '@ui/hooks';",
  '',
  'const { bg, text } = useSchemeColors();',
  '',
  '<Paper bg={bg.level2} p="md">',
  '  <Text c={text.muted}>A raised surface on the page background</Text>',
  '</Paper>;',
  '',
  '// Non-React code (module scope, style constants): the same map as a',
  '// plain object.',
  "import { staticSchemeColors } from '@ui/hooks';",
].join('\n');

// Rows transcribed from src/ui/hooks/useSchemeColors.ts.
const RETURN_ROWS = [
  {
    name: 'bg.level1 .. bg.level4',
    type: 'string (CSS var reference)',
    note: "The four scheme-aware surface slots ('var(--ui-bg-1)' ..). level1 the page, level2 the default surface, level3 nested inside it, level4 the contrast/accent surface (deeper in light, lighter in dark).",
  },
  {
    name: 'text.normal',
    type: 'string',
    note: 'var(--mantine-color-text) -- the default body text color.',
  },
  {
    name: 'text.muted',
    type: 'string',
    note: 'var(--mantine-color-dimmed) -- secondary text.',
  },
  {
    name: 'text.dimmed',
    type: 'string',
    note: 'var(--ui-text-dimmed) -- the most subdued step, per-scheme in scheme-vars.css (used by useHoverableTextStyle for its underline).',
  },
];

function TokenSwatches() {
  const { bg, text } = useSchemeColors();
  const levels = [
    { label: 'bg.level1', value: bg.level1, role: 'page' },
    { label: 'bg.level2', value: bg.level2, role: 'surface' },
    { label: 'bg.level3', value: bg.level3, role: 'nested' },
    { label: 'bg.level4', value: bg.level4, role: 'most raised' },
  ];

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="wrap">
        {levels.map(({ label, value, role }) => (
          <Paper key={label} bg={value} withBorder p="sm" w={128}>
            <Text size="xs" fw={600} ff="monospace">
              {label}
            </Text>
            <Text size="xs" c="dimmed">
              {role}
            </Text>
          </Paper>
        ))}
      </Group>
      {/* The ramp nested for real: each surface on the one below it. */}
      <Box bg={bg.level1} p="sm" style={{ borderRadius: 8 }}>
        <Box bg={bg.level2} p="sm" style={{ borderRadius: 8 }}>
          <Box bg={bg.level3} p="sm" style={{ borderRadius: 8 }}>
            <Box bg={bg.level4} p="sm" style={{ borderRadius: 8 }}>
              <Text size="xs" ff="monospace">
                level1 &gt; level2 &gt; level3 &gt; level4
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
      <Group gap="lg">
        <Text size="sm" c={text.normal}>
          text.normal
        </Text>
        <Text size="sm" c={text.muted}>
          text.muted
        </Text>
        <Text size="sm" c={text.dimmed}>
          text.dimmed
        </Text>
      </Group>
    </Stack>
  );
}

export function UseSchemeColorsPage() {
  return (
    <ComponentDoc
      title="useSchemeColors"
      lead="The kit's layered background and text tokens as scheme-aware CSS variable references: bg.level1 through bg.level4 plus text.normal/muted/dimmed. Surfaces use these instead of hardcoding a gray, so elevation stays consistent and flips with the color scheme automatically."
      demoIntro="Live swatches -- flip the rail's scheme toggle and watch every one of them re-resolve."
      demo={<TokenSwatches />}
      usage={USAGE}
      usageMinHeight={310}
      propsTables={[{ title: 'Returns', rows: RETURN_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The values are pure CSS var references that resolve per color scheme
          on their own, so the hook holds no React state -- staticSchemeColors
          is the identical map for non-component code, and the hook form exists
          for API symmetry. The per-scheme definitions live in
          src/ui/styles/scheme-vars.css; the monotonic ladder is the kit
          default, not the contract -- consumers may re-point the four slots to
          role-based surfaces per scheme (the Theming guide and AGENTS.md
          section 4 cover the surface-slot contract).
        </Text>
        <Text size="sm">
          The four levels are also registered as theme colors (bg-level-1
          through bg-level-4, every shade the same var), so they autocomplete
          and resolve anywhere a Mantine color prop is accepted:
          bg=&quot;bg-level-2&quot; is equivalent to bg=
          {'{bg.level2}'} without importing the hook.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
