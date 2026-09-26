import { MantineProvider } from '@mantine/core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useColorScheme, useLightDark } from '@mattstack/app-kit/hooks';
import { setPrefersColorScheme } from '@mattstack/app-kit/test-utils';

describe('useColorScheme', () => {
  it('reads the stored scheme on first render, no flash of the default', () => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('dark'));

    const { result } = renderHook(() => useColorScheme(), {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    expect(result.current.colorScheme).toBe('dark');
  });

  it('does not disable global transitions on re-renders that change nothing', () => {
    // Mantine's setColorScheme injects a global `transition: none !important`
    // style tag for ~10ms on every call. When Mantine's state already
    // matches the persisted preference, re-rendering a consumer must NOT go
    // through the setter -- an unconditional pre-paint sync here is what
    // froze the app shell rail's width transition on every page rendering a
    // useColorScheme consumer (e.g. the site rail's scheme toggle).
    // clear(): Mantine's own manager persists 'mantine-color-scheme-value'
    // when earlier tests sync, which would seed this provider mismatched
    // with the 'auto' preference and force a legitimate one-off sync.
    window.localStorage.clear();
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('auto'));

    const { rerender } = renderHook(() => useColorScheme(), {
      wrapper: ({ children }) => (
        <MantineProvider defaultColorScheme="auto">{children}</MantineProvider>
      ),
    });
    rerender();
    rerender();

    expect(
      document.querySelectorAll('[data-mantine-disable-transition]')
    ).toHaveLength(0);
  });

  it('still syncs a real preference change into Mantine before paint', () => {
    window.localStorage.clear();
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('auto'));

    const { result } = renderHook(() => useColorScheme(), {
      wrapper: ({ children }) => (
        <MantineProvider defaultColorScheme="auto">{children}</MantineProvider>
      ),
    });

    act(() => {
      result.current.setColorScheme('dark');
    });

    expect(result.current.colorScheme).toBe('dark');
    expect(
      document.documentElement.getAttribute('data-mantine-color-scheme')
    ).toBe('dark');
  });
});

describe('useLightDark', () => {
  it('returns a picker that follows the resolved scheme, not the raw "auto" preference', () => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('auto'));
    setPrefersColorScheme('dark');

    const { result } = renderHook(() => useLightDark(), {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    // The hook hands back the `lightDark` FUNCTION, so one call site can
    // resolve several value pairs.
    expect(result.current('L', 'D')).toBe('D');
    expect(result.current(1, 2)).toBe(2);
  });
});

describe('useColorScheme resolved-scheme members', () => {
  it('reports isDarkMode/isLightMode from the RESOLVED scheme under "auto"', () => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('auto'));
    setPrefersColorScheme('dark');

    const { result } = renderHook(() => useColorScheme(), {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    expect(result.current.colorScheme).toBe('auto');
    expect(result.current.isDarkMode).toBe(true);
    expect(result.current.isLightMode).toBe(false);
  });

  it('toggleColorScheme accepts no argument, a scheme string, or an is-dark boolean', () => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('light'));

    const { result } = renderHook(() => useColorScheme(), {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    act(() => result.current.toggleColorScheme());
    expect(result.current.colorScheme).toBe('dark');

    act(() => result.current.toggleColorScheme('light'));
    expect(result.current.colorScheme).toBe('light');

    act(() => result.current.toggleColorScheme(true));
    expect(result.current.colorScheme).toBe('dark');
  });
});
