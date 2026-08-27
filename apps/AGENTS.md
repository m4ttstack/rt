# AGENTS.md

Contract for anyone (human or agent) working in this repo: editing
`packages/ui/src/**`, wiring up a form/modal/notification, adding a
component, touching `packages/server/src/**`, or consuming
`@mattstack/app-kit` / `@mattstack/app-server` from another app. Sections
1-7 are the kit contract (`packages/ui/src`), unchanged in substance from
`mantine-kit`'s own `AGENTS.md` (mattstack apps absorbed `src/ui` from
mantine-kit; see `docs/superpowers/specs/2026-08-26-app-kit-design.md`).
"The mattstack layer", "The server package", and "Consumer requirements"
are new to this repo.

## 1. Why the import walls exist, and how to satisfy them

Two separate walls, at two separate scopes.

**A consuming app's own code** (chat, console, `probe/`) is not allowed to
import Mantine packages directly. Every Mantine import goes through
`@mattstack/app-kit/*` subpath barrels instead, so the kit's fixed
defaults and overrides (a shadowed `Table`, a themed `Modal`, a typed
`notifications.show`, ...) are the only way anything Mantine-shaped enters
the app. This wall ships AS the `mattstackEslint()` preset
(`packages/ui/presets/eslint.js`, exported as `@mattstack/app-kit/eslint`)
-- a consumer spreads it into its own `eslint.config.js` and passes an
`app` glob matching its own source. This repo's own root `eslint.config.js`
does exactly that for `probe/src/**/*.{ts,tsx}`; it is the reference
wiring a migrating app copies:

```js
const wall = (pkg, subpath) => ({
  name: pkg,
  message: `Import from '@mattstack/app-kit/${subpath}' instead. The kit barrel adds fixed defaults and overrides.`,
});
```

| Import this (banned in app code) | Use this instead                                                               |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `@mantine/core`                  | `@mattstack/app-kit/core`                                                      |
| `@mantine/hooks`                 | `@mattstack/app-kit/hooks`                                                     |
| `@mantine/form`                  | `@mattstack/app-kit/forms`                                                     |
| `@mantine/modals`                | `@mattstack/app-kit/modals`                                                    |
| `@mantine/notifications`         | `@mattstack/app-kit/notifications`                                             |
| `@mantine/spotlight`             | `@mattstack/app-kit/spotlight`                                                 |
| `@mantine/code-highlight`        | `@mattstack/app-kit/lazy`                                                      |
| `@mantine/dates`                 | `@mattstack/app-kit/core` (dates re-exports live in the core barrel, see §2)   |
| `lucide-react`                   | `@mattstack/app-kit/icons` (`import { Icon } from '@mattstack/app-kit/icons'`) |

Two `patterns` entries extend the wall to package families:
`react-icons`/`react-icons/*` is banned outright, and
`codemirror`/`@codemirror/*` is banned everywhere except inside the kit's
own `./lazy` CodeMirror loader. A third pattern bans `@ui/*` outright (the
old mantine-kit alias does not exist here), and a fourth bans any value
import from `**/server/**` (type imports allowed), so a server module
never reaches the browser bundle.

If ESLint reports `Import from '@mattstack/app-kit/core' instead...` on a
`@mantine/core` import, the fix is always the same: change the import
specifier to the matching `@mattstack/app-kit/*` barrel. Never disable the
rule at the call site in app code -- the whole point is that app code
never needs to.

**Inside `packages/ui/src/**` itself**, a second, stricter rule applies --
this one is NOT shipped in the `@mattstack/app-kit/eslint` preset (a
consumer never sees it); it lives only in this repo's own root
`eslint.config.js`, scoped to `packages/ui/src/**`:

```js
{
  files: ['packages/ui/src/**/*.{ts,tsx}'],
  ignores: ['packages/ui/src/core/index.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@mantine/core',
        importNames: ['Table', 'TextInput', 'CopyButton'],
        message: 'Use the shadowed versions from @mattstack/app-kit/core.',
      }],
    }],
  },
}
```

Every file under `packages/ui/src/**` (including other kit components) is
banned from importing the _named_ `Table`/`TextInput`/`CopyButton` exports
straight from `@mantine/core` -- those three are shadowed
(`packages/ui/src/core/table/Table.tsx`,
`packages/ui/src/core/text-input/TextInput.tsx`,
`packages/ui/src/core/copy-button/CopyButton.tsx`) and any other kit code
that needs one must go through `@mattstack/app-kit/core`'s own version.
The shadow definition files document their own exception inline:

