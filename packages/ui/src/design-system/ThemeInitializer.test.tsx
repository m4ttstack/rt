import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeInitializer } from './ThemeInitializer';

function renderWithProvider() {
  return render(
    <MantineProvider>
      <ThemeInitializer />
    </MantineProvider>
  );
}

describe('ThemeInitializer', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('applies ?theme=dark to the stored preference and strips the param', () => {
    window.history.replaceState({}, '', '/?theme=dark');

    renderWithProvider();

    expect(window.localStorage.getItem('ui-color-scheme')).toBe(
      JSON.stringify('dark')
    );
    expect(new URL(window.location.href).searchParams.get('theme')).toBeNull();
  });

  it('applies ?theme=light to the stored preference and strips the param', () => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('dark'));
    window.history.replaceState({}, '', '/?theme=light');

    renderWithProvider();

    expect(window.localStorage.getItem('ui-color-scheme')).toBe(
      JSON.stringify('light')
    );
    expect(new URL(window.location.href).searchParams.get('theme')).toBeNull();
  });

  it('does nothing when there is no theme param', () => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('light'));
    window.history.replaceState({}, '', '/?foo=bar');

    renderWithProvider();

    // No `theme` param -- the stored preference is left exactly as it was.
    expect(window.localStorage.getItem('ui-color-scheme')).toBe(
      JSON.stringify('light')
    );
    expect(new URL(window.location.href).searchParams.get('foo')).toBe('bar');
    expect(new URL(window.location.href).searchParams.has('theme')).toBe(false);
  });

  it('renders nothing', () => {
    // MantineProvider injects its own <style> tags into the container --
    // ThemeInitializer's own contribution is asserted by everything else
    // that isn't one of those.
    window.history.replaceState({}, '', '/');
    const { container } = renderWithProvider();
    expect(container.querySelectorAll(':not(style)')).toHaveLength(0);
  });
});
