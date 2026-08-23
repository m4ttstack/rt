import { useEffect, useRef } from 'react';

import { useColorScheme } from '@ui/hooks';

/**
 * Render-nothing component that applies a `?theme=dark|light` URL query
 * param to the persisted color-scheme preference on mount, then strips the
 * param via `history.replaceState` (no new history entry). Useful for
 * deep-linking a scheme -- docs, embeds, screenshots.
 *
 * Mount once near the app root, inside `MantineProvider` (it uses
 * `useColorScheme`, which requires one).
 */
export function ThemeInitializer() {
  const { toggleColorScheme } = useColorScheme();
  const initialized = useRef(false);

  useEffect(() => {
    // Only run once, even if this effect re-fires (e.g. StrictMode).
    if (initialized.current) return;

    const url = new URL(window.location.href);
    const themeParam = url.searchParams.get('theme');

    if (themeParam === 'dark' || themeParam === 'light') {
      toggleColorScheme(themeParam);

      // Strip the param for a cleaner URL, without adding a history entry.
      url.searchParams.delete('theme');
      window.history.replaceState({}, '', url.toString());
    }

    initialized.current = true;
  }, [toggleColorScheme]);

  return null;
}
