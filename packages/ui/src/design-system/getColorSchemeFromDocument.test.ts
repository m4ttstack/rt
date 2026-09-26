import { afterEach, describe, expect, it } from 'vitest';

import { getColorSchemeFromDocument } from './getColorSchemeFromDocument';

describe('getColorSchemeFromDocument', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-mantine-color-scheme');
  });

  it('returns "dark" when the DOM attribute is dark', () => {
    document.documentElement.setAttribute('data-mantine-color-scheme', 'dark');
    expect(getColorSchemeFromDocument()).toBe('dark');
  });

  it('returns "light" when the DOM attribute is light', () => {
    document.documentElement.setAttribute('data-mantine-color-scheme', 'light');
    expect(getColorSchemeFromDocument()).toBe('light');
  });

  it('defaults to "light" when the attribute is absent', () => {
    document.documentElement.removeAttribute('data-mantine-color-scheme');
    expect(getColorSchemeFromDocument()).toBe('light');
  });
});
