import { mergeThemeOverrides } from '@mantine/core';

import { appTheme } from './app-theme';
import { baseTheme } from './base-theme';

/**
 * The app's theme: the kit's defaults with the app's brand merged on top.
 *
 * **Kit-owned: edit `app-theme.ts`, not this file.** The split is what keeps
 * `baseTheme` reachable after branding -- see `base-theme.ts` for why that
 * matters, and `ThemeIsland` for rendering a subtree in it.
 */
export const theme = /* @__PURE__ */ mergeThemeOverrides(baseTheme, appTheme);

export { flatSurfaceProps } from './base-theme';
