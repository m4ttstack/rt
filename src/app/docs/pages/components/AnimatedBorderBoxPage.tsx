import { AnimatedBorderBox, Group, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { AnimatedBorderBox } from '@ui/core';",
  '',
  '<AnimatedBorderBox p="md">Promoted card</AnimatedBorderBox>;',
  '',
  "<AnimatedBorderBox colors={['teal', 'cyan']} shade={5} p=\"md\">",
  '  Custom accents, tuned brighter',
  '</AnimatedBorderBox>;',
].join('\n');

// Rows transcribed from
// src/ui/core/animated-border-box/AnimatedBorderBox.tsx
// (AnimatedBorderBoxProps).
const PROPS_ROWS = [
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. Rendered inside the Paper the animated ring wraps.',
  },
  {
    name: 'colors?',
    type: '[primary, secondary]',
    note: "The two MantineColor accents of the border gradient. Default ['indigo', 'pink'].",
  },
  {
    name: 'shade?',
    type: '1..9',
    note: 'Shade index for both colors (the secondary uses shade - 1) -- a scheme-tuning knob, separate from which accents they are. Default 3.',
  },
  {
    name: 'loop?',
    type: 'boolean',
    note: 'Runs the spin animation forever vs. once. Default true.',
  },
  {
    name: 'enabled?',
    type: 'boolean',
    note: 'Renders children unwrapped when false. Default true.',
  },
  {
    name: 'style?',
    type: 'CSSProperties',
    note: "Also the override point for the interior fill: the static surface defaults to the kit's --ui-bg-2 slot and is read through the component-scoped --abb-fill custom property, settable here.",
  },
  {
    name: '...rest',
    type: 'PaperProps',
    note: 'Passthrough to the underlying Paper (p, w, radius, ...).',
  },
];

function AnimatedBorderBoxDemo() {
  return (
    <Group gap="md" align="flex-start" wrap="wrap">
      <AnimatedBorderBox p="md" w={230}>
        <Text fw={500} size="sm">
          Default accents
        </Text>
        <Text size="xs" c="dimmed">
          indigo / pink, shade 3
        </Text>
      </AnimatedBorderBox>
      <AnimatedBorderBox p="md" w={230} colors={['teal', 'cyan']} shade={5}>
        <Text fw={500} size="sm">
          Custom accents
        </Text>
        <Text size="xs" c="dimmed">
          colors={'{'}[&apos;teal&apos;, &apos;cyan&apos;]{'}'} shade={'{5}'}
        </Text>
      </AnimatedBorderBox>
    </Group>
  );
}

export function AnimatedBorderBoxPage() {
  return (
    <ComponentDoc
      title="AnimatedBorderBox"
      lead="A Paper with a slowly-rotating conic-gradient border -- an animated ornament for a promoted card or callout. CSS-only: the rotation is a registered @property animation, no JS-driven frames."
      demo={<AnimatedBorderBoxDemo />}
      usage={USAGE}
      usageMinHeight={190}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Only the border ring animates; the interior is a single static surface
          defaulting to the --ui-bg-2 slot, exposed as the --abb-fill custom
          property so a role-remapped app re-points the fill without touching
          the kit stylesheet (the override-point pattern from AGENTS section 4).
          The colors tuple is the kit&apos;s shared accent-prop convention;
          shade stays a separate prop because it tunes how the accents render,
          not which accents they are.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
