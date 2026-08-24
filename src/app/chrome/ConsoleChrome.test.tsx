import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';

// The rail carries the Wiring drift badge, which reads the skills routes.
// Answering them with an empty roster keeps this file about the chrome --
// `WiringRailEntry.test.tsx` is where the badge itself is exercised.
vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        packs: {
          $get: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ packs: [] }),
          }),
        },
        composition: {
          $get: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ verbs: [], fills: [], binders: [] }),
          }),
        },
        check: {
          $get: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ verbs: [] }),
          }),
        },
      },
    },
  },
}));

const { ConsoleChrome } = await import('./ConsoleChrome');

function renderChrome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ConsoleChrome section="runs">
        <p>content</p>
      </ConsoleChrome>
    </QueryClientProvider>
  );
}

describe('ConsoleChrome', () => {
  it('renders both rail entries and its children', () => {
    renderChrome();

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Runs/i).length).toBeGreaterThan(0);
  });

  // The control must be able to return to "auto" -- setColorScheme(isDark ?
  // 'light' : 'dark') never could, since it only ever wrote an explicit
  // value. A System option that survives a Light/Dark round trip is the
  // regression this guards.
  it('offers System/Light/Dark and can return to System after picking Dark', async () => {
    const user = userEvent.setup();
    renderChrome();

    await user.click(screen.getByLabelText('Color scheme'));
    await user.click(await screen.findByText('Dark'));

    await user.click(screen.getByLabelText('Color scheme'));
    await user.click(await screen.findByText('System'));

    // Back to auto: the preference this app defaults to, and the one the
    // old two-value toggle could never return to once clicked.
    await user.click(screen.getByLabelText('Color scheme'));
    expect(await screen.findByText('System')).toBeInTheDocument();
    expect(await screen.findByText('Light')).toBeInTheDocument();
    expect(await screen.findByText('Dark')).toBeInTheDocument();
  });
});