```ts
// eslint-disable-next-line no-restricted-imports -- shadow definition site: this IS the
// `@mattstack/app-kit/core` Table the eslint wall (eslint.config.js) points everything else at.
import { Table as MantineTable, Paper } from '@mantine/core';
```

`packages/ui/src/core/index.ts` itself is `ignores`-listed from this
second rule too, because its job is to `export * from '@mantine/core'`
(and `@mantine/dates`) wholesale before layering the two named shadow
exports on top -- see §2 for why export order there matters.

**Heads up, the `TextInput` shadow changes autofill behavior**: the kit's
`TextInput` (`packages/ui/src/core/text-input/TextInput.tsx`) defaults
`autoComplete="off"`. That is a real behavior change when porting existing
forms: fields that used to autofill silently stop. Opt back in per field
where autofill is actually wanted: `autoComplete="on"`, or a specific
token (`autoComplete="email"`, `"current-password"`, ...) on real
login/signup/profile fields.

## 2. Adding a component: kit vs. app

**Add it to the kit (`packages/ui/src/core/<name>/`)** when the component
is generic -- no product-specific copy, no product-specific business
logic. Every kit component follows the same shape:

- `packages/ui/src/core/<name>/<Name>.tsx` -- the component.
- `packages/ui/src/core/<name>/<Name>.stories.tsx` -- a Storybook story
  (`Meta`/`StoryObj` from `@storybook/react-vite`).
- A named export added to `packages/ui/src/core/index.ts`.

If the component's name collides with something `@mantine/core` (or
`@mantine/dates`, also star-exported there) already exports, the barrel's
export order is load-bearing:

```ts
export * from '@mantine/core';
export * from '@mantine/dates';

// Shadows (Table, TextInput, CopyButton -- see the eslint wall in
// packages/ui/src/**). Named exports placed AFTER the `export *` above, so
// they win over the star-exported Mantine originals...
export { Table } from './table/Table';
export type { TableProps } from './table/Table';
export { TextInput } from './text-input/TextInput';
export type { TextInputProps } from './text-input/TextInput';
```

Per the ES module spec, a named export always wins over a colliding name
introduced by a `export *` elsewhere in the same module, regardless of
statement order -- but the convention here is still to place the named
shadow export _after_ the star line, so the barrel reads top-to-bottom as
"everything from Mantine, then the kit's own overrides on top."
(`@mattstack/app-kit/modals` and `@mattstack/app-kit/notifications` follow
the identical pattern for their own colliding `modals`/`notifications`
names -- see §5.) If a new component's name does _not_ collide with
anything in `@mantine/core`/`@mantine/dates`, it is a plain named export
anywhere in the barrel -- e.g. `PageShell`, `SelectableList`,
`HybridMenu`. A colliding name is fine when the shadow is _deliberate_:
the kit intentionally shadows Mantine's headless render-prop `CopyButton`
with its own labeled, batteries-included `CopyButton`, while
`CopyActionIcon` keeps the icon-only variant under a collision-free name.
Only rename or namespace a component if a bare name would shadow an
existing Mantine export _unintentionally_.

**Adding a component family**: sibling components that belong together
still live in **one** folder, `packages/ui/src/core/<family>/`, with one
`.tsx` + `.stories.tsx` per sibling. Shared data or helpers backing the
family go in a plain module inside that same folder, imported relatively
by the siblings. Export the data module's contents through
`packages/ui/src/core/index.ts` only if consumers genuinely need them --
by default only the components (and their prop types) cross the barrel.

**Add it to an app** when the component is product-specific: product
copy, product data, or otherwise only makes sense for one app rather than
any app built on the kit. See "The mattstack layer" below for what the
kit itself ships as app-level chrome (`MattstackShell`, `RailLink`) versus
what stays app-owned.

**App chrome recipe**: the double-nav app chrome ships as a kit component,
composed from `RailShell` (`packages/ui/src/core/rail-shell/`, a
`SiteShell` in `layout="alt"` whose navbar is a mini icon rail) plus
`Rail`/`RailEntry` in its `rail` slot, wired by `useRailState`. `RailShell`

