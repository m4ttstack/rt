import { createTheme, DEFAULT_THEME } from '@mantine/core';
import type { MantineThemeComponent } from '@mantine/core';

import { BG_LEVEL_COLORS } from './colors';
import classes from './component-styles.module.css';
import { variantColorResolver } from './variant-resolver';

/** Flat by default -- opt into `shadow`/`withBorder` per-usage instead of fighting a default. */
export const flatSurfaceProps = { shadow: 'none', withBorder: false } as const;

// A type-level import, so no import statement reaches the bundle or trips the
// `@mantine/core` shadow wall on `Table`/`TextInput`/`CopyButton`.
type MantineExports = typeof import('@mantine/core');

/** Every `@mantine/core` export carrying a `.extend` static, i.e. everything themeable. */
type ExtendableName = {
  [Name in keyof MantineExports]: MantineExports[Name] extends {
    extend: (input: never) => MantineThemeComponent;
  }
    ? Name
    : never;
}[keyof MantineExports];

/** Whatever `Name.extend()` itself accepts: defaultProps, styles, classNames, vars. */
type ExtendInput<Name extends ExtendableName> = MantineExports[Name] extends {
  extend: (input: infer Input) => MantineThemeComponent;
}
  ? Input
  : never;

// `Tooltip.extend(...)` is Mantine's `identity` (core/factory/factory.tsx), so
// its only contribution is typing -- but referencing the component to reach
// `.extend` imports the component OBJECT into the theme module, and since the
// theme is in every bundle that pins every extended component (plus its
// dependency trees: floating-ui, remove-scroll, ...) into apps that never
// render it.
//
// Keying off the component NAME reaches the same per-component types with no
// value import. `createTheme`'s own `components` is `Record<string,
// MantineThemeComponent>` (every field `any`), so routing the literal through
// this parameter is what buys the checking back. Exported because an app's
// own `app-theme.ts` wants the identical checking for its brand entries.
export const themeComponents = (entries: {
  [Name in ExtendableName]?: ExtendInput<Name>;
}) => entries as Record<string, MantineThemeComponent>;

/**
 * The kit's default theme. **Kit-owned: never edit this file in a consuming
 * app.** Brand treatments go in `app-theme.ts`, which `theme.ts` merges on
 * top of this -- so this file replaces cleanly on every sync, and the kit's
 * unbranded look stays reachable no matter how heavy the brand gets.
 *
 * That reachability is the point. `<MantineProvider theme={baseTheme}>` (or
 * `ThemeIsland`) renders a subtree in the kit's own look, which is what a dev
 * route, an embedded admin view, or a print layout usually wants. Merging a
 * "plain" override onto a brand cannot do this: `mergeThemeOverrides` only
 * adds, so every brand treatment would have to be individually restated to be
 * removed.
 *
 * Everything here is a considered default rather than scaffold filler. The
 * ergonomics in `components` especially (`Group` nowrap, `Select`
 * allowDeselect, the Tooltip pop family) are what the kit means by "flat and
 * quiet by default"; an app that wants a different palette should say so in
 * `app-theme.ts` rather than replace this wholesale.
 */
export const baseTheme = /* @__PURE__ */ createTheme({
  primaryColor: 'indigo',
  // Object form deliberately, even though both shades are the same and
  // Mantine accepts the scalar `7`. Mantine's `deepMerge` recurses whenever
  // the SOURCE value is an object without checking the target, so a scalar
  // here merged with an app's `{ light, dark }` yields `{}` -- which
  // `validateMantineTheme` then reads as the object form and dereferences,
  // blanking the page with a `Cannot read properties of undefined` from
  // `isValidPrimaryShade`. Matching the wider shape makes this theme safe to
  // nest under or over any app theme regardless of which form it picked.
  //
  // Value: mantine's default (6) reads a little pale against the level-2/3
  // surfaces; 7 holds contrast in both schemes.
  primaryShade: { light: 7, dark: 7 },
  defaultRadius: 'md',
  // The background ramp as named colors: `bg="bg-level-2"` etc. resolve to
  // the scheme-aware --ui-bg-N vars anywhere a color prop is accepted.
  colors: { ...BG_LEVEL_COLORS },
  headings: {
    fontWeight: '500',
  },
  breakpoints: {
    ...DEFAULT_THEME.breakpoints,
    // One step past Mantine's `xl`, for layouts that want to keep growing on
    // very wide displays.
    xxl: '1920px',
  },
  variantColorResolver,
  components: themeComponents({
    Paper: { defaultProps: flatSurfaceProps },
    Card: { defaultProps: flatSurfaceProps },
    Button: { defaultProps: { fw: 500 } },
    Code: { defaultProps: { fz: 'sm' } },
    Modal: { defaultProps: { centered: true, padding: 'lg' } },
    // Tight, single-line-by-default groups: the common case is a row of
    // controls that should stay on one line, not a wrapping flex container.
    Group: { defaultProps: { wrap: 'nowrap', gap: 'xs' } },
    // Re-clicking the selected option shouldn't silently empty the field.
    Select: { defaultProps: { allowDeselect: false } },
    Badge: {
      defaultProps: { variant: 'light', fw: 500 },
      // Badges read as labels, not shouting -- Mantine uppercases by default.
      styles: { root: { textTransform: 'none' } },
    },
    ScrollArea: { defaultProps: { type: 'auto' } },
    // The whole switch is a click target; the cursor should say so.
    Switch: {
      styles: {
        label: { cursor: 'pointer' },
        track: { cursor: 'pointer' },
      },
    },
    // Nav labels sit a step below body text (token, not a hardcoded px size).
    NavLink: { defaultProps: { fz: 'sm' } },
    Notification: { classNames: { root: classes.notificationRoot } },
    // Two extra input variants beyond Mantine's own (see the CSS module):
    // `variant="underline"` and `variant="borderless"`.
    TextInput: { classNames: { input: classes.input } },
    // pop-top-* is the built-in pop family's downward direction (the name
    // suffix is the origin corner): with position 'bottom' + offset 10 the
    // tooltip pops DOWN out of the hovered element. The multiline/maw pair
    // keeps long labels wrapping inside a readable column, and the padding
    // pair gives them room to breathe.
    Tooltip: {
      defaultProps: {
        withArrow: true,
        openDelay: 500,
        position: 'bottom',
        offset: 10,
        multiline: true,
        w: 'auto',
        maw: 400,
        p: 'sm',
        px: 'md',
        transitionProps: { transition: 'pop-top-left', duration: 400 },
      },
    },
    // Menus share the tooltip's pop-in; dropdown surfaces carry a shadow so
    // floating layers separate from the page the same way everywhere.
    Menu: {
      defaultProps: {
        transitionProps: { transition: 'pop-top-left' },
        shadow: 'md',
      },
    },
    MenuDropdown: { defaultProps: { p: 'xs', miw: 200 } },
    MenuItem: { defaultProps: { p: 'sm' } },
    MenuDivider: { defaultProps: { my: 'xs' } },
    Popover: { defaultProps: { shadow: 'md' } },
    HoverCard: { defaultProps: { shadow: 'md' } },
    Anchor: { defaultProps: { underline: 'hover', c: 'blue' } },
  }),
});
