import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { MantineProvider } from '@ui/core';
import { theme } from '@ui/design-system';
import { ModalsProvider } from '@ui/modals';
import { Notifications } from '@ui/notifications';

import '@ui/styles/index.css';

import { App } from './app/App.tsx';
import { markMounted, registerSimpleAlerts } from './boot/SimpleAlerts';

// Registered BEFORE the render call below, so any error firing before (or
// during) that render -- including `render` itself throwing synchronously,
// which surfaces as an uncaught exception and thus a window 'error' event --
// is still caught and shown as a fatal-error panel. See
// `src/boot/SimpleAlerts.ts` for the full contract.
registerSimpleAlerts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ModalsProvider>
        <App />
        {/* notificationMaxHeight caps tall notifications so a long message
            scrolls inside the toast instead of growing without bound. */}
        <Notifications notificationMaxHeight={400} />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>
);

// Only reached if the render call above didn't throw -- from here on,
// SimpleAlerts' listeners no-op and the mounted app owns its own errors.
markMounted();