- `PageShell` compose the same way as in mantine-kit: host a `PageShell`
  in `children` (passing the chrome's header height as its `topOffset`) for
  the page-level sidebar. The z-index contract is fixed inside `RailShell`
  and pairs with `PageShell`: desktop rail navbar 5, under the `PageShell`
  root's 10, header 100 (Mantine's default), mobile click-to-close overlay
  999, mobile-open chrome 1000. `RailShell.stories.tsx` is the live
  Storybook reference; `MattstackShell` (see "The mattstack layer") is the
  higher-level, whitelabeled shell apps actually mount, and composes
  `RailShell` internally.

**Keep kit modules tree-shakeable.** Consumers vendor all of
`packages/ui/src` but may render a fraction of it; a module is only
droppable from their bundles if its top level is provably
side-effect-free. Three patterns silently pin a module (and its whole
import tree) into every consumer build:

1. **Top-level mutations** -- `Component.displayName = ...`, compound
   statics (`PageShell.Sidebar = Sidebar`). Instead: name the inner
   function, and attach compound statics via a single
   `/* @__PURE__ */ Object.assign(Root, { ... })` export (see
   `PageShell.tsx`, `Table.tsx`).
2. **Unannotated top-level factory calls** -- `forwardRef(...)`,
   `createPolymorphicComponent(...)`, `Container.withProps(...)`,
   registry-builder calls. Annotate each with `/* @__PURE__ */`. If the
   call's arguments contain property reads (`MantineTable.Thead`), wrap
   call and reads together in a `/* @__PURE__ */ (() => ...)()` IIFE.
3. **Top-level property reads and spreads** -- `const X = Menu.Item as
...`, object spreads of imported records. Wrap in a PURE IIFE (see
   `SearchableMenu.tsx`, `Icons.ts`).

`packages/ui/scripts/treeshake-check.sh` (CI: `bun run treeshake`)
enforces this: it builds a minimal probe that imports only `Button` + the
theme through the barrels and fails if any kit module outside the
documented floor survives in the bundle. If a new component trips it, one
of the three patterns above is the reason.

## 3. Icon registry workflow

All icons go through the registry in `packages/ui/src/icons/Icons.ts` --
nothing imports `lucide-react` directly outside that file (the wall bans
it: `import { Icon } from '@mattstack/app-kit/icons'`).

**Adding a lucide icon**: import it from `lucide-react` at the top of
`Icons.ts`, wrap it with `lucideWrapperFn` (adapts a `LucideIcon` to the
kit's fixed prop surface -- `size` defaulting to 16, plus
`color`/`className` passthrough), and add it to whichever category object
fits, spread into the exported `Icons` map:

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

`packages/ui/src/icons/Icons.test.ts` guards the registry against any
entry that resolves to `undefined` (a typo'd lucide import name silently
imports `undefined`), and that `ICON_NAMES` enumerates the registry
exactly. `IconName` (in `types.ts`) is `keyof typeof Icons | (keyof
AppIcons & string)` -- derived from the registry itself plus whatever an
app has augmented (see "Extension points" under "The mattstack layer"),
so adding a kit entry automatically makes it a valid `<Icon name="...">`
value with no separate list to update.

**Brand icons**: `packages/ui/src/icons/brand-icons/index.ts` is an
intentionally empty slot (`BrandIcons`) for a product's own logo/brand
SVGs, spread into `Icons` _last_ so a brand icon can shadow a generic name
if it ever needs to. Using `satisfies Record<string, IconComponent>`
(rather than a type annotation) is deliberate: it keeps the inferred type
as the literal object with no index signature, so spreading `BrandIcons`
into `Icons` does not widen `IconName` to a bare `string`.

## 4. Theme override patterns

**The theme is three files, all kit-owned; a consuming app edits none of
them.** This is the one place app-kit's contract differs from
mantine-kit's: mantine-kit lets an app own `app-theme.ts` as its brand
extension point, but app-kit closes that off on purpose --
`app-theme.ts` and `app-colors.ts` permanently re-export
`@mattstack/mantine-tokyo`'s theme and colour names:

