import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  notifications,
  TimedRingProgress,
} from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';

afterEach(() => {
  notifications.clean();
});

// Mounts `children` one commit after the initial render (via its own effect)
// instead of as part of the very first commit alongside `renderWithProviders`'
// own MantineProvider tree. This matters for the StrictMode regression test
// below: React's dev-only "mount -> cleanup -> remount" effect double-invoke
// only reproduces reliably for a subtree that mounts *after* the surrounding
// providers have already settled their own mount-time effects (matching how
// TimedRingProgress is actually introduced in the app -- inside a
// notification shown later, not at the app's very first commit). Mounting it
// inline in the same commit as the providers masks the bug.
function DeferredMount({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(true), []);
  return show ? children : null;
}

test('notifications.success renders a notification with the given message', async () => {
  renderWithProviders(
    <button onClick={() => notifications.success('saved')}>go</button>
  );

  await userEvent.click(screen.getByText('go'));

  expect(await screen.findByText('saved')).toBeTruthy();
});

test('notifications.success accepts a props object (title + message)', async () => {
  renderWithProviders(
    <button
      onClick={() =>
        notifications.success({ title: 'Done', message: 'All good' })
      }
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  expect(await screen.findByText('Done')).toBeTruthy();
  expect(await screen.findByText('All good')).toBeTruthy();
});

test('notifications.success renders green color and the check icon', async () => {
  renderWithProviders(
    <button onClick={() => notifications.success('saved')}>go</button>
  );

  await userEvent.click(screen.getByText('go'));

  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('style')).toMatch(/green/);
  expect(alert.querySelector('.lucide-check')).not.toBeNull();
});

test('notifications.error renders red color, the close icon, and does not auto-close', async () => {
  renderWithProviders(
    <button onClick={() => notifications.error('failed')}>go</button>
  );

  await userEvent.click(screen.getByText('go'));

  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('style')).toMatch(/red/);
  expect(alert.querySelector('.lucide-x')).not.toBeNull();

  // error's default autoClose is `false` -- it should still be present well
  // past every other level's default autoClose window.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByRole('alert')).not.toBeNull();
});

test('notifications.warning accepts a props object (title + message)', async () => {
  renderWithProviders(
    <button
      onClick={() =>
        notifications.warning({ title: 'Heads up', message: 'Careful now' })
      }
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  expect(await screen.findByText('Heads up')).toBeTruthy();
  expect(await screen.findByText('Careful now')).toBeTruthy();
});

test('notifications.warning renders orange color and the triangle-alert icon', async () => {
  renderWithProviders(
    <button onClick={() => notifications.warning('careful')}>go</button>
  );

  await userEvent.click(screen.getByText('go'));

  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('style')).toMatch(/orange/);
  expect(alert.querySelector('.lucide-triangle-alert')).not.toBeNull();
});

test('notifications.info accepts a props object (title + message)', async () => {
  renderWithProviders(
    <button
      onClick={() =>
        notifications.info({ title: 'FYI', message: 'Just so you know' })
      }
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  expect(await screen.findByText('FYI')).toBeTruthy();
  expect(await screen.findByText('Just so you know')).toBeTruthy();
});

test('notifications.info renders blue color and the info icon', async () => {
  renderWithProviders(
    <button onClick={() => notifications.info('fyi')}>go</button>
  );

  await userEvent.click(screen.getByText('go'));

  const alert = await screen.findByRole('alert');
  expect(alert.getAttribute('style')).toMatch(/blue/);
  expect(alert.querySelector('.lucide-info')).not.toBeNull();
});

describe('TimedRingProgress', () => {
  test('fills over its duration and calls onFinish exactly once', async () => {
    const onFinish = vi.fn();
    renderWithProviders(
      <TimedRingProgress
        duration={400}
        onFinish={onFinish}
        icon={<span>x</span>}
      />
    );

    // The center icon renders inside the ring.
    expect(screen.getByText('x')).toBeTruthy();

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });

    // Confirm it doesn't keep firing once stopped.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('calls onFinish exactly once under StrictMode for a fast countdown', async () => {
    const onFinish = vi.fn();
    renderWithProviders(
      <DeferredMount>
        <StrictMode>
          <TimedRingProgress
            duration={40}
            onFinish={onFinish}
            icon={<span>x</span>}
          />
        </StrictMode>
      </DeferredMount>
    );

    await waitFor(() => expect(onFinish).toHaveBeenCalled(), { timeout: 3000 });

    // Give a StrictMode-induced duplicate (mount -> unmount -> remount of
    // the completion effect) a chance to fire before asserting the count.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('countdown wraps the notification icon in a timed ring', async () => {
    renderWithProviders(
      <button
        onClick={() =>
          notifications.show({
            type: 'success',
            message: 'saved',
            countdown: 400,
          })
        }
      >
        go
      </button>
    );

    await userEvent.click(screen.getByText('go'));
    const alert = await screen.findByRole('alert');
    // The RingProgress svg stands in for the plain icon.
    await waitFor(() =>
      expect(alert.querySelector('.mantine-RingProgress-root')).not.toBeNull()
    );
  });
});
