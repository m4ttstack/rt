import { Box, GradientBorder, Group, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { GradientBorder } from '@ui/core';",
  '',
  '<GradientBorder radius={12}>',
  '  <Box p="md">Default indigo/grape/pink ring</Box>',
  '</GradientBorder>;',
  '',
  "<GradientBorder colors={['teal', 'cyan', 'blue']} innerBg=" +
    "'transparent'>",
  '  <Box p="md">Custom stops; children bring their own surface</Box>',
  '</GradientBorder>;',
].join('\n');

// Rows transcribed from src/ui/core/gradient-border/GradientBorder.tsx
// (GradientBorderProps).
const PROPS_ROWS = [
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. Wrapped by the 2px gradient ring.',
  },
  {
    name: 'colors?',
    type: '[left, mid, right]',
    note: "Left/mid/right MantineColor stops of the border gradient, resolved through the generated --mantine-color-{name}-4 vars. Default ['indigo', 'grape', 'pink'].",
  },
  {
    name: 'radius?',
    type: 'number',
    note: 'Corner radius in px, shared by the outer border and inner content. Default 10.',
  },
  {
    name: 'innerBg?',
    type: 'string',
    note: "Background of the inner content box. Default 'var(--ui-bg-2)' (the kit's card surface slot); pass any CSS color/token, or 'transparent' to let the children bring their own surface.",
  },
  {
    name: 'enabled?',
    type: 'boolean',
    note: 'Renders children unwrapped when false. Default true.',
  },
  {
    name: '...rest',
    type: "div props (minus 'color')",
    note: 'Passthrough to the outer div; style merges over the gradient frame.',
  },
];

function GradientBorderDemo() {
  return (
    <Group gap="md" align="flex-start" wrap="wrap">
      <GradientBorder radius={12}>
        <Box p="md" w={220}>
          <Text fw={500} size="sm">
            Default stops
          </Text>
          <Text size="xs" c="dimmed">
            indigo / grape / pink on the bg.level2 inner surface
          </Text>
        </Box>
      </GradientBorder>
      <GradientBorder radius={12} colors={['teal', 'cyan', 'blue']}>
        <Box p="md" w={220}>
          <Text fw={500} size="sm">
            Custom stops
          </Text>
          <Text size="xs" c="dimmed">
            colors={'{'}[&apos;teal&apos;, &apos;cyan&apos;, &apos;blue&apos;]
            {'}'}
          </Text>
        </Box>
      </GradientBorder>
    </Group>
  );
}

export function GradientBorderPage() {
  return (
    <ComponentDoc
      title="GradientBorder"
      lead="Wraps its children in a thin (2px) three-color linear-gradient border: a gradient-filled outer frame whose inner box covers everything but the ring with its own surface."
      demo={<GradientBorderDemo />}
      usage={USAGE}
      usageMinHeight={230}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The colors tuple follows the kit&apos;s shared accent-prop convention:
          a component with several accents takes a single colors tuple sized to
          its need (here three gradient stops). Theme colors resolve through
          Mantine&apos;s generated CSS variables -- no hardcoded values. For an
          animated ring, see AnimatedBorderBox.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
