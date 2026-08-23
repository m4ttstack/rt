# AGENTS.md

Contract for anyone (human or agent) working in this repo. Read this before adding a component,
touching `src/ui/**`, or wiring up a form/modal/notification.

## 1. Why the import walls exist, and how to satisfy them

App code (`src/app/**`, `src/main.tsx`) is not allowed to import Mantine packages directly. Every
Mantine import goes through this kit's `@ui/*` barrels instead, so the kit's fixed defaults and
overrides (a shadowed `Table`, a themed `Modal`, a typed `notifications.show`, ...) are the only way
anything Mantine-shaped enters the app.

This is enforced by `eslint.config.js`'s `no-restricted-imports` rule, scoped to
`files: ['src/**/*.{ts,tsx}']` with `ignores: ['src/ui/**']` (i.e. it applies to everything under
`src/` except the kit itself). The rule maps each Mantine package to the barrel that replaces it:

```js
const mantineWall = (pkg, barrel) => ({
  name: pkg,
  message: `Import from '${barrel}' instead. The kit barrel adds fixed defaults and overrides.`,
});
```

| Import this (banned in app code) | Use this instead                                              |
| -------------------------------- | ------------------------------------------------------------- |
| `@mantine/core`                  | `@ui/core`                                                    |
| `@mantine/hooks`                 | `@ui/hooks`                                                   |
| `@mantine/form`                  | `@ui/forms`                                                   |
| `@mantine/modals`                | `@ui/modals`                                                  |
| `@mantine/notifications`         | `@ui/notifications`                                           |
| `@mantine/spotlight`             | `@ui/spotlight`                                               |
| `@mantine/code-highlight`        | `@ui/lazy`                                                    |
| `@mantine/dates`                 | `@ui/core` (dates re-exports live in the core barrel, see §2) |
| `lucide-react`                   | `@ui/icons` (`import { Icon } from '@ui/icons'`)              |

Two `patterns` entries extend the same wall to package families rather than single names:
`react-icons`/`react-icons/*` is banned outright ("react-icons is banned. Use @ui/icons."), and
`codemirror`/`@codemirror/*` is banned everywhere except inside `@ui/lazy`'s own CodeMirror lazy
loader, so it never lands in the entry bundle.

If ESLint reports `Import from '@ui/core' instead. The kit barrel adds fixed defaults and
overrides.` on a `@mantine/core` import, the fix is always the same: change the import specifier to
the matching `@ui/*` barrel. Never disable the rule at the call site in app code — the whole point
is that app code never needs to.

**Inside `src/ui/**` itself**, a second, stricter rule applies (this is where shadows are allowed to
reach past the wall to their own Mantine original):

```js
{
  files: ['src/ui/**/*.{ts,tsx}'],
  // The @ui/core barrel's own `export * from '@mantine/core'` is exempt...
  ignores: ['src/ui/core/index.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@mantine/core',
        importNames: ['Table', 'TextInput', 'CopyButton'],
        message: 'Use the shadowed versions from @ui/core.',
      }],
    }],
  },
}
```

Every file under `src/ui/**` (including other kit components) is banned from importing the _named_
`Table`/`TextInput`/`CopyButton` exports straight from `@mantine/core` — those three are shadowed
(`src/ui/core/table/Table.tsx`, `src/ui/core/text-input/TextInput.tsx`,
`src/ui/core/copy-button/CopyButton.tsx`) and any other kit code that needs one must go through
`@ui/core`'s own version, same as app code does. The shadow definition files themselves are the
sanctioned exception (the `CopyButton` shadow needs no exception at all — it builds on Mantine's
`Button`, not on the `CopyButton` it shadows), and each one that does reach past the wall documents
it inline:

```ts
// eslint-disable-next-line no-restricted-imports -- shadow definition site: this IS the
// `@ui/core` Table the eslint wall (eslint.config.js) points everything else at.
import { Table as MantineTable, Paper } from '@mantine/core';
```

`src/ui/core/index.ts` itself is `ignores`-listed from this second rule too, because its job is to
`export * from '@mantine/core'` (and `@mantine/dates`) wholesale before layering the two named
shadow exports on top — see §2 for why export order there matters.

**Heads up, the `TextInput` shadow changes autofill behavior**: the kit's `TextInput`
(`src/ui/core/text-input/TextInput.tsx`) defaults `autoComplete="off"`, on the theory that browser
autofill is noise on most app fields (identifiers, search boxes, internal names). That's a real
behavior change when porting existing forms: fields that used to autofill silently stop. Opt back
in per field where autofill is actually wanted: `autoComplete="on"`, or better, a specific token
(`autoComplete="email"`, `"current-password"`, ...) on real login/signup/profile fields.

## 2. Adding a component: kit vs. app

**Add it to the kit (`src/ui/core/<name>/`)** when the component is generic — no product-specific
copy, no product-specific business logic, nothing that only makes sense for one app. Every kit
component follows the same shape:

- `src/ui/core/<name>/<Name>.tsx` — the component.
- `src/ui/core/<name>/<Name>.stories.tsx` — a Storybook story (`Meta`/`StoryObj` from
  `@storybook/react-vite`).
- A named export added to `src/ui/core/index.ts`.

If the component's name collides with something `@mantine/core` (or `@mantine/dates`, also
star-exported there) already exports, the barrel's export order is load-bearing:

```ts
export * from '@mantine/core';
export * from '@mantine/dates';

// Shadows (Table, TextInput, CopyButton -- see the eslint wall in
// src/ui/**). Named exports placed AFTER the `export *` above, so they
// win over the star-exported Mantine originals...
export { Table } from './table/Table';
export type { TableProps } from './table/Table';
export { TextInput } from './text-input/TextInput';
export type { TextInputProps } from './text-input/TextInput';
```

