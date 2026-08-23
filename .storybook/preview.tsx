import '@ui/styles/index.css';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { Preview } from '@storybook/react-vite';

import { theme } from '@ui/design-system';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },

  decorators: [
    Story => (
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <ModalsProvider>
          <Story />
          <Notifications />
        </ModalsProvider>
      </MantineProvider>
    ),
  ],
};

export default preview;