| File                          | Owner | What it holds                                                           |
| ----------------------------- | ----- | ----------------------------------------------------------------------- |
| `design-system/base-theme.ts` | kit   | `baseTheme`, the kit's unbranded defaults.                              |
| `design-system/app-theme.ts`  | kit   | `export { tokyoTheme as appTheme } from '@mattstack/mantine-tokyo'`.    |
| `design-system/theme.ts`      | kit   | `theme = mergeThemeOverrides(baseTheme, appTheme)`, i.e. Tokyo-branded. |

A mattstack app that needs a new named colour adds it to
`@mattstack/mantine-tokyo` (a kit-family change), never to itself or to
app-kit's `app-colors.ts`. A per-app runtime override goes through
`mountMattstackApp(node, { theme })` (merged on top of the already-branded
`theme`), not through editing any of the three files above.

This still buys the same two things mantine-kit's split buys:

- **The kit's unbranded look stays reachable.** `baseTheme` is still an
  importable object, so "make this subtree look like the kit, not Tokyo"
  is `<ThemeIsland theme={baseTheme} baseSurfaces>` -- one import, no
  transcription, no drift.
- **DEFAULT vs BRAND stays legible.** Everything in `base-theme.ts` is a
  considered default (the component ergonomics especially -- `Group`
  nowrap, `Select` allowDeselect, the Tooltip pop family); `app-theme.ts`
  is where the brand palette lives, separately.

**Write scalar-or-object theme options in their object form.**
`primaryShade` is `{ light, dark }` in `base-theme.ts` even though both
shades are 7 and Mantine accepts the scalar. Mantine's `deepMerge`
recurses whenever the SOURCE value is an object without checking that the
target is one too, so `deepMerge(7, { light: 7, dark: 4 })` spreads
`{...7}` to `{}` and returns `{}`, which `validateMantineTheme` then reads
as the object form and dereferences, blanking the page with `Cannot read
properties of undefined (reading 'toString')` from
`isValidPrimaryShade`, naming neither `primaryShade` nor the theme that
supplied it. Matching the wider shape makes the kit theme safe to nest
under or over any override. `design-system/theme.test.tsx` pins it.

**Kit-wide defaults** live in `packages/ui/src/design-system/base-theme.ts`,
via `createTheme`'s `components` map in Mantine's string-keyed form --
deliberately NOT each component's `.extend({ defaultProps })`:

```ts
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
  }),
});
```

Both forms merge identically at runtime, because `Component.extend` IS
Mantine's `identity` -- its only contribution is typing. But referencing
the component to reach `.extend` imports the component OBJECT into the
theme module, pinning that component (plus its dependency trees) into
every bundle. Keying off the component name (a type-level `typeof
import('@mantine/core')`) gets the same types with no value import.
`packages/ui/scripts/treeshake-check.sh` guards this.

**Per-subtree theming: to ADD a treatment, wrap with an override; to
SUBTRACT one, provide a baseline.**

| Ask                                                           | Use                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| "this section needs rounder cards / a different primaryColor" | `ThemeOverrideWrapper` (merges onto the ancestor theme)    |
| "make this route look like the unbranded kit again"           | `ThemeIsland theme={baseTheme} baseSurfaces` (replaces it) |
| "this preview must render exactly as production does"         | `ThemeIsland theme={appTheme} cssVariablesResolver={...}`  |

`ThemeOverrideWrapper` requires an ancestor `MantineProvider`
(`useMantineTheme()` throws otherwise), which is always true inside a
mattstack app since `mountMattstackApp` wraps the whole tree in one. It is
layout-transparent (`display: contents`).

**Never nest a bare `MantineProvider` for a subtree.** Both components
route through an internal `ScopedThemeProvider` because a nested provider
gets three things wrong, each silently: `cssVariablesSelector` defaults to
`:root` (a nested provider emits variables globally); Mantine composes
scheme blocks as `${selector}[data-mantine-color-scheme="..."]`, so that
attribute has to sit on the same element; and `MantineProvider` writes the
scheme attribute to `getRootElement()` seeded from its own
`defaultColorScheme` of `'light'`, which can flip the whole page light on
a dark-preference machine. `forceColorScheme` pins it to what the parent
already resolved. A nested provider also does NOT inherit the app's
`cssVariablesResolver`; both components take one and forward it.
`design-system/ThemeIsland.test.tsx` pins all of this.