Per the ES module spec, a named export always wins over a colliding name introduced by a `export *`
elsewhere in the same module, regardless of statement order — but the convention here is still to
place the named shadow export _after_ the star line, so the barrel reads top-to-bottom as "everything
from Mantine, then the kit's own overrides on top." (`@ui/modals` and `@ui/notifications` follow the
identical pattern for their own colliding `modals`/`notifications` names — see §5.) If your new
component's name does _not_ collide with anything in `@mantine/core`/`@mantine/dates`, it's a plain
named export anywhere in the barrel (no star-export ordering to worry about) — e.g. `PageShell`,
`SelectableList`, `HybridMenu`. A colliding name is fine when the shadow is _deliberate_: the kit
intentionally shadows Mantine's headless render-prop `CopyButton` with its own labeled,
batteries-included `CopyButton` (same convention as `Table`/`TextInput`), while `CopyActionIcon`
keeps the icon-only variant under a collision-free name. Only rename or namespace a component if a
bare name would shadow an existing Mantine export _unintentionally_.

**Adding a component family**: when several sibling components belong together (say a set of
pixel-art pieces, or chart primitives sharing one palette), they still live in **one** component
folder, `src/ui/core/<family>/`, with one `.tsx` + `.stories.tsx` per sibling. Shared data or
helpers backing the family (a lookup table, shared constants, shared types) go in a plain module
inside that same folder (`<family>-data.ts` or similar), imported relatively by the siblings. Export
the data module's contents through `src/ui/core/index.ts` only if consumers genuinely need them --
by default only the components (and their prop types) cross the barrel.

**Add it to the app (`src/app/**`)** when the component is product-specific: it renders
product-specific copy, wires up product-specific data, or otherwise only makes sense for this one
app rather than any app built on the kit. App components still only ever reach Mantine primitives
through `@ui/*` (the wall in §1 applies to `src/app/**` the same as everywhere else in `src/`).

