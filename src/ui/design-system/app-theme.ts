import { createTheme } from '@mantine/core';

// Re-exported so a brand can type its own component entries exactly the way
// `base-theme.ts` does -- `themeComponents({ Button: { defaultProps: ... } })`
// is checked against Mantine's real per-component `.extend` signature, where
// a bare `components` literal is `Record<string, any>`.
export { themeComponents } from './base-theme';

/**
 * The one theme file an app is EXPECTED to edit, and the only place a
 * re-theming app needs to touch to brand the kit.
 *
 * `theme.ts` merges this ON TOP of `base-theme.ts`, so anything left out here
 * keeps the kit's default. Two things follow, and both are the reason this
 * file exists:
 *
 * 1. Syncing the kit forward stops being a 3-way merge of a file holding both
 *    kit intent and app brand. `base-theme.ts` and `theme.ts` replace cleanly;
 *    this file is never touched by a sync.
 * 2. The kit's unbranded look survives branding. `baseTheme` is still in the
 *    tree, so a dev route or embedded view can render in it (see `ThemeIsland`)
 *    instead of hand-transcribing the kit's defaults back out of the repo.
 *
 * Brand colors also need their names declared in `app-colors.ts`, which is
 * what teaches Mantine's `color`/`c`/`bg` props to autocomplete them:
 *
 * ```ts
 * export const appTheme = createTheme({
 *   primaryColor: 'brandPlum',
 *   defaultRadius: 0,
 *   colors: { brandPlum: colorToMantineColorsTuple(plumShades) },
 *   components: themeComponents({
 *     Card: { defaultProps: { withBorder: true, shadow: 'none' } },
 *   }),
 * });
 * ```
 *
 * Leave it empty when the app is happy with the kit's defaults.
 */
export const appTheme = /* @__PURE__ */ createTheme({});
