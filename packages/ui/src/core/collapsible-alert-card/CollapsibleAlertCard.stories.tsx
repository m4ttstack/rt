import { Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icons } from '@mattstack/app-kit/icons';
import { CollapsibleAlertCard } from './CollapsibleAlertCard';

const meta = {
  component: CollapsibleAlertCard,
  title: 'Core/CollapsibleAlertCard',
} satisfies Meta<typeof CollapsibleAlertCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Heads up',
    subtitle: 'Click to expand for details',
    icon: <Icons.info size={22} />,
    color: 'blue',
    children: (
      <Text size="sm">
        Checkouts pause during Friday&apos;s inventory count. Items already on
        loan keep their due dates.
      </Text>
    ),
  },
};

export const OpenedByDefault: Story = {
  args: {
    ...Default.args,
    title: 'Already expanded',
    color: 'orange',
    icon: <Icons.warning size={22} />,
    defaultOpened: true,
  },
};

// The card pads its own expanded body, so plain unpadded children read as
// the card's content area under the tinted header.
export const LongBody: Story = {
  args: {
    title: 'Inventory count details',
    subtitle: 'Expanded to show the padded body',
    icon: <Icons.info size={22} />,
    color: 'blue',
    defaultOpened: true,
    children: (
      <Stack gap="sm">
        <Text size="sm">
          Checkouts pause during Friday&apos;s inventory count. Items already on
          loan keep their due dates, and returns drop into the after-hours bin
          as usual while the count is underway.
        </Text>
        <Text size="sm">
          The count usually wraps by early afternoon. Anything flagged as
          missing gets a second sweep on Monday before it is marked lost, so
          there is no need to report discrepancies before then.
        </Text>
      </Stack>
    ),
  },
};
