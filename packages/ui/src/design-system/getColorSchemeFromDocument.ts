export type ColorScheme = 'light' | 'dark';

/**
 * Reads the currently-resolved color scheme straight off the DOM, for
 * non-React / module-scope code that needs it without a hook (Mantine's own
 * `MantineProvider` keeps `data-mantine-color-scheme` on `<html>` in sync
 * with the resolved scheme). Defaults to `'light'` when the attribute is
 * absent or holds anything other than `'dark'`.
 */
export function getColorSchemeFromDocument(): ColorScheme {
  const colorScheme = document.documentElement.getAttribute(
    'data-mantine-color-scheme'
  );
  return colorScheme === 'dark' ? 'dark' : 'light';
}
