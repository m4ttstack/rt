import { Group, IconTooltip, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { IconTooltip } from '@ui/core';",
  '',
  '<Group gap={6}>',
  '  <Text size="sm" fw={500}>',
  '    Service interval',
  '  </Text>',
  '  <IconTooltip label="How often this item needs a maintenance check." />',
  '</Group>;',
].join('\n');

// Rows transcribed from src/ui/core/icon-tooltip/IconTooltip.tsx
// (IconTooltipProps).
const PROPS_ROWS = [
  {
    name: 'name?',
    type: 'IconName',
    note: "Registry icon to render as the trigger. Default 'questionCircle'.",
  },
  {
    name: 'size?',
    type: 'number',
    note: 'Trigger icon size in px. Default 18.',
  },
  {
    name: 'icon?',
    type: 'ReactNode',
    note: 'A custom trigger node instead of a registry icon (takes precedence over name).',
  },
  {
    name: 'label',
    type: 'ReactNode',
    note: "The tooltip content (Mantine Tooltip's own required prop, riding the passthrough).",
  },
  {
    name: '...rest',
    type: 'TooltipProps',
    note: 'Passthrough to the Tooltip (position, withArrow, openDelay, ...). Kit default events: hover and keyboard focus open it; touch does not.',
  },
];

function IconTooltipDemo() {
  return (
    <Group gap="lg">
      <Group gap={6}>
        <Text size="sm" fw={500}>
          Service interval
        </Text>
        <IconTooltip label="How often this item needs a maintenance check." />
      </Group>
      <Group gap={6}>
        <Text size="sm" fw={500}>
          Late fees
        </Text>
        <IconTooltip
          name="info"
          label="Charged per day once a return passes its due date."
        />
      </Group>
    </Group>
  );
}

export function IconTooltipPage() {
  return (
    <ComponentDoc
      title="IconTooltip"
      lead="A small inline icon (a ? by default) that reveals its label in a tooltip on hover or keyboard focus -- the hint affordance next to a field label, a table header, or any compact UI needing an optional explanation without permanently taking up space."
      demoIntro="Hover either icon (or Tab to it) for the hint; the second one swaps the default question mark for the registry's info icon."
      demo={<IconTooltipDemo />}
      usage={USAGE}
      usageMinHeight={190}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The trigger is a focusable span (tabIndex 0, aria-label &quot;more
          info&quot;), so keyboard users reach the hint without a pointer --
          Tooltip&apos;s events are configured for hover and focus, with touch
          off. The icon comes from the kit&apos;s closed registry, so name is a
          typed IconName, not an arbitrary component.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
