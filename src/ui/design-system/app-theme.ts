/**
 * The Tokyo brand theme lives in `@mattstack/mantine-tokyo` (console consumes
 * the same package), so branding here is a re-export. See `AGENTS.md`
 * section 4 for the three-file theme split this slots into
 * (`base-theme.ts` / `app-theme.ts` / `theme.ts`), and the package's own
 * `theme.ts` for the actual values.
 *
 * This is what makes `design/` conformance meaningful: the artboards were
 * generated from these exact resolved values, so a component that derives
 * from the theme matches the design by construction rather than by an
 * implementer copying numbers across.
 */
export { tokyoTheme as appTheme } from '@mattstack/mantine-tokyo';

// Re-exported so a brand can type its own component entries exactly the way
// `base-theme.ts` does -- `themeComponents({ Button: { defaultProps: ... } })`
// is checked against Mantine's real per-component `.extend` signature, where
// a bare `components` literal is `Record<string, any>`.
export { themeComponents } from './base-theme';
