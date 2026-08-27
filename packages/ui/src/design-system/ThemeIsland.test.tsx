import { createTheme, MantineProvider, Text } from '@mantine/core';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  baseTheme,
  ThemeIsland,
  ThemeOverrideWrapper,
} from '@mattstack/app-kit/design-system';

afterEach(() => {
  // Mantine's default colorSchemeManager is localStorage-backed, and the
  // scheme attribute lives on a document root shared across tests.
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-mantine-color-scheme');
});

/** Every `<style data-mantine-styles>` block the render produced. */
const emittedStyles = (container: HTMLElement) =>
  Array.from(document.querySelectorAll('style[data-mantine-styles]'))
    .map(node => node.innerHTML)
    .concat(
      Array.from(container.querySelectorAll('style[data-mantine-styles]')).map(
        node => node.innerHTML
      )
    );

const renderInApp = (subtree: React.ReactNode) =>
  render(
    <MantineProvider theme={createTheme({ primaryColor: 'grape' })}>
      {subtree}
    </MantineProvider>
  );

describe('scoped subtree theming', () => {
  it('emits its variables scoped to its own class, never at :root', () => {
    // A nested MantineProvider defaults cssVariablesSelector to ':root', so
    // an unscoped one repaints the whole document instead of the subtree.
    const { container } = renderInApp(
      <ThemeIsland theme={baseTheme}>
        <Text>island</Text>
      </ThemeIsland>
    );

    const scope = container.querySelector('[class*="ui-theme-scope-"]');
    expect(scope).toBeTruthy();

    const scopeClass = Array.from(scope!.classList).find(name =>
      name.startsWith('ui-theme-scope-')
    )!;

    const scoped = emittedStyles(container).filter(css =>
      css.includes(scopeClass)
    );
    expect(scoped.length).toBeGreaterThan(0);
    scoped.forEach(css => {
      expect(css).not.toMatch(/(^|[\s,}])(:root|:host)\s*[[{]/);
    });
  });

  it('carries the color-scheme attribute on the scope element itself', () => {
    // Mantine composes scheme blocks as
    // `${selector}[data-mantine-color-scheme="..."]`, so the attribute has to
    // be on the same element as the scope class or the light/dark half of the
    // emitted variables matches nothing and dark mode does nothing here.
    const { container } = renderInApp(
      <ThemeIsland theme={baseTheme}>
        <Text>island</Text>
      </ThemeIsland>
    );

    const scope = container.querySelector('[class*="ui-theme-scope-"]')!;
    expect(scope.getAttribute('data-mantine-color-scheme')).toBe('light');
  });

  it('does not flip the document scheme out from under a dark app', () => {
    // MantineProvider seeds useProviderColorScheme from its OWN
    // defaultColorScheme ('light') and writes the result to
    // document.documentElement, so mounting an unforced nested provider
    // inside a dark app repaints the entire page light. forceColorScheme
    // pins the subtree to what the parent already resolved.
    const app = (subtree: React.ReactNode) => (
      <MantineProvider defaultColorScheme="dark" theme={baseTheme}>
        {subtree}
      </MantineProvider>
    );

    const { rerender } = render(app(<Text>app only</Text>));
    expect(
      document.documentElement.getAttribute('data-mantine-color-scheme')
    ).toBe('dark');

    rerender(
      app(
        <ThemeIsland theme={baseTheme}>
          <Text>island</Text>
        </ThemeIsland>
      )
    );

    expect(
      document.documentElement.getAttribute('data-mantine-color-scheme')
    ).toBe('dark');
  });

  it('adds the base-surfaces class only when asked', () => {
    const withRamp = renderInApp(
      <ThemeIsland theme={baseTheme} baseSurfaces>
        <Text>island</Text>
      </ThemeIsland>
    );
    expect(withRamp.container.querySelector('.ui-base-surfaces')).toBeTruthy();

    const withoutRamp = renderInApp(
      <ThemeIsland theme={baseTheme}>
        <Text>island</Text>
      </ThemeIsland>
    );
    expect(withoutRamp.container.querySelector('.ui-base-surfaces')).toBeNull();
  });
});

describe('ThemeOverrideWrapper', () => {
  it('stays out of layout, so wrapping a tree adds no box', () => {
    const { container } = renderInApp(
      <ThemeOverrideWrapper theme={{ primaryColor: 'teal' }}>
        <Text>wrapped</Text>
      </ThemeOverrideWrapper>
    );

    const scope = container.querySelector(
      '[class*="ui-theme-scope-"]'
    ) as HTMLElement;
    expect(scope.style.display).toBe('contents');
  });

  it('keeps the parent theme for keys the override does not mention', () => {
    // The merge-onto-parent semantic: this is what makes the wrapper able to
    // add a treatment but never remove one.
    const { container } = renderInApp(
      <ThemeOverrideWrapper theme={{ defaultRadius: 'xl' }}>
        <Text>wrapped</Text>
      </ThemeOverrideWrapper>
    );

    const scopeClass = Array.from(
      container.querySelector('[class*="ui-theme-scope-"]')!.classList
    ).find(name => name.startsWith('ui-theme-scope-'))!;

    const scoped = emittedStyles(container)
      .filter(css => css.includes(scopeClass))
      .join('\n');

    // grape came from the app provider, not from the override.
    expect(scoped).toContain('--mantine-primary-color-filled');
    expect(scoped).toMatch(/grape/);
  });
});
