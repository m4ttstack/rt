import '@mattstack/app-kit/styles.css';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { Preview } from '@storybook/react-vite';

import { theme } from '@mattstack/app-kit/design-system';

const preview: Preview = {
  globalTypes: {
    scheme: {
      description: 'Color scheme',
      toolbar: {
        title: 'Scheme',
        icon: 'mirror',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: 'light' },
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
    (Story, context) => (
      <MantineProvider
        theme={theme}
        forceColorScheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}
      >
        <ModalsProvider>
          <Story />
          <Notifications />
        </ModalsProvider>
      </MantineProvider>
    ),
  ],
};

export default preview;