**Per-call-site presets**: for Mantine's own factory components
(`Button`, `Badge`, `Paper`, `Container`, ...), use the typed static
`.withProps({...})` every factory component carries -- the kit's own
`ContentContainer` is exactly this (`Container.withProps({...})`). For kit
shadows and plain/`forwardRef` components with no static `.withProps`,
write a small wrapper component that spreads caller props after the
preset (caller props win), keeping the component's own concrete prop
type.

**The `--ui-bg-*` surface-slot contract**: the four background variables
(`--ui-bg-1..4`, exposed as `bg.level1..4` by `useSchemeColors`, see §6)
are **four scheme-aware surface slots**. The default mapping (in
`packages/ui/src/styles/scheme-vars.css`) is a monotonic "raised =
lighter" elevation ladder, but that ordering is a property of the default
values, not of the contract. A consumer may re-point the four vars per
scheme however its design needs, as long as each slot stays scheme-aware
-- restore the kit's surfaces on a subtree with the `.ui-base-surfaces`
class (what `ThemeIsland`'s `baseSurfaces` prop adds). **Never point a
`--ui-base-*` value at a live `--ui-*` slot**: that closes a CSS CYCLE,
which makes every custom property in it invalid at computed-value time
(both sides silently fall back to their initial values rather than
erroring). `styles/scheme-vars.test.ts` pins it. Kit components must not
assume the slots form an ordered ramp across a multi-slot effect; picking
a single slot for a single role is fine.

**Accent props on kit components**: a component with one accent takes
`color: MantineColor` (`Notch`, `CollapsibleAlertCard`); a component with
several takes a single `colors` tuple sized to its need
(`GradientBorder`'s `[left, mid, right]`, `AnimatedBorderBox`'s
`[primary, secondary]`). Scheme-tuning knobs stay separate props
(`AnimatedBorderBox`'s `shade`).

**`primaryShade` when re-theming**: `{ light: 7, dark: 7 }` is tuned for
the default indigo on the default ramp (Mantine's default 6 reads pale
against the level-2/3 surfaces). A Tokyo re-tune should generally pick a
_lighter_ shade for dark mode and consider `autoContrast` so filled
variants keep readable label colors across shades.

**Known Mantine escape hatches**: a few Mantine components hardcode a
pill radius in their own stylesheet instead of following
`theme.defaultRadius` (verified against Mantine 9: `Badge`, `Avatar`,
`Switch`, `Chip`). Rebranding radius globally needs an explicit default in
the theme's `components` map too, e.g. `Badge: { defaultProps: { radius:
'md' } }`.

**Where raw hex lives**: raw hex/rgb values only appear in the colour
definition layer -- `@mattstack/mantine-tokyo`'s ramp/colour files and the
scheme vars in `packages/ui/src/styles/scheme-vars.css` (which reference
Mantine's palette vars rather than literals). Component code is not part
of the hex home -- components consume theme colours, `--mantine-color-*`
vars, or the `--ui-bg-*` slots, never literals.

## 5. Facade usage recipes

**Shells own their own frames.** Three defaults are deliberate:
`PageShell.Content` is the page's scroll frame (a `ScrollArea.Autosize`
capped at the available height, tune with `scrollAreaProps` or take the
frame over with `scrollClamp`), `PageShell.Sidebar` scrolls its own
children, and `PageShell.Content` wraps children in `ContentContainer`
(capped, centered column; opt out with `contentContainer={false}`).

**`RailShell` + `PageShell` is the normal case, and they wire themselves.**
The rail publishes its `headerHeight` on context and a hosted `PageShell`
defaults its `topOffset` to it, so the fixed header's height lives in one
place. An explicit `topOffset` still wins.

**Modals** (`@mattstack/app-kit/modals`): `modals.open` is a typed
pass-through to `@mantine/modals`' `openModal`; `modals.confirm` /
`modals.prompt` are the kit's own higher-level helpers.

```tsx
import { modals } from '@mattstack/app-kit/modals';

modals.confirm({
  title: 'Remove item',
  message: `Remove "${name}"? This can't be undone.`,
  destructive: true,
  onConfirm: () => remove(name),
});

