import { useState } from 'react';

import { Button, HybridMenu, Text } from '@ui/core';
import { Icon } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { HybridMenu } from '@ui/core';",
  '',
  '<HybridMenu',
  '  options={[',
  "    { label: 'Sort by name', value: 'name' },",
  "    { label: 'Sort by status', value: 'status' },",
  "    { label: 'Sort by category', value: 'category', disabled: true,",
  "      disableTooltip: 'Categories are still syncing.' },",
  '  ]}',
  '  value={sort}',
  '  onChange={setSort}',
  '  actions={[',
  "    { label: 'Reset ordering', onClick: () => resetOrdering() },",
  "    { label: 'Save as default', onClick: () => saveDefault() },",
  '  ]}',
  '  target={({ menuOpened, selectedOption }) => (',
  '    <Button variant="default">',
  "      {selectedOption?.label ?? 'Sort'}",
  '    </Button>',
  '  )}',
  '/>;',
].join('\n');

// Rows transcribed from src/ui/core/hybrid-menu/HybridMenu.tsx
// (HybridMenuProps).
const PROPS_ROWS = [
  {
    name: 'options',
    type: 'HybridMenuOption[]',
    note: 'Required. The mutually-exclusive choices; the current one renders a checkmark.',
  },
  {
    name: 'value? / defaultValue? / onChange?',
    type: 'string / string / (value) => void',
    note: "Controlled/uncontrolled selected option (Mantine's useUncontrolled bridge): pass value + onChange to control it, defaultValue to seed the internal state.",
  },
  {
    name: 'actions?',
    type: 'HybridMenuAction[]',
    note: 'Plain action items below a divider; clicking one runs its onClick and closes the menu. Default [].',
  },
  {
    name: 'target',
    type: 'ReactNode | (targetProps) => ReactNode',
    note: "Required. The menu's trigger. The render-prop form receives { menuOpened, selectedOption } so the trigger can reflect the current choice.",
  },
  {
    name: 'disableAllValues? / disableAllValuesTooltip?',
    type: 'boolean / string',
    note: "Disables every option at once, with a tooltip explaining why. Default tooltip 'Changing the value is not allowed.'",
  },
  {
    name: 'disableAllActions? / disableAllActionsTooltip?',
    type: 'boolean / string',
    note: "Same, for the action block. Default tooltip 'These actions are not allowed.'",
  },
];

// Rows transcribed from HybridMenuOption.
const OPTION_ROWS = [
  {
    name: 'label / value',
    type: 'string',
    note: 'Required. Display text and the stable value reported by onChange.',
  },
  {
    name: 'icon?',
    type: 'ReactNode',
    note: "Rendered in the row's left section.",
  },
  {
    name: 'color?',
    type: 'MantineColor',
    note: "The Menu.Item's color.",
  },
  {
    name: 'disabled? / disableTooltip?',
    type: 'boolean / string',
    note: 'Disables just this option, with an optional explanatory tooltip on hover.',
  },
];

// Rows transcribed from HybridMenuAction.
const ACTION_ROWS = [
  {
    name: 'label',
    type: 'string',
    note: 'Required. The action text (also the React key -- keep labels unique).',
  },
  {
    name: 'onClick',
    type: '() => void',
    note: 'Required. Runs on click; the menu closes afterwards.',
  },
  {
    name: 'disableTooltip?',
    type: 'string',
    note: 'Tooltip shown when the action is disabled.',
  },
  {
    name: 'testId?',
    type: 'string',
    note: 'Lands on the item as data-testid.',
  },
  {
    name: '...rest',
    type: 'MenuItemProps',
    note: 'Passthrough to the underlying Menu.Item (color, leftSection, disabled, ...).',
  },
];

function HybridMenuDemo() {
  const [sort, setSort] = useState('name');

  return (
    <HybridMenu
      options={[
        { label: 'Sort by name', value: 'name' },
        { label: 'Sort by status', value: 'status' },
        {
          label: 'Sort by category',
          value: 'category',
          disabled: true,
          disableTooltip: 'Categories are still syncing.',
        },
      ]}
      value={sort}
      onChange={value => {
        setSort(value);
        notifications.info(`Sort changed to '${value}'`);
      }}
      actions={[
        {
          label: 'Reset ordering',
          onClick: () => notifications.info('Ordering reset'),
        },
        {
          label: 'Save as default',
          onClick: () => notifications.success('Saved as your default sort'),
        },
      ]}
      target={({ menuOpened, selectedOption }) => (
        <Button
          variant="default"
          rightSection={
            <Icon name={menuOpened ? 'chevronUp' : 'chevronDown'} />
          }
        >
          {selectedOption?.label ?? 'Sort'}
        </Button>
      )}
    />
  );
}

export function HybridMenuPage() {
  return (
    <ComponentDoc
      title="HybridMenu"
      lead="A menu that's part Select (a list of mutually-exclusive options, one of them checked) and part action menu (a divider, then plain actions below it) -- hence 'hybrid'. The one dropdown pattern for 'pick a mode, or act on the current one'."
      demoIntro="Open the menu: picking an option moves the checkmark (and updates the trigger via the render prop), the disabled option explains itself on hover, and the actions below the divider fire and close the menu."
      demo={<HybridMenuDemo />}
      usage={USAGE}
      usageMinHeight={560}
      propsTables={[
        { title: 'Props', rows: PROPS_ROWS },
        { title: 'HybridMenuOption', rows: OPTION_ROWS },
        {
          title: 'HybridMenuAction',
          intro: 'Extends MenuItemProps, so any Menu.Item prop rides along.',
          rows: ACTION_ROWS,
        },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Picking an option keeps the menu open (so a wrong click is a one-click
          fix); running an action closes it. Selection follows Mantine&apos;s
          useUncontrolled bridge -- fully controlled with value + onChange, or
          self-managed from defaultValue. The whole option or action block can
          be disabled at once (disableAllValues / disableAllActions), each with
          a tooltip explaining the lockout.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
