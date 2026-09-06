# Working on the kit

Setup, the framework dependency, the scripts, and the test tiers.

## Setup

```sh
bun install
```

That is the whole story. `@soribashi/core` is an ordinary registry dependency,
so there is no sibling checkout to clone, no install ordering to respect, and no
`overrides` block to keep in sync. (`bun run setup` is an alias for the same
command, kept so the script name in older docs still works.)

`workshop/` carries its own real `package.json`, a Vite React app, declared as
`workspaces: ["workshop"]` at the root.

## The framework dependency

`package.json` declares one soribashi package:

```json
"@soribashi/core": "^0.4.0"
```

`@soribashi/core` is the whole framework in a single package: the theme model,
the component factory, and the `soribashi` codegen CLI. It exposes two entry
points and ships the CLI as a bin.

| specifier | what it is | used here by |
| --- | --- | --- |
| `@soribashi/core` | theme model plus component factory (`makeBuilders`, `createTheme`, `registerTheme`, `SoribashiProvider`, the `IntentResolver` types) | every component, `src/theme.ts`, `src/builders.ts`, `src/provider.ts`, `src/intent-resolver.ts` |
| `@soribashi/core/codegen` | the codegen types (`CssVariablesResolver`) | `soribashi.config.ts` |
| `soribashi` (bin) | the CSS codegen CLI, run by `bun run codegen` | `package.json`'s `codegen` and `gates` scripts |

Because core brings its own `clsx`, `tailwind-merge` and `zod`, this repo does
not declare them, and nothing in `src/` imports any of the three directly.

`react-markdown` and `remark-gfm` are ordinary top-level dependencies, not part
of the soribashi wiring at all. They are the Markdown component's only two
non-soribashi runtime dependencies, pinned to the same versions mr-board's own
`src/client/ui/Markdown.tsx` used.

### Version policy

The `^0.4.0` range is the pin. Bumping soribashi means editing that range and
running `bun install`, with `bun.lock` recording the exact resolved version.
There is no separate commit-pin file to keep honest.

After any bump, run `bun run gates`. The codegen drift check re-runs the
published `soribashi build` against `soribashi.config.ts` and fails if
`src/generated/theme.css` would change, which is the cheapest possible detector
for a soribashi release moving the CSS out from under this kit.

One consequence of consuming a published package worth knowing: core's `.`
export resolves to compiled `dist/`, not TypeScript source. The factory's own
`@ts-expect-error` suppressions are therefore no longer re-checked under this
repo's tsconfig, so the `TS2578: Unused '@ts-expect-error' directive` errors
that once forced `types: ["node"]` can no longer occur from inside
`node_modules`. (The `types: ["node"]` setting stays for its own independent
reasons: `scripts/` and `test/` genuinely use node APIs.) The browser test tier
is what confirms the compiled factory behaves identically to the source one.

## Scripts