modals.prompt({
  title: `Rename "${name}"`,
  label: 'New name',
  required: true,
  initialValue: name,
  onSubmit: newName => notifications.info(`Renamed to ${newName}`),
});
```

`destructive: true` on `confirm` renders a warning icon and a red confirm
button; `hideCancelButton: true` removes the cancel button entirely.
`prompt`'s `required` rejects an empty/whitespace submit before
`validate` runs; `message` is prose above the whole form, not the input's
label.

**Notifications** (`@mattstack/app-kit/notifications`): per-level
shorthands (`success`/`error`/`warning`/`info`) each pick a
level-appropriate icon, colour, and `autoClose` default -- `error` does
not auto-close. Each shorthand also accepts a full props object instead of
a bare string, and `color`/`icon`/`autoClose` can still be overridden per
call. `TimedRingProgress` is a countdown ring that calls `onComplete`
exactly once, typically used as a notification's own `icon`.

**Forms** (`@mattstack/app-kit/forms`): `FormContainer` wraps a `useForm`
instance (validated with `zodResolver`) in a `Paper` + submit-row layout
with a built-in loading overlay and error summary. `identifierRegex`
(`/^[A-Za-z_][A-Za-z0-9_]*$/`) is the kit's shared "safe identifier"
validator. For a form that lives entirely inside a modal, `useModalForm`
owns the modal, the zod schema, loading state, and success notification --
on a valid submit it calls `onSubmit` with the **zod-parsed** values
(`schema.parse(values)`), not the raw form values.

## 6. Storage and color-scheme hooks

**Always import storage hooks from `@mattstack/app-kit/hooks`, never
`@mantine/hooks` directly.** The shadow's whole reason to exist: Mantine's
own `getInitialValueInEffect` defaults to `true` (a guaranteed flash of
the default value); the shadow hard-codes `false` so every caller reads
localStorage/sessionStorage synchronously on first render.

**Color scheme**: `useColorScheme()` returns `{ colorScheme,
computedColorScheme, toggle, setColorScheme }`, backed by the same
anti-flicker `useLocalStorage` shadow. `colorScheme` is the raw stored
preference (can be `'auto'`); `computedColorScheme` resolves `'auto'`
against the OS preference and is what most components should render off
of. `useLightDark(light, dark)` is a convenience built on
`computedColorScheme`.

**`useSchemeColors()`** exposes the layered background tokens as
`bg.level1..level4`, plus `text.normal`/`text.muted`/`text.dimmed`,
defined per-scheme in `packages/ui/src/styles/scheme-vars.css`:

- **`level1`** -- the page itself.
- **`level2`** -- the default surface sitting on the page (cards, panels).
- **`level3`** -- a surface nested inside that (wells, content areas).
- **`level4`** -- the contrast/accent surface (hover/active states;
  `Table`'s shadow uses it for its `headerAccent`).

Levels 1-3 step progressively away from the page in the quiet direction
(light: gradually deeper greys; dark: gradually deeper darks), while
`level4` is the deliberate contrast step (deeper still in light, lighter
in dark). Use `bg.level1..4` (or the raw CSS vars) instead of hardcoding a
Mantine gray/dark shade directly.

## 7. Boot family contract

`index.html` inlines a static loading-bar `<style>` block directly in
`<head>`, so it paints the instant the browser has the HTML document --
before the module script is fetched/parsed/executed, before React exists.
`mountMattstackApp`'s render replaces `#root`'s entire subtree (this
markup included) the moment React actually mounts.

That inline block exists in two copies: the load-bearing one in the
consuming app's own `index.html`, and the package's
`@mattstack/app-kit/boot/simple-loading-bar.css` (a reviewable, lintable
reference; not itself linked/loaded). Both wrap the shared rules in
matching markers:

```
/* BEGIN SYNCED RULES: keep in sync with @mattstack/app-kit/boot/simple-loading-bar.css (see expectLoadingBarInSync) */
...
/* END SYNCED RULES */
```

The two-file sync contract has a clear owner on each side: the package
owns the stylesheet, and the app owns `index.html` plus a one-line
`loading-bar-sync.test.ts` calling
`expectLoadingBarInSync(readFileSync('index.html', 'utf-8'))` (see
`probe/src/loading-bar-sync.test.ts`). `expectLoadingBarInSync`
(`@mattstack/app-kit/test-utils`) reads both files off disk at test time
and extracts the block between the markers from the package's OWN
stylesheet -- no string constant to drift -- so the check runs in every
app against the package version it actually installed.

