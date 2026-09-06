# Using tui-kit in an app

Everything an adopting app needs: the dependency, the two wiring calls, the
export map, and the one TypeScript setting a CSS-module-consuming package
requires.

## One dependency

An adopter declares `@mattstack/tui-kit` and no `@soribashi/*` package at all.

```jsonc
// the adopter's package.json
"dependencies": {
  "@mattstack/tui-kit": "^0.1.1"
}
```

No `overrides` block is needed. An older adopter may still carry a two-line one
from the era when this kit consumed soribashi as `file:` packages with internal
`workspace:*` requirements; that block can be deleted. See
[development.md](development.md#history-the-file-era) for what it was for.

React 19 is a peer dependency (`react` and `react-dom`, `^19.0.0`).

## App entry wiring

```tsx
import { registerTheme, SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
import "@mattstack/tui-kit/theme.css";
import "@mattstack/tui-kit/canvas.css";   // optional, see below

registerTheme(tuiTheme);                   // module scope, before render

createRoot(el).render(
  <SoribashiProvider theme={tuiTheme}>
    <App />
  </SoribashiProvider>,
);
```

Both halves are mandatory and neither substitutes for the other.
`registerTheme()` is what the components read to resolve tokens, vocabulary and
intent; `<SoribashiProvider>` is what `useTheme()` reads inside the tree.
`workshop/src/main.tsx` is the live example.

### Import the wiring from the kit, never from `@soribashi/core`

Adding `@soribashi/core` to an adopter's own `package.json` and importing
`registerTheme` / `SoribashiProvider` from it produces wiring that installs,
type-checks, boots, and is silently wrong.

Bundlers key module identity by resolved path. An adopter's own
`@soribashi/core` resolves through the adopter's `node_modules`; a file inside
this kit has its leaf symlink realpathed to the kit's own checkout first, so
the same specifier resolves from `tui-kit/node_modules/`. Same package, same
published version, byte-identical files, but two paths, so two module records
in the bundle: two `SoribashiContext` objects, two vocabulary registries, two
`createTheme` implementations. `registerTheme()` writes one registry while the
recipes read the other, so a component's `useTheme()` finds no Provider above
it and falls back to the default theme. No error, no warning, just wrong
colours. Measured on the mr-board bundle before `@mattstack/tui-kit/provider`
existed: 2x `provider/context.ts`, 2x `vocabulary-registry.ts`, 2x
`create-theme.ts` in one bundle.

Importing through the kit collapses that to one identity by construction: these
symbols travel the same resolved path as `tuiTheme` and every component. If you
ever suspect a double instance, group your bundle's emitted module-path
comments by package root. Do not trust `node_modules` inspection or
`Bun.resolveSync`, neither of which reflects what the bundler actually does.

Publishing the framework to the registry did not retire this hazard. See
[decisions.md](decisions.md#why-srcproviderts-exists) for the same mechanism
recorded next to the file that fixes it.

## Export map

| subpath | resolves to | when to use it directly |
| --- | --- | --- |
| `@mattstack/tui-kit` | `src/index.ts` | components, hooks and `tuiTheme`, the common case |
| `@mattstack/tui-kit/hooks` | `src/hooks/index.ts` | only the hooks, no component module graph |
| `@mattstack/tui-kit/theme` | `src/theme.ts` | only `tuiTheme`, for example feeding a `createTheme({ extends })` call |
| `@mattstack/tui-kit/provider` | `src/provider.ts` | `registerTheme` + `SoribashiProvider` for an app entry, without the component module graph |
| `@mattstack/tui-kit/theme.css` | `src/generated/theme.css` | the generated CSS custom properties, imported once at an app entry |
| `@mattstack/tui-kit/canvas.css` | `src/canvas.css` | opt-in page canvas reset, see below |
| `@mattstack/tui-kit/types/css-modules.d.ts` | `types/css-modules.d.ts` | the ambient CSS-module declaration, see below |

The barrel re-exports `registerTheme` and `SoribashiProvider` too, for an app
already importing components from it. The `/provider` subpath exists because an
app entry usually wants only the wiring, and the barrel drags every component's
module graph, and every `.module.css`, along with it.

## The `types/css-modules.d.ts` include

Every component imports its own `.module.css` (`import styles from
"./Chip.module.css"`), which `tsc` can only type-check if some `.d.ts` in the
program declares what a `*.module.css` import resolves to. The kit ships that
declaration at the `./types/css-modules.d.ts` export precisely so an adopter
never has to author it for source it does not own. Because it is an ambient
module declaration rather than a value or type any file imports, it has to be
pulled in via `include`, not `import`:

```jsonc
// the adopter's tsconfig.json
"include": [
  "./**/*",
  "../../node_modules/@mattstack/tui-kit/types/css-modules.d.ts"
]
```

Skip it and the first `tsc` run through the kit's source fails with `Cannot
find module './Chip.module.css' or its corresponding type declarations`. That
is not a bug in the adopter's own code, just a program that was never told what
a `.module.css` specifier means. The relative path depends on where the
adopter's tsconfig actually sits; the example uses `../../` because mr-board's
client tsconfig is two directories below its `node_modules`.

## `canvas.css` is optional

`@mattstack/tui-kit/canvas.css` is the page-level ground: a `* { box-sizing:
border-box; }` reset, `body`'s base type, background and graph-paper grid, and
the `.tui` / `.tui-wide` column-measure containers.

No component requires it. Every component's own stylesheet is self-contained
(`@layer soribashi.recipes`, fully token-backed); `canvas.css` styles `body`
directly plus a handful of layout containers, which is app-shell territory
rather than component territory. Import it from an app entry point when you
want the whole page background and type scale. Never `@import` it from a
raw-served stylesheet: it is a bundler-bound asset. An app building its own page
shell around the components never needs it.

## Adopting into an existing stylesheet

An app replacing its own CSS with these components has a handful of rules that
must be rewritten rather than deleted, because they are ancestor-scoped and no
component can key off an ancestor it does not own. Those are listed under
[adoption rules that survive](decisions.md#adoption-rules-that-survive-in-mr-boards-stylesheet).
The one call site where the `unstyled` prop is the choice that preserves parity
is recorded under
[Markdown at a call site that was never `.tui-md`](decisions.md#markdown-at-a-call-site-that-was-never-tui-md).

Cross-boundary styling goes through the `data-part` attributes, not through
hashed CSS-module class names. See [css-contract.md](css-contract.md).
