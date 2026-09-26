import { Box, Button, Code, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Icons } from '@mattstack/app-kit/icons';
import { HybridMenu } from './HybridMenu';

const meta = {
  title: 'Core/HybridMenu',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Box p="xl" maw={480}>
      <Text size="sm" mb="md">
        Part <Code>Select</Code>, part action menu -- pass a list of{' '}
        <Code>options</Code> (one selected at a time) and a list of{' '}
        <Code>actions</Code> (plain buttons below a divider).
      </Text>
      <HybridMenu
        target={<Button>Location</Button>}
        options={[
          { label: 'Storage room', value: 'storage', color: 'blue' },
          { label: 'Media lab', value: 'media-lab', color: 'grape' },
          { label: 'Front desk', value: 'front-desk' },
        ]}
        defaultValue="front-desk"
        actions={[
          {
            label: 'Refresh',
            onClick: () => {},
            leftSection: <Icons.refresh size={14} />,
          },
          {
            label: 'Remove location',
            onClick: () => {},
            color: 'red',
            leftSection: <Icons.trash size={14} />,
          },
        ]}
      />
    </Box>
  ),
};

export const WithRenderPropTarget: Story = {
  render: () => (
    <Box p="xl">
      <HybridMenu
        target={({ selectedOption }) => (
          <Button variant="light">
            {selectedOption ? selectedOption.label : 'Choose one'}
          </Button>
        )}
        options={[
          { label: 'Alpha', value: 'a' },
          { label: 'Bravo', value: 'b' },
        ]}
        defaultValue="a"
      />
    </Box>
  ),
};

export const DisabledOptionsAndActions: Story = {
  render: () => (
    <Box p="xl">
      <HybridMenu
        target={<Button>Locked menu</Button>}
        options={[
          { label: 'Editable', value: 'editable' },
          {
            label: 'Read-only',
            value: 'locked',
            disabled: true,
            disableTooltip: 'You lack permission to change this.',
          },
        ]}
        defaultValue="editable"
        actions={[
          {
            label: 'Archive',
            onClick: () => {},
            disabled: true,
            disableTooltip: 'Archiving is disabled during a migration.',
          },
        ]}
      />
    </Box>
  ),
};