`registerSimpleAlerts`/`markMounted` (`@mattstack/app-kit/boot`) is the
last-resort, dependency-free (no React, no Mantine) fatal-error safety net
for the window before React has mounted. `mountMattstackApp` wires it up
in the exact required order internally: `registerSimpleAlerts()` before
the render call, `markMounted()` only reached if render did not throw. A
consumer calling `mountMattstackApp` gets this for free and never reorders
the three steps by hand.

## 8. The mattstack layer

`packages/ui/src/app/` (exported as `@mattstack/app-kit/app`) and
`packages/ui/src/router/` (`@mattstack/app-kit/router`) are the
whitelabeled shell + boot + router glue every mattstack app shares, on top
of the generic kit in sections 1-7.

**`app`**: `mountMattstackApp(node, opts?)` renders `StrictMode >
MantineProvider(theme merged with opts.theme, defaultColorScheme "auto") >
ModalsProvider > node + Notifications`, brackets the render with the boot
family (§7), and imports `./styles.css` (pulling in the Tokyo CSS) as a
side effect of the module. Target element is `#root`.

`MattstackShell` owns the `RailShell` wiring, `useRailState`, the
translucent header, the mark + wordmark recipe, and the colour-scheme
control pinned to the rail bottom (`HybridMenu`'s three-way System /
Light / Dark). `Rail` and `RailBottom` are compound statics attached with
`/* @__PURE__ */ Object.assign`, per §2's tree-shake rules:

```tsx
<MattstackShell name="chat" mark={<AppMark size={30} />}>
  <MattstackShell.Rail>
    <RailLink icon="users" label="Rooms" href="/" active />
  </MattstackShell.Rail>
  <MattstackShell.RailBottom>
    {/* optional, above the scheme control */}
  </MattstackShell.RailBottom>
  {children}
</MattstackShell>
```

`DaemonBanner` is a presentational component; `useDaemonHealth(seed?:
boolean)` polls `/api/daemon` (the route `@mattstack/app-server` mounts,
see below) and returns `{ reachable, downSince, probeCount,
lastAnsweredAt, probeNow }`. `seed` is the initial `reachable` value, kept
so a consuming app's own test can drive the daemon's starting state
through an `initialState` prop the app itself defines. `NotFoundPage`
takes `home` (default `/`).

**`router`**: `RailLink` renders `RailEntry` through wouter's `Link`
(`href`, `active`, closes the rail on click via shell context). `Link` is
wouter's, re-exported so apps have one door. `useHash()` is
`useLocationProperty(() => window.location.hash)`.

**The `AppIcons` augmentation contract**: `registerIcons({ hash:
lucideWrapperFn(Hash) })` at boot, plus `declare module
'@mattstack/app-kit/icons' { interface AppIcons { hash: true } }` in the
app's own `.d.ts`, extends the closed `IconName` union with the app's
registration. `Icon` reads a module-level registry; registration before
first render is the contract, and registering a key the kit already has
throws. See "Consumer requirements" below for the one real trap in
writing that `.d.ts` file.

**Theme extension**: `mountMattstackApp(node, { theme })` merges on top of
Tokyo (see §4 for why this is the ONLY per-app theme extension point in
this repo, unlike mantine-kit's `app-theme.ts`). Lazy loaders (heavy
dependencies like CodeMirror) get a loader in the package, never in an
app, so vendor splitting has one owner.

## 9. The server package

`@mattstack/app-server` is the Hono/Bun server frame. Subpath exports
split along one rule: **everything except the top-level `.` export is
vitest-safe (importable under `vitest`, no `hono/bun`)**; the top-level
export is the one module in the package that touches `hono/bun` and
`Bun.serve`.

