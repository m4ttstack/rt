import '@mattstack/app-kit/styles.css';
import '@mattstack/tui-kit/theme.css';

import { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import type { Preview } from '@storybook/react-vite';

import { theme } from '@mattstack/app-kit/design-system';
import { TuiKitProvider } from '@mattstack/tui-kit/provider';

// tui-kit's tokens are light-dark() declarations flipped by `.dark` on the
// root; Mantine reads forceColorScheme. One toolbar drives both.
function SchemeSync({ scheme }: { scheme: 'light' | 'dark' }) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark');
  }, [scheme]);
  return null;
}

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
    (Story, context) => {
      const scheme = context.globals.scheme === 'dark' ? 'dark' : 'light';
      return (
        <MantineProvider theme={theme} forceColorScheme={scheme}>
          <TuiKitProvider>
            <SchemeSync scheme={scheme} />
            <ModalsProvider>
              <Story />
              <Notifications />
            </ModalsProvider>
          </TuiKitProvider>
        </MantineProvider>
      );
    },
  ],
};

export default preview;
