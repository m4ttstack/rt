import type { ReactElement, ReactNode } from 'react';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { render } from '@testing-library/react';

import { MantineProvider } from '@ui/core';
import { theme } from '@ui/design-system';

// Shared test harness for anything that renders inside a MantineProvider +
// ModalsProvider tree (modals, notifications, and later tasks that also need
// this wrapper).
//
// `env="test"` is Mantine 9's documented mechanism for disabling transitions
// and portals in a test environment (see MantineProviderProps.env in
// @mantine/core). Without it, Modal's mount/unmount transition can leave a
// modal present-but-animating when an assertion runs right after a click,
// producing flaky "found 2 elements" / "not found yet" failures. The same
// applies to <Notifications /> -- without env="test" a notification's exit
// transition can leave it in the DOM (or absent) right when an assertion runs.
//
// <Notifications /> is mounted here (not just imported by tests) so
// `notifications.show`/`.success`/etc render into a real tree the same way
// they would in the app -- tests never construct their own instance.
function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto" env="test">
      <ModalsProvider>
        {children}
        <Notifications />
      </ModalsProvider>
    </MantineProvider>
  );
}

// Passed as RTL's `wrapper` (rather than baked into the rendered element)
// so the returned `rerender` keeps the provider tree -- a bare
// rerender(<X />) previously remounted WITHOUT MantineProvider, which
// crashes any component that consumes Mantine context.
export function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: Providers });
}

/**
 * Overrides jsdom's viewport width (and fires `resize`) so hooks measuring
 * `window.innerWidth` -- `useIsMobile` via Mantine's `useViewportSize` --
 * see a mobile-sized viewport. Call before mounting; restore the original
 * width in `afterEach` so the override never leaks across tests.
 */
export function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}
