import { Button, Container, Group, Stack, Title } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { notifications } from './notifications';

const meta = {
  title: 'UI/Notifications',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function NotificationsShowcase() {
  return (
    <Container py="lg">
      <Title order={2} mb="sm">
        Notifications facade
      </Title>
      <Stack gap="sm" align="flex-start">
        <Group>
          <Button
            color="green"
            onClick={() => notifications.success('Saved successfully')}
          >
            Success
          </Button>
          <Button
            color="red"
            onClick={() => notifications.error('Something went wrong')}
          >
            Error
          </Button>
          <Button
            color="orange"
            onClick={() =>
              notifications.warning('Check this before continuing')
            }
          >
            Warning
          </Button>
          <Button
            color="blue"
            onClick={() => notifications.info('For your information')}
          >
            Info
          </Button>
        </Group>

        <Button
          variant="light"
          onClick={() =>
            notifications.success({
              title: 'Closing in 5 seconds',
              message: 'This notification carries its own countdown icon.',
              countdown: 5000,
            })
          }
        >
          Countdown notification
        </Button>

        <Button variant="subtle" onClick={() => notifications.clean()}>
          Close all
        </Button>
      </Stack>
    </Container>
  );
}

export const Showcase: Story = {
  render: () => <NotificationsShowcase />,
};