| Subpath    | Exports                                                                                                                                                                                                                                                                                 | Importable under vitest |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `./app`    | `createApp({ name, version, routes })`: mounts `/api/health` (`{ ok: true, name, version }`), `/api/daemon` (rt-client `daemonHealth`, always 200), then `routes`; JSON 404 `{ error: 'not found' }`; `onError` answers `{ error: err.message }` with the `HTTPException` status or 500 | yes                     |
| `./relays` | `startRelays(relays, publish)`: one rt-client `createRelay` per entry; returns a single stop function                                                                                                                                                                                   | yes                     |
| `./static` | `mountStatic(app, serveStatic, { embedded? })`: `serveStatic` is injected (a fake in tests), disk or embedded-manifest serving, SPA fallback for every path except `/api/*` (JSON 404) and `/ws` (next); also `decideServingMode`, `loadEmbeddedManifest`, `isCompiledBinary`           | yes                     |
| `.`        | `serveMattstackApp(opts)`: `createApp` + `mountStatic` with `hono/bun`'s `serveStatic` + `/ws` upgrade subscribing each socket to every relay topic + `Bun.serve({ hostname: '127.0.0.1' })` + `server.publish` fan-out + SIGINT/SIGTERM → stop relays, stop server                     | no (`hono/bun`)         |

`/ws` is registered with no middleware in front of it: a
header-modifying middleware plus the websocket upgrade helper throws on
immutable headers. The error envelope is `{ error: string }` (an RPC
client's `res.ok` check plus JSON parse both need this shape, not a
text/plain 500 or an HTML 404).

`bin/mattstack-embed-assets` walks `dist/`, writes a manifest with `with {
type: 'file' }` imports and the path map, for a compiled-binary build:
`vite build && mattstack-embed-assets && bun build --compile --outfile
dist-bin/<name> src/server/index.ts`. `AppType` stays `typeof routes` in
the app, so an RPC client's typing is untouched by the frame.

## 10. Consumer requirements

Real findings from building `probe/` -- a consumer that misses any of
these breaks in a way that does not announce itself as "the kit is
wrong":

1. **The Mantine colour-name augmentation needs no `/// <reference>`
   line.** It lives in `packages/ui/src/design-system/colors.ts` (a
   `declare module '@mantine/core'` block) and reaches a consumer through
   any import of `@mattstack/app-kit/app`, `@mattstack/app-kit/design-system`,
   or `@mattstack/app-kit/test-utils` -- all three transitively pull in
   `design-system`. A consumer does NOT add its own reference line or
   duplicate the augmentation.

2. **Name an app-icon augmentation file so it does not share a basename
   with a sibling `.ts` file.** TypeScript drops a `foo.d.ts` when `foo.ts`
   exists next to it in the same directory, so the augmentation silently
   never loads and `IconName` never widens. `probe/src/app/icons.ts`
   (the registration call) and `probe/src/app/app-icons.d.ts` (the
   `declare module '@mattstack/app-kit/icons' { interface AppIcons {...}
}` block) are named to avoid exactly this collision -- do not name the
   augmentation file `icons.d.ts` next to an `icons.ts`.

3. **The vite preset ships as TypeScript** (`presets/vite.ts`, exported as
   `@mattstack/app-kit/vite`). Node cannot type-strip a `.ts` file inside
   `node_modules`, so a consumer whose `vite.config.ts` imports
   `@mattstack/app-kit/vite` must run every Vite invocation with
   `--configLoader runner` (`vite --configLoader runner`, `vite build
--configLoader runner`, `vitest --configLoader runner`; see
   `probe/package.json`'s `dev`/`build`/`test` scripts). **Known
   follow-up, not a resolved decision**: shipping `presets/vite.ts` as
   hand-written `.js` (the way `presets/eslint.js` already ships) would
   remove this burden entirely. Nobody has done that work yet; until then,
   every consumer's Vite scripts need the flag.

4. **Depend on packed tarballs, not bare `file:` directories, until these
   packages are published.** Bun 1.3 installs a bare `file:../packages/ui`
   dependency as a SYMLINK into the source tree (contents symlink into the
   source, not copied), which makes peers (`react`, `vite`, `wouter`)
   resolve twice -- once through the symlinked package's own
   `node_modules` resolution, once through the consumer's -- and that
   breaks the consumer's typecheck and tests in ways that look unrelated
   to the dependency. A packed tarball (`bun pm pack`) extracts as a real
   copy, the same shape a registry install gives, so peers resolve once.
   `probe/package.json` depends on `file:./vendor/mattstack-app-kit-0.1.0.tgz`
   etc, and the root `probe:install` script is the reference
   implementation: it packs all three packages fresh with `bun pm pack`
   into `probe/vendor/`, then installs. Chat's migration must do the same
   -- a bare `file:../app-kit/packages/ui` dependency is not equivalent to
   what this repo's own CI proves works.
