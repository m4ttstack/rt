import { useState } from 'react';
import { Alert, Button, Container, Stack, Text, Title } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { modals } from '@mattstack/app-kit/modals';

const meta = {
  title: 'UI/Modals',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function ModalsShowcase() {
  const [lastPromptValue, setLastPromptValue] = useState('');

  return (
    <Container py="lg">
      <Title order={2} mb="sm">
        Modals facade
      </Title>
      <Stack gap="sm" align="flex-start">
        <Alert>
          <Text size="sm">
            Last prompt value: {lastPromptValue || '[empty]'}
          </Text>
        </Alert>

        <Button
          onClick={() =>
            modals.open({
              title: 'Plain modal',
              children: <Text size="sm">Content opened via modals.open.</Text>,
            })
          }
        >
          Open modal
        </Button>

        <Button
          onClick={() =>
            modals.confirm({
              title: 'Save changes?',
              message: 'Your changes will be applied immediately.',
              onConfirm: () => {},
            })
          }
        >
          Confirm
        </Button>

        <Button
          color="red"
          onClick={() =>
            modals.confirm({
              title: 'Delete item?',
              message: 'This action cannot be undone.',
              destructive: true,
              onConfirm: () => {},
            })
          }
        >
          Destructive confirm
        </Button>

        <Button
          onClick={() =>
            modals.prompt({
              title: 'Rename item',
              message: 'Enter a new name below.',
              label: 'New name',
              placeholder: 'e.g. field_camera_a',
              required: true,
              initialValue: '',
              onSubmit: value => setLastPromptValue(value),
            })
          }
        >
          Prompt
        </Button>
      </Stack>
    </Container>
  );
}

export const Showcase: Story = {
  render: () => <ModalsShowcase />,
};
