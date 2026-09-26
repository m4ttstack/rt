import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { DaemonBanner } from './DaemonBanner';

const now = 1_700_000_000_000;

test('renders nothing while reachable', () => {
  renderWithProviders(<DaemonBanner reachable />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('states the outage length, probe count, and socket path', () => {
  renderWithProviders(
    <DaemonBanner
      reachable={false}
      downSince={now - 90_000}
      probeCount={3}
      now={now}
      sockPath="/tmp/rt.sock"
    />
  );
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('down 1m');
  expect(status).toHaveTextContent('3 probes');
  expect(status).toHaveTextContent('/tmp/rt.sock');
});

test('the probe button calls onProbeNow', async () => {
  const onProbeNow = vi.fn();
  renderWithProviders(
    <DaemonBanner reachable={false} onProbeNow={onProbeNow} />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Probe now' }));
  expect(onProbeNow).toHaveBeenCalledTimes(1);
});