| script | what it does |
| --- | --- |
| `bun install` | install, and the whole setup |
| `bun run dev:workshop` | the live component workshop, see below |
| `bun run test` | both test tiers |
| `bun run gates` | the mechanical gates plus the codegen drift check |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run codegen` | regenerate `src/generated/theme.css` from `src/theme.ts` |
| `bun run census` | regenerate `docs/token-census.md` from the source stylesheet |
| `bun run build` | compile `dist/`, also run by `prepack` |

`bun run codegen` is `soribashi build` followed by
`scripts/append-font-faces.ts`. `soribashi build` fully overwrites the generated
CSS from `theme.ts`'s tokens alone and has no concept of font assets, so the
`@font-face` declaration for the vendored JetBrains Mono variable font is
appended by the second half. Keeping it inside one command is what lets
`bun run gates`'s `git diff --exit-code` on the generated file mean anything.

## Testing

Two tiers, both run by `bun run test`:

- **node**: pure logic. The theme and census suite, the mechanical CSS gates,
  and any `*.test.ts` colocated with a component or hook. No DOM, no browser,
  fast.
- **browser**: every `*.test.tsx` and `*.visual.test.tsx`, rendered in a real
  headless Chromium through Playwright. This is the tier that can observe
  `light-dark()` resolving, computed styles, and screenshots. jsdom cannot.

The two projects partition every test file between them: the browser tier takes
every `*.test.tsx` under `src/` and `test/`, the node tier takes every
`*.test.ts` under the same two roots. A file matched by no project is not an
error in vitest, it is simply never run and the summary reports nothing missing,
which is why the globs are deliberately exhaustive rather than scoped.

Either tier is runnable on its own for debugging:

```sh
bunx vitest --config vitest.browser.config.ts
bunx vitest --config vitest.node.config.ts
```

Visual baselines are committed per component under `__screenshots__/` and are
local-Mac captures, a declared divergence from soribashi's Linux-Docker baseline
rule, accepted because this stack runs on one machine.

## The workshop

`workshop/` is a small Vite + React app that renders every component live, in
both colour schemes, for manual and visual verification.

```sh
bun run dev:workshop
```

Then open the printed local URL. The sidebar's **Dark** button flips the `.dark`
class on `<html>`, which is the whole dark-mode mechanism (`light-dark()` plus
`color-scheme`, driven by `src/theme.ts`'s `darkMode: { selector: ".dark" }`), so
every page's colours follow it with no page-local toggle needed. `tokens` is the
landing page, a full token audit; every component gets its own page after it,
alphabetically.

`workshop/vite.config.ts` aliases `@mattstack/tui-kit` straight to the live
`../src` tree, never an installed copy, so every workshop page imports from the
barrel exactly the way a real consumer would. A deep `../../src/recipes/...`
import in a workshop page would quietly pass even if the barrel forgot the
export, which defeats the point of using the workshop as a surface check.

Vite's alias matching treats a string key as a prefix, so
`@mattstack/tui-kit/theme` resolves through the same entry without a second
alias. That only holds for subpaths mirroring `src/`'s own layout, so the two
generated CSS files are imported by plain relative path in `main.tsx` instead.

## History: the `file:` era

Before `@soribashi/core` was published, this repo consumed soribashi from a
sibling `../soribashi` checkout as four separate `file:` packages (`core`,
`codegen`, `theme`, `factory`) plus a two-line `overrides` block. None of that
is needed now. The mechanics are recorded because the bug behind them is worth
recognising if similar wiring ever reappears.

**`overrides` do not reach a nested `workspace:*`.** `core`'s and `codegen`'s own
dependencies on `theme` and `factory` were declared `"workspace:*"`, which means
nothing outside soribashi's own workspace. `overrides` alone did not fix them:
with only `core` and `codegen` as direct dependencies, `@soribashi/factory`'s own
`"@soribashi/theme": "workspace:*"` never got linked into factory's install
location, on Bun 1.3.13, no matter how many times `bun install` was re-run. The
workaround was to also declare `theme` and `factory` as direct dependencies,
putting them in root `node_modules` where factory's runtime walk-up resolution
found them regardless of the unresolved nested link. Two overlapping link paths
for the same package then produced a transient `EEXIST: failed to link package`
race on roughly one in three clean installs, which is why the old
`scripts/setup.sh` ran `bun install` twice and trusted only the second exit
status. A registry package declares ordinary semver dependencies, so none of
this arises: the current clean install is a single `bun install` with no
overrides and no race.

The other `file:`-era hazard, two module identities in one bundle, is **not**
retired by publishing. See
[consuming.md](consuming.md#import-the-wiring-from-the-kit-never-from-soribashicore).

A third one is retired: soribashi's factory used to ship its types as
TypeScript source, so its `@ts-expect-error` suppressions were re-checked under
the consumer's tsconfig, and any consumer declaring `import.meta.env` (any
`types: ["bun"]` project) saw two `TS2578: Unused '@ts-expect-error' directive`
errors from inside `node_modules`. `@soribashi/core` ships compiled `.d.ts`
files, so that error class is gone.