**App chrome recipe**: the double-nav app chrome ships as kit components rather than
app-land copy-paste. `RailShell` (`src/ui/core/rail-shell/`, a `SiteShell` in `layout="alt"` whose
navbar is a mini icon rail) composes with `Rail`/`RailEntry` in its `rail` slot, wired by
`useRailState` (which owns the mobile expand-then-open rule); host a `PageShell` in `children`
(passing the chrome's header height as its `topOffset`) for the page-level sidebar. The z-index
contract is fixed inside `RailShell` and pairs with `PageShell`: desktop rail navbar 5, under the
`PageShell` root's 10 (so edge-riding page UI like the collapsed sidebar trigger paints in front of
the rail), header 100 (Mantine's default), mobile click-to-close overlay 999, mobile-open chrome
1000 (Mantine paints the navbar at zIndex + 1, i.e. 1001). The site's own
`src/app/chrome/AppChrome.tsx` is the live reference wiring, and the docs' "App chrome" guide page
(`src/app/docs/pages/AppChromePage.tsx`) documents the recipe end-to-end.

**Keep kit modules tree-shakeable.** Consumers vendor all of `src/ui` but may render a fraction of
it; a module is only droppable from their bundles if its top level is provably side-effect-free.
Three patterns silently pin a module (and its whole import tree) into every consumer build:

1. **Top-level mutations** — `Component.displayName = ...`, compound statics
   (`PageShell.Sidebar = Sidebar`). Instead: name the inner function (devtools pick it up without
   `displayName`), and attach compound statics via a single
   `/* @__PURE__ */ Object.assign(Root, { ... })` export (see `PageShell.tsx`, `Table.tsx`).
2. **Unannotated top-level factory calls** — `forwardRef(...)`, `createPolymorphicComponent(...)`,
   `Container.withProps(...)`, registry-builder calls. Annotate each with `/* @__PURE__ */`. If the
   call's arguments contain property reads (`MantineTable.Thead`), the annotation alone isn't
   enough — wrap call and reads together in a `/* @__PURE__ */ (() => ...)()` IIFE.
3. **Top-level property reads and spreads** — `const X = Menu.Item as ...`, object spreads of
   imported records. Wrap in a PURE IIFE (see `SearchableMenu.tsx`, `Icons.ts`).

`scripts/treeshake-check.sh` (CI: `bun run treeshake`) enforces this: it builds a minimal probe app
that imports only `Button` + the theme through the barrels and fails if any kit module outside the
documented floor survives in the bundle. If your new component trips it, one of the three patterns
above is the reason.

## 3. Icon registry workflow

All icons go through the registry in `src/ui/icons/Icons.ts` — nothing imports `lucide-react`
directly outside that file (the wall bans it: `import { Icon } from '@ui/icons'`).

**Adding a lucide icon**: import it from `lucide-react` at the top of `Icons.ts`, wrap it with
`lucideWrapperFn` (which adapts a `LucideIcon` to the kit's fixed prop surface — `size` defaulting to
16, plus `color`/`className` passthrough), and add it to whichever category object fits (or a new
one), which then gets spread into the exported `Icons` map:

```ts
import { Trash2 } from 'lucide-react';

import { lucideWrapperFn } from './lucideWrapperFn';

const ActionIcons = {
  trash: lucideWrapperFn(Trash2),
  // ...
};

export const Icons = {
  ...ActionIcons,
  // ...
  ...BrandIcons,
};
```

`src/ui/icons/Icons.test.ts` guards the registry against any entry that resolves to `undefined`
(e.g. a typo'd lucide import name that silently imports `undefined`):

```ts
test('registry has no undefined entries', () => {
  for (const [name, cmp] of Object.entries(Icons)) {
    expect(cmp, `Icon '${name}' is undefined`).toBeDefined();
  }
});
```

`IconName` (in `types.ts`) is `keyof typeof Icons` — derived from the registry itself, so adding an
entry automatically makes it a valid `<Icon name="...">` value with no separate list to update.

**Brand icons**: `src/ui/icons/brand-icons/index.ts` is an intentionally empty slot (`BrandIcons`)
for a product's own logo/brand SVGs, spread into `Icons` _last_ so a brand icon can shadow a generic
name if it ever needs to:

```ts
import type { IconComponent } from '../types';

export const BrandIcons = {} satisfies Record<string, IconComponent>;
```

Fill it in following the file's own example comment — wrap each brand SVG so it satisfies
`IconComponent` (`size`/`color`/`className`, size defaulting to 16), same contract as a
`lucideWrapperFn`-wrapped icon:

```ts
import type { IconProps } from '../types';
import { MyLogo } from './MyLogo';

export const BrandIcons = {
  myLogo: ({ size = 16, ...rest }: IconProps) => <MyLogo width={size} height={size} {...rest} />,
} satisfies Record<string, IconComponent>;
```

Using `satisfies` here (rather than a `: Record<string, IconComponent>` type annotation) is
deliberate: it keeps the inferred type as the literal object (empty, or your added keys) with no
index signature, so spreading `BrandIcons` into `Icons` doesn't widen `IconName` to a bare `string`
and lose the point of a closed icon-name union.

## 4. Theme override patterns

**The theme is three files, and an app edits exactly one of them:**

| File                          | Owner | What it holds                                                     |
| ----------------------------- | ----- | ----------------------------------------------------------------- |
| `design-system/base-theme.ts` | kit   | `baseTheme`, the kit's defaults. Never edited in a consuming app. |
| `design-system/app-theme.ts`  | app   | `appTheme`, the brand. The only theme file a consumer touches.    |
| `design-system/theme.ts`      | kit   | `theme = mergeThemeOverrides(baseTheme, appTheme)`.               |

Same shape, and the same reason, as `app-colors.ts` (§1): branding a file the kit also owns turns it
into a permanent local delta re-merged on every sync. It buys two things beyond clean syncs:

- **The kit's unbranded look stays reachable.** `baseTheme` is still an importable object after
  branding, so "make this subtree look like the kit" is `<ThemeIsland theme={baseTheme} baseSurfaces>`
  (one import, no transcription, no drift). Merging cannot express this: `mergeThemeOverrides` only
  ADDS, so removing a brand treatment means individually restating every one of them.
- **DEFAULT vs EXAMPLE becomes legible.** Everything in `base-theme.ts` is a considered default,
  the component ergonomics especially (`Group` nowrap, `Select` allowDeselect, the Tooltip pop
  family). An app wanting a different palette says so in `app-theme.ts` rather than overwriting the
  file and losing them.

**Write scalar-or-object theme options in their object form.** `primaryShade` is `{ light, dark }`
in `base-theme.ts` even though both shades are 7 and Mantine accepts the scalar. Mantine's
`deepMerge` recurses whenever the SOURCE value is an object without checking that the target is one
too, so `deepMerge(7, { light: 7, dark: 4 })` spreads `{...7}` to `{}` and returns `{}`,
which `validateMantineTheme` then reads as the object form and dereferences, blanking the page with
`Cannot read properties of undefined (reading 'toString')` from `isValidPrimaryShade`, naming
neither `primaryShade` nor the theme that supplied it. Matching the wider shape makes the kit theme
safe to nest under or over any app theme. `design-system/theme.test.tsx` pins it.

**Kit-wide defaults** live in `src/ui/design-system/base-theme.ts`, via `createTheme`'s `components`
map in Mantine's string-keyed form — deliberately NOT each component's `.extend({ defaultProps })`:

```ts
// theme.ts's module-local helper. `ExtendableName` is every @mantine/core
// export carrying an `.extend` static (218 of them), and `ExtendInput<Name>`
// is whatever that component's own `.extend()` accepts. Both are read off a
// type-level import, so the component name keys the typing and no component
// value is ever referenced.
type MantineExports = typeof import('@mantine/core');

const themeComponents = (entries: {
  [Name in ExtendableName]?: ExtendInput<Name>;
}) => entries as Record<string, MantineThemeComponent>;

export const baseTheme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 7, dark: 7 },
  defaultRadius: 'md',
  components: themeComponents({
    Paper: { defaultProps: flatSurfaceProps },
    Button: { defaultProps: { fw: 500 } },
    Badge: {
      defaultProps: { variant: 'light', fw: 500 },
      styles: { root: { textTransform: 'none' } },
    },
  }),
});
```

Both forms merge identically at runtime, because `Component.extend` IS Mantine's `identity`
(`core/factory/factory.tsx`) — its only contribution is typing. But referencing the component to
reach `.extend` imports the component OBJECT into the theme module, and since the theme ships in
every bundle that pins every extended component (plus its dependency trees: floating-ui,
react-remove-scroll, ...) into apps that never render them. `scripts/treeshake-check.sh` guards this.

Keying off the component name gets the same types without the value import, so it checks everything
`.extend` does — `defaultProps`, `styles`, `classNames`, `vars`, including styles-API slot names —
plus the component name itself. A typo'd `labell`, `shadoww`, or `Anchorr` all fail `tsc`, the last
with "Did you mean to write 'Anchor'?". `typeof import(...)` is a type-level import: nothing reaches
the bundle, and it does not trip the `no-restricted-imports` shadow wall the way `import type * as M`
does.

Add a new component-wide default by adding a key to that map. This is app-wide — every instance
picks it up. Do NOT reach for a `Components.X` enum or `as const` name map: both are runtime objects,
which is exactly what this avoids, and both need hand-maintaining where the union derives itself
from Mantine. `.extend` remains fine in APP code (an app's theme is its own bundle decision) — the
constraint is kit-side, on the shared theme module.

**Per-subtree theming: to ADD a treatment, wrap with an override; to SUBTRACT one, provide a
baseline.** Two components, and picking the wrong one is the single most common way this goes wrong,
because subtracting is what a dev route, embedded admin view, or print layout actually wants:

| Ask                                                           | Use                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| "this section needs rounder cards / a different primaryColor" | `ThemeOverrideWrapper` (merges onto the ancestor theme)    |
| "make this route look like the kit again"                     | `ThemeIsland theme={baseTheme} baseSurfaces` (replaces it) |
| "this preview must render exactly as production does"         | `ThemeIsland theme={appTheme} cssVariablesResolver={...}`  |

`ThemeOverrideWrapper` requires an ancestor `MantineProvider` (`useMantineTheme()` throws
otherwise), which is always true inside the app since `main.tsx` wraps the whole tree in one. It is
layout-transparent (`display: contents`), so wrapping an existing tree adds no box.

**Never nest a bare `MantineProvider` for a subtree.** Both components route through an internal
`ScopedThemeProvider` because a nested provider gets three things wrong, each silently:

1. `cssVariablesSelector` defaults to `:root`, so a nested provider emits its variables GLOBALLY and
   later in the head than the app's. The "subtree" override repaints the whole document. The fix is
   a per-instance scope class, which is why these components render an element at all.
2. Mantine composes scheme blocks as `${selector}[data-mantine-color-scheme="..."]`
   (`convert-css-variables.ts`), so `data-mantine-color-scheme` has to sit on that same element.
   Miss it and the light/dark half of the emitted variables matches nothing, which fails as "dark
   mode does nothing here" rather than as an error.
3. `MantineProvider` runs `useProviderColorScheme`, which writes the scheme attribute to
   `getRootElement()` (the DOCUMENT root by default), seeded from its own `defaultColorScheme` of
   `'light'`. Mounting one inside an app set to `'auto'` flips the entire page light on a
   dark-preference machine. `forceColorScheme` pins it to what the parent already resolved.

A nested provider also does NOT inherit the app's `cssVariablesResolver`; both components take one
and forward it. Without it, every resolver-injected token (contrast fixes, brand aliases) reverts to
Mantine's stock derivation inside the subtree. `design-system/ThemeIsland.test.tsx` pins all of this.

**Per-call-site presets**: there is one answer per component shape, and the kit ships no preset
helper of its own.

For **Mantine's own factory components** (`Button`, `Badge`, `Paper`, `Container`, ...), use the
typed static `.withProps({...})` every factory component carries: it's generated by the factory
itself, so the preset is type-checked against the real props and the returned component keeps the
factory's typing, including the polymorphic `component`/`renderRoot` surface (verified against the
installed Mantine's `polymorphic-factory.d.ts`). The kit's own `ContentContainer`
(`src/ui/core/content-container/ContentContainer.tsx`) is exactly this: `Container.withProps({...})`.

```tsx
const SquareBadge = Badge.withProps({ radius: 0 });
<SquareBadge component="a" href="/promo">
  Sale
</SquareBadge>; // polymorphism intact
```

For **kit shadows and your own plain/`forwardRef` components** (the kit's `TextInput` shadow, your
app components), which have no static `.withProps`, write a small wrapper component that spreads
caller props after the preset (caller props win), so the wrapper keeps the component's own concrete
prop type:

```tsx
function CompactSearchInput(props: TextInputProps) {
  return (
    <TextInput
      size="xs"
      placeholder="Search…"
      leftSection={<Icons.search size={14} />}
      {...props}
    />
  );
}
```

**The `--ui-bg-*` surface-slot contract**: the four background variables (`--ui-bg-1..4`, exposed as
`bg.level1..4` by `useSchemeColors`, see §6) are **four scheme-aware surface slots**. The kit's
_default_ mapping (in `src/ui/styles/scheme-vars.css`) is a monotonic "raised = lighter" elevation
ladder, but that ordering is a property of the default values, not of the contract -- remapping the
four slots to role-based surfaces (page/card/well/pill, not necessarily ordered by lightness) is a
supported re-theme. Two consequences:

- **Consumers** may re-point the four vars per scheme however their design needs, as long as each
  slot stays scheme-aware. The stylesheet is two layers for exactly this reason: kit-owned
  `--ui-base-*` values per scheme, and the live `--ui-*` slots an app remaps. Restore the kit's
  surfaces on a subtree with the `.ui-base-surfaces` class (what `ThemeIsland`'s `baseSurfaces` prop
  adds), which re-points every live slot back at the base layer, scheme-aware in both directions and
  with no values to hand-copy.
- **Never point a `--ui-base-*` value at a live `--ui-*` slot.** That is how the ramp gets a CSS
  CYCLE, and a cycle makes every custom property in it invalid at computed-value time: both sides
  silently fall back to their initial values rather than erroring. The concrete trap: the kit used
  to write `--ui-bg-1: var(--mantine-color-body)`, while an app remapping the ramp naturally writes
  the inverse `--mantine-color-body: var(--ui-bg-1)`. Level 1 now points at
  `--mantine-color-white` / `--mantine-color-dark-7` directly (exactly what Mantine's own resolver
  derives `body` from), so that inversion is safe. `styles/scheme-vars.test.ts` pins it.
- **Kit components must not bake in ordering assumptions** across slots. Picking a single slot for a
  single role (`Table`'s `bg.level4` header accent, `PageShell`'s level1 page + level2 header,
  `AnimatedBorderBox`'s level2 interior fill) is fine. A component that would want a _multi-slot_
  effect (sweeping several slots in one gradient) must not assume the slots form an ordered ramp --
  it would have to expose its own override point instead. `AnimatedBorderBox` shows the override-point
  pattern in single-slot form: its static fill defaults to `--ui-bg-2` but reads it through the
  component-scoped `--abb-fill` custom property (settable via `style`), so a role-remapped app
  re-points the fill without touching the kit stylesheet.

**Accent props on kit components**: a component with one accent takes `color: MantineColor`
(`Notch`, `CollapsibleAlertCard`); a component with several takes a single `colors` tuple sized to
its need (`GradientBorder`'s `[left, mid, right]` gradient stops, `AnimatedBorderBox`'s
`[primary, secondary]`). Scheme-tuning knobs stay separate props (`AnimatedBorderBox`'s `shade`) --
they adjust how the accents render, not which accents they are.

**`primaryShade` when re-theming**: the kit's `primaryShade: { light: 7, dark: 7 }` is tuned for the
default indigo on the default ramp (Mantine's default 6 reads pale against the level-2/3 surfaces).
Consumers re-tuning it should generally pick a _lighter_ shade for dark mode
(dark surfaces want a brighter accent to hold contrast) and consider enabling `autoContrast` so
filled variants keep readable label colors across shades.

**Known Mantine escape hatches (private defaults the theme scale doesn't reach)**: a few Mantine
components hardcode a pill radius in their own stylesheet instead of following
`theme.defaultRadius` -- their vars resolver only emits `--<comp>-radius` when the `radius` prop is
explicitly set, and the component CSS falls back to a hardcoded `1000px`-style pill value otherwise
(verified against Mantine 9: `Badge`, `Avatar`, `Switch`, `Chip`). When rebranding radius globally,
`defaultRadius` alone won't reach them; add an explicit default in the theme's `components` map,
e.g. `Badge: Badge.extend({ defaultProps: { radius: 'md' } })`.

**Adding brand colors when re-theming**: register the tuples in `app-theme.ts`'s `colors`, then declare
their NAMES in `src/ui/design-system/app-colors.ts`:

```ts
export type AppCustomColors = 'brandTeal' | 'brandPlum';
```

That union feeds `ExtendedCustomColors`, which feeds the single `MantineThemeColorsOverride`
augmentation in `src/ui/mantine.d.ts`, so the names autocomplete on `color`/`c`/`bg`. Mantine allows
that augmentation only once per repo, and `app-colors.ts` exists so an app never has to edit
`mantine.d.ts` or `colors.ts` to get it — those two stay byte-identical to the kit and keep
fast-forwarding on every sync. Note the props accept `(string & {})`, so a wrong name is never a
type error; what you gain is autocomplete, not exclusivity.

**Where raw hex lives**: the kit's convention is that raw hex/rgb values only appear in the color
definition layer -- `src/ui/design-system/colors.ts` color tuples and the scheme vars in
`src/ui/styles/scheme-vars.css` (which today reference Mantine's palette vars rather than literals).
`theme.ts` scalar color options (`black`, `white`, `colors` tuples, and friends) are explicitly part
of that hex home too: a re-theme that sets `black: '#1a1b1e'` in `createTheme` is following the
convention, not breaking it. Component code is not part of the hex home -- components consume theme
colors, `--mantine-color-*` vars, or the `--ui-bg-*` slots, never literals.

## 5. Facade usage recipes

**Shells own their own frames.** Three defaults are deliberate, invisible from the outside, and the
usual reason a page fights its layout:

| The shell already does                                                                                  | So don't                                                           | Tune it with                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `PageShell.Content` is the page's scroll frame (a `ScrollArea.Autosize` capped at the available height) | wrap children in your own `ScrollArea`, or clamp with `mah="__vh"` | `scrollAreaProps`, or take the frame over with the root's `scrollClamp` |
| `PageShell.Sidebar` scrolls its own children, sized to the shell frame                                  | reach for a `ScrollArea` around a long nav list                    | `scrollAreaProps`                                                       |
| `PageShell.Content` wraps children in `ContentContainer` (capped, centered column)                      | add your own `Container`                                           | `contentContainerProps`, or `contentContainer={false}` for full-bleed   |

The container default is on in scroll mode and off under `scrollClamp`, where the caller owns the
frame and a margined, capped column would fight their inner scroll. An explicit prop wins either way.

**`RailShell` + `PageShell` is the normal case, and they wire themselves.** App-level icon rail plus
a page-level sidebar: host the `PageShell` in `RailShell`'s `children` and pass nothing. The rail
publishes its `headerHeight` on context (`rail-shell/context.ts`) and a hosted `PageShell` defaults
its `topOffset` to it, so the fixed header's height lives in one place and cannot drift. An explicit
`topOffset` still wins, for chrome the kit did not render.

**Modals** (`@ui/modals`): `modals.open` is a typed pass-through to `@mantine/modals`' `openModal`;
`modals.confirm`/`modals.prompt` are the kit's own higher-level helpers.

```tsx
import { modals } from '@ui/modals';

modals.confirm({
  title: 'Remove gear item',
  message: `Remove "${name}"? This can't be undone.`,
  destructive: true,
  onConfirm: () => {
    setItems(current => current.filter(item => item.name !== name));
    notifications.success(`Removed ${name}`);
  },
});

modals.prompt({
  title: `Rename "${name}"`,
  label: 'New name',
  placeholder: 'letters, numbers, underscores',
  required: true,
  initialValue: name,
  validate: value =>
    identifierRegex.test(value)
      ? null
      : 'Only letters, numbers, and underscores are allowed',
  onSubmit: newName => notifications.info(`Renamed to ${newName}`),
});
```

`destructive: true` on `confirm` renders a warning icon next to the title and a red confirm button;
`hideCancelButton: true` removes the cancel button entirely rather than just disabling it.

`prompt`'s input carries its own field props — `label` (rendered above the input), `placeholder`,
and `required` (asterisk on the label; empty/whitespace submits rejected with "Value is required"
after `validate` runs). `message` is prose above the whole form, not the input's label.

**Notifications** (`@ui/notifications`): per-level shorthands (`success`/`error`/`warning`/`info`)
each pick a level-appropriate icon, color, and `autoClose` default — `error` does not auto-close, on
the theory that an error is the one level a user is expected to act on or consciously dismiss:

```tsx
import { notifications } from '@ui/notifications';

notifications.success('Gear item saved');
notifications.error('Something failed');
notifications.warning('Heads up, check this');
notifications.info('Just so you know');
```

Each shorthand also accepts a full props object instead of a bare string
(`notifications.success({ title: 'Saved', message: '...' })`), and `color`/`icon`/`autoClose` can
still be overridden per call.

`TimedRingProgress` (also from `@ui/notifications`) is a countdown ring that calls `onComplete`
exactly once when it reaches zero — typically used as a notification's own `icon`, so the
notification visibly counts down to when it auto-hides itself:

```tsx
const id = randomId();
notifications.success({
  id,
  title: 'Closing in 5 seconds',
  message: 'This notification carries its own countdown icon.',
  autoClose: false,
  icon: (
    <TimedRingProgress seconds={5} onComplete={() => notifications.hide(id)} />
  ),
});
```

**Forms** (`@ui/forms`): `FormContainer` wraps a `useForm` instance (validated with `zodResolver`) in
a `Paper` + submit-row layout with a built-in loading overlay and error summary:

```tsx
import { z } from 'zod';

import { TextInput } from '@ui/core';
import {
  FormContainer,
  identifierRegex,
  useForm,
  zodResolver,
} from '@ui/forms';

const gearItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Item name is required')
    .regex(
      identifierRegex,
      'Only letters, numbers, and underscores are allowed'
    ),
  description: z.string().optional(),
});

const form = useForm({
  initialValues: { name: '', description: '' },
  validate: zodResolver(gearItemSchema),
});

<FormContainer
  form={form}
  onSubmit={values => notifications.success('Gear item saved')}
>
  <TextInput
    label="Item name"
    placeholder="camera_kit"
    {...form.getInputProps('name')}
  />
  <TextInput
    label="Description"
    placeholder="Optional"
    {...form.getInputProps('description')}
  />
</FormContainer>;
```

`identifierRegex` (`/^[A-Za-z_][A-Za-z0-9_]*$/`) is the kit's shared "safe identifier" validator —
variable names, slugs, asset tags -- usable directly with zod's `.regex()` or any plain
`identifierRegex.test(value)` check.

For a form that lives entirely inside a modal, `useModalForm` owns the modal itself (via `@ui/modals`)
plus the zod schema, loading state, and success notification — the caller only supplies a field
renderer:

```tsx
const { open } = useModalForm({
  schema: gearItemSchema,
  initialValues: { name: '', description: '' },
  successMessage: 'Gear item added',
  modalProps: { title: 'Add gear item' },
  onSubmit: async values => {
    await saveGearItem(values);
  },
});

<Button
  onClick={() =>
    open(form => (
      <>
        <TextInput
          data-autofocus
          label="Item name"
          {...form.getInputProps('name')}
        />
        <TextInput label="Description" {...form.getInputProps('description')} />
      </>
    ))
  }
>
  Add gear item
</Button>;
```

On a valid submit, `useModalForm` calls your `onSubmit` with the **zod-parsed** values
(`schema.parse(values)`), not the raw form values, so any zod transforms/coercions/defaults are
already applied by the time your code sees them.

(The docs' Forms guide -- `src/app/docs/pages/FormsGuidePage.tsx`, served at `/docs/forms` --
documents the same recipes with option tables; the implementations live under `src/ui/forms/**`.)

## 6. Storage and color-scheme hooks

**Always import storage hooks from `@ui/hooks`, never `@mantine/hooks` directly** (the wall in §1
bans the raw import in app code; inside the kit itself, only `src/ui/hooks/useStorage.ts` is allowed
to reach the real `@mantine/hooks` versions). The shadow's whole reason to exist:

```ts
// Mantine's own `getInitialValueInEffect` defaults to `true`, which reads the stored
// value in an effect (after first paint) -- a guaranteed flash of the default value.
// The shadow hard-codes `false` so every caller reads localStorage/sessionStorage
// synchronously on first render, with `...props` still able to opt back in explicitly.
export function useLocalStorage<T = string>(props: StorageHookProps<T>) {
  return mantineUseLocalStorage<T>({
    getInitialValueInEffect: false,
    ...props,
  });
}
```

Same idea for `useSessionStorage`. Both are re-exported from `@ui/hooks` as named exports placed
after that barrel's own `export * from '@mantine/hooks'`, which is what lets them shadow Mantine's
originals for callers importing `useLocalStorage`/`useSessionStorage` from `@ui/hooks`.

**Color scheme**: `useColorScheme()` (from `@ui/hooks`) returns `{ colorScheme, computedColorScheme,
toggle, setColorScheme }`, backed by the same anti-flicker `useLocalStorage` shadow rather than
Mantine's built-in scheme manager — so the persisted preference is available synchronously on first
render, not read-then-corrected in an effect. `colorScheme` is the raw stored preference (which can be
`'auto'`); `computedColorScheme` resolves `'auto'` against the OS preference and is what most
components should render off of. `useLightDark(light, dark)` is a convenience built on
`computedColorScheme` for the common "pick one of two values depending on scheme" case.

**`useSchemeColors()`** (`@ui/hooks`) exposes the layered background tokens as `bg.level1..level4`,
plus `text.normal`/`text.muted`/`text.dimmed`:

```ts
export const staticSchemeColors = {
  bg: {
    level1: 'var(--ui-bg-1)',
    level2: 'var(--ui-bg-2)',
    level3: 'var(--ui-bg-3)',
    level4: 'var(--ui-bg-4)',
  },
  text: { normal: '...', muted: '...', dimmed: '...' },
} as const;
```

The four levels are defined per-scheme in `src/ui/styles/scheme-vars.css`:

- **`level1`** — the page itself.
- **`level2`** — the default surface sitting on the page (cards, panels).
- **`level3`** — a surface nested inside that (wells, content areas).
- **`level4`** — the contrast/accent surface (hover/active states; `Table`'s shadow uses it for its
  `headerAccent`).

Levels 1 → 3 step progressively **away from the page in the quiet direction** (light scheme:
gradually deeper greys; dark scheme: gradually deeper darks), while `level4` is the deliberate
contrast step — deeper still in light, but _lighter_ in dark — so an accent surface always reads as
distinct from the page in either scheme:

```css
:root[data-mantine-color-scheme='light'] {
  --ui-bg-1: var(--mantine-color-body);
  --ui-bg-2: var(--mantine-color-gray-0);
  --ui-bg-3: var(--mantine-color-gray-1);
  --ui-bg-4: var(--mantine-color-gray-3);
}
:root[data-mantine-color-scheme='dark'] {
  --ui-bg-1: var(--mantine-color-body);
  --ui-bg-2: var(--mantine-color-dark-8);
  --ui-bg-3: var(--mantine-color-dark-9);
  --ui-bg-4: var(--mantine-color-dark-5);
}
```

The same file defines the per-scheme text steps (`--ui-text-muted`, `--ui-text-gray`,
`--ui-text-dimmed`) that `text.*` reads, and `--ui-shadow-floating` for floating chrome.

Use `bg.level1`..`bg.level4` (or the raw CSS vars) instead of hardcoding a Mantine gray/dark shade
directly, so a surface's elevation stays consistent and scheme-aware automatically. This ladder is
the kit _default_, not the contract -- the four vars are remappable surface slots, and consumers may
re-point them to role-based surfaces per scheme. See "The `--ui-bg-*` surface-slot contract" in §4
for what that means for kit components.

## 7. Boot family contract

`index.html` inlines a static loading-bar `<style>` block directly in `<head>`, so it paints the
instant the browser has the HTML document — before the module script is fetched/parsed/executed,
before React exists, before any bundler-owned stylesheet has loaded. `src/main.tsx`'s
`createRoot(...).render(...)` replaces `#root`'s entire subtree (this markup included) the moment
React actually mounts.

That inline block exists in two copies: the load-bearing one in `index.html`, and a reviewable,
lintable reference copy in `src/boot/simple-loading-bar.css` (not itself linked/loaded — it's there
so the CSS can be diffed/linted normally). Both copies wrap the shared rules in matching markers:

```
/* BEGIN SYNCED RULES: keep in sync with src/boot/simple-loading-bar.css (see src/boot/loading-bar-sync.test.ts) */
...
/* END SYNCED RULES */
```

`src/boot/loading-bar-sync.test.ts` reads both files off disk, extracts the text between each pair
of markers, normalizes whitespace, and asserts they're identical — so **any edit to the loading-bar
CSS must be made in both files**, and drift is caught by `bun run test`, not by someone noticing in
review.

`src/boot/SimpleAlerts.ts` is the last-resort, dependency-free (no React, no Mantine) fatal-error
safety net for the window before React has mounted. It must be wired up in this exact order in
`main.tsx`:

```tsx
registerSimpleAlerts();       // BEFORE the React render call

createRoot(document.getElementById('root')!).render(...);

markMounted();                 // only reached if render() didn't throw
```

`registerSimpleAlerts()` attaches `window` `error`/`unhandledrejection` listeners that inject a
fixed, plain-DOM error panel (with a Reload button) if either fires before the app has mounted —
including the render call itself throwing synchronously. `markMounted()` flips an internal flag so
that from that point on, both listeners no-op and the mounted app owns its own error handling (error
boundaries, notifications, etc.). Registering `SimpleAlerts` _after_ the render call — or skipping
`markMounted()` — defeats the contract, so don't reorder those three lines.

## 8. Optional local rules (off by default)

Two local ESLint rules live in `eslint-local/` and are wired into `eslint.config.js` but **off by
default** -- each is one line to enable per project:

```js
plugins: { local: { rules: { 'require-data-testid': requireDataTestid, 'no-inline-styles': noInlineStyles } } },
rules: {
  // Optional rules, off by default. Flip to 'error' per project when ready to enforce.
  'local/require-data-testid': 'off',
  'local/no-inline-styles': 'off',
  ...
```

To enable either for a given app, change its line to `'error'` (or `'warn'` while retrofitting
existing code) in `eslint.config.js`. Both only apply to app code (same `files`/`ignores` scope as
the import wall in §1) -- the kit's own components are exempt.

**`require-data-testid`** (`eslint-local/require-data-testid.js`) flags `Button`/`Anchor`/
`UnstyledButton`/`FileButton` JSX elements missing a `data-testid` attribute.

**`no-inline-styles`** (`eslint-local/no-inline-styles.js`) flags any JSX `style=`, `styles=`, or
`sx=` attribute, enforcing the kit's styling discipline in app code: component-wide defaults belong
in the theme's `components` map (`SomeComponent.extend({ defaultProps })`, §4), colors come from the
`--ui-bg-*` / `--mantine-*` token vars, and anything structural goes in a CSS module. Note that this
template's own demo app does not pass with the rule on -- it uses `style=` where a one-off inline
style is genuinely simpler -- and the kit itself deliberately passes custom CSS properties via
`style` in places (e.g. `AnimatedBorderBox`'s `--abb-fill` override point, §4), which is exactly
why the rule never applies to `src/ui/**`. It ships for consumer apps that want the zero-inline-style
discipline enforced from day one.

## 9. Scaffolding a new app

**Template repo only.** This section documents `create-cli/`, which is excluded from every
scaffold (see the `EXCLUDE` list below) — a scaffolded app never has a `create-cli/` directory and
can't run the command below. If you're reading this file inside a scaffolded app rather than the
template repo itself, this section doesn't apply to you; skip to §8 or back to §1.

This repo doubles as the template `create-cli/create.ts` scaffolds from. From within this repo:

```bash
bun create-cli/create.ts <target-dir> [--workspace] [--name <package-name>]
```

This copies the whole template (excluding `node_modules`, `.git`, `dist`, `storybook-static`,
`.superpowers`, and `create-cli` itself — `bun.lock` **is** kept, so the scaffolded app installs the
exact dependency versions this template was built and tested against), writes a `.gitignore` from
`create-cli/gitignore.template` if the copy didn't already produce one (npm never packs
`.gitignore`, so a scaffold run from the published package needs it written explicitly), replaces
the `mattstack-console` name token with `<app-name>` in a fixed list of files, then sets the scaffolded
`package.json`'s `name` to `<app-name>` explicitly, forces `private: true`, rewrites `description`,
and strips the `bin` and `files` fields (the `name`/`description` overrides matter once this
template package is itself published as `create-mattstack-console`: the token-replace pass alone would
turn those into `create-<app-name>` instead of `<app-name>`), and runs `git init` + an initial
commit in the target directory. The app name defaults to the target dir's basename; `--name` sets
it explicitly and supports scoped names (`@scope/ui`). When the template source is a git checkout,
the copy list comes from `git ls-files` (tracked files only), so untracked scratch files in the
working tree never leak into scaffolds; a published-tarball install (no `.git`) keeps the plain
directory walk, curated by npm's `files` whitelist. See `PUBLISHING.md` at the repo root for the
npm publish runbook.

### Workspace adoption

To scaffold the kit as a member of an existing bun-workspace monorepo, add `--workspace`:

```bash
bun create-cli/create.ts packages/ui --workspace --name @scope/ui
```

Workspace mode skips, exactly: `git init`/identity/initial commit (the host repo owns git),
copying `bun.lock` (the workspace root lockfile owns resolution), and the `.github/` directory
(nested workflows never run in a monorepo member). Everything else ships as in standalone mode.
Next steps in this mode: make sure the root `package.json` `"workspaces"` globs match the new
directory, `bun install` at the workspace ROOT, then `bun run dev` in the member.

Consumer-verified lesson: in a bun workspace, an explicit `@types/node` major in one member can
split hoisting when other members rely on a transitive `@types/node` (their `*` range resolving
elsewhere), producing duplicate-type errors. Align every member on one `@types/node` major; this
kit pins `@types/node` `^24`.

Another consumer-verified lesson: Bun's automatic `.env` loading is cwd-relative. Running a
member's entry point from the workspace ROOT (`bun packages/ui/scripts/foo.ts`) does not pick up
`packages/ui/.env` -- run from the member directory (or pass the env explicitly) when a script
depends on a nested `.env`.

**Maintaining `TOKEN_FILES`**: `create.ts` keeps an explicit list of every file that carries the
literal string `mattstack-console` as text, so the scaffold can replace it. If you add a new template file
that embeds the name (branding, an example value, test fixture content, etc.), re-run

```bash
grep -rl "mattstack-console" . --exclude-dir={node_modules,.git,dist,storybook-static,.superpowers}
```

against the repo root and add any new hit to the `TOKEN_FILES` array in `create-cli/create.ts` —
otherwise a scaffolded app will carry a stray `mattstack-console` string in that file. The CI `scaffold`
job (`.github/workflows/ci.yml`) exercises this end-to-end: it scaffolds a probe app, installs,
typechecks, builds, tests, and runs the de-brand gate against it, so a forgotten `TOKEN_FILES` entry
that leaks a forbidden string would fail there too.

## 10. Bring your own router

The kit is **router-agnostic by design**. Nothing in `@ui/*` imports or assumes a router -- the demo
app's hand-rolled router (`src/app/router/`: `Link`, `matchPath`, `navigation`) exists only so the
template runs standalone, and it's deliberately disposable. Adding a real router is one child swap
in `main.tsx`: keep every provider (`MantineProvider`, `ModalsProvider`, `Notifications`, the
`SimpleAlerts` bracketing from §7) and replace the `<App />` child with your router's provider/root.

**The typed-link trap (TanStack Router and friends)**: Mantine's polymorphic `component` prop
happily accepts a router `Link` -- `<Anchor component={Link} to="/settings">` renders and works. But
the polymorphic prop machinery types the passthrough props loosely (`Omit<any, ...>`), which
silently **widens a typed router's route-literal `to` prop to `string`** -- with TanStack Router,
nonexistent routes compile without complaint. So:

- **Do not rely on bare `component={Link}` for internal navigation** when using a typed router.
  Reserve it for cases where route typing genuinely doesn't matter.
- **Wrap Mantine components with the router's `createLink()`** (TanStack's official API for exactly
  this) to get typed `to` props on kit components. Because Mantine's components are polymorphic,
  give `createLink` a concretely-typed `forwardRef` wrapper -- the same small-wrapper trick §4
  prescribes for presetting non-factory components.

Consumer-side sketch (this repo has no TanStack dependency; shape follows TanStack Router's
custom-link docs):

```tsx
// app code, e.g. src/app/router-links.tsx -- NOT part of this kit
import { forwardRef } from 'react';
import { createLink } from '@tanstack/react-router';

import { Anchor, type AnchorProps } from '@ui/core';

const AnchorBase = forwardRef<HTMLAnchorElement, Omit<AnchorProps, 'href'>>(
  (props, ref) => <Anchor ref={ref} {...props} />
);

export const AnchorLink = createLink(AnchorBase);

// <AnchorLink to="/settings">Settings</AnchorLink>  -- `to` is route-literal typed;
// a typo'd route is now a compile error instead of a silent string.
```

The kit's own components use the `component={...}` idiom internally (e.g. `Notch` renders
`Paper component={Group}`) -- that's fine, those are layout polymorphism, not navigation. The trap
is specifically _typed router links_ flowing through a polymorphic prop. One kit component invites
exactly that: `RailEntry` (§2's app chrome recipe) links via `component={Link}`, so with a typed
router, wrap it through `createLink()` the same way as `Anchor` above instead of passing the bare
router `Link`.

## 11. Formatting

Prettier is the formatter for the whole repo, configured in `.prettierrc` (see `.prettierignore` for
what's excluded -- `node_modules`, `dist`, `storybook-static`, `logs`, `bun.lock`, and similar
generated/non-source paths). Two scripts wrap it:

- `bun run format` -- reformats everything in place (`prettier --write . --cache`).
- `bun run format:check` -- fails without writing anything, the same check CI runs
  (`prettier --check . --cache`).

Import order is enforced by `@ianvs/prettier-plugin-sort-imports` (configured via `importOrder` in
`.prettierrc`), not by hand or by ESLint: react imports first, then third-party modules, then a
blank line, then `@ui/*` imports, then relative imports. Side-effect imports (like the kit's own
`import '@ui/styles/index.css'` in `src/main.tsx`) are never reordered relative to each other or to
surrounding imports, so load-order-sensitive imports stay put.

ESLint defers all stylistic and formatting concerns to Prettier: `eslint-config-prettier` is applied
last in `eslint.config.js`'s config chain, turning off every core/plugin rule that would otherwise
conflict with or duplicate Prettier's output. ESLint's own `no-restricted-imports` wall (see §1)
is a semantic rule about which packages may be imported, not an ordering rule, so it keeps working
unchanged alongside the sort-imports plugin.

React hook correctness is linted by `eslint-plugin-react-hooks` with the two classic rules:
`rules-of-hooks` as an error and `exhaustive-deps` as a warning, so
`// eslint-disable-next-line react-hooks/exhaustive-deps` comments resolve in kit and app code
alike (a deliberate mount-only effect carries that disable plus a comment saying why). The
plugin's full flat.recommended preset (the React Compiler rule set) is deliberately not enabled.
