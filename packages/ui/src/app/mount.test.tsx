import { act, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import * as boot from '@mattstack/app-kit/boot';
import { mountMattstackApp } from './mount';

let container: HTMLElement;

afterEach(() => {
  container?.remove();
});

function fresh(): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  return container;
}

test('renders the node inside the Mantine tree', async () => {
  await act(async () => {
    mountMattstackApp(<span data-testid="probe">hi</span>, {
      container: fresh(),
    });
  });
  expect(screen.getByTestId('probe')).toBeInTheDocument();
  expect(
    document.documentElement.getAttribute('data-mantine-color-scheme')
  ).toBeTruthy();
});

test('brackets the render with the boot alerts', async () => {
  const register = vi.spyOn(boot, 'registerSimpleAlerts');
  const mounted = vi.spyOn(boot, 'markMounted');
  await act(async () => {
    mountMattstackApp(<span />, { container: fresh() });
  });
  expect(register).toHaveBeenCalledTimes(1);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(register.mock.invocationCallOrder[0]).toBeLessThan(
    mounted.mock.invocationCallOrder[0]!
  );
});

test('merges a theme override on top of Tokyo', async () => {
  await act(async () => {
    mountMattstackApp(<span data-testid="probe" />, {
      container: fresh(),
      theme: { primaryColor: 'purple' },
    });
  });
  // Mantine renders its variables <style> in-tree (inside the mount container),
  // not portalled to document.head, so search the whole document for it.
  const styles =
    document.querySelector('[data-mantine-styles]')?.textContent ?? '';
  expect(styles).toContain(
    '--mantine-primary-color-filled: var(--mantine-color-purple-filled)'
  );
});
