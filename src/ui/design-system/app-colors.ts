/**
 * The one file in `src/ui` an app is EXPECTED to edit, and the only place a
 * re-theming app needs to touch to teach Mantine's color props its own brand
 * colors.
 *
 * Mantine allows a repo to declare `MantineThemeColorsOverride` exactly once,
 * so before this existed the only way to add a brand color was to edit
 * `mantine.d.ts` or `colors.ts` directly -- which turned a vendored kit file
 * into a permanent local delta that had to be re-merged on every sync. Naming
 * the colors here keeps every other file byte-identical to the kit forever.
 *
 * Add the names registered in your theme's `colors`:
 *
 * ```ts
 * export type AppCustomColors = 'brandTeal' | 'brandPlum';
 * ```
 *
 * They then autocomplete on `color`, `c`, `bg`, and friends. Leave it as
 * `never` when the app adds no colors of its own.
 */
/**
 * tui-kit's intent vocabulary, minus the intents that collide with Mantine
 * built-ins. Naming them identically on both sides is what lets a component
 * written against `color="ok"` survive a move to tui-kit unedited.
 */
export type AppCustomColors = 'accent' | 'ok' | 'warn' | 'bad' | 'purple';
