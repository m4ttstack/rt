# @mattstack/tui-kit dev loop (mr-board adoption)

mr-board consumes the kit from the **npm registry**:
`"@mattstack/tui-kit": "^0.1.0"`. The package is published **private** under
the `mattstack` org, so installing it needs an npm token with read access to
that org (see Auth below). deck consumes it the same way.

It used to be a `file:../tui-kit` sibling checkout. That broke CI: the
app-bundle pipeline clones one repo, so a path outside it can never resolve.
The live-edit loop that spec bought is still available on demand, via
`bun link`, which is the section below.

## Auth

A read token must be present before `bun install` can resolve the kit, in
`~/.npmrc`:

```
//registry.npmjs.org/:_authToken=<npm token with read on the mattstack org>
```

Without it the install fails with a bare `404` for
`@mattstack%2ftui-kit`, which reads like a missing package rather than a
missing credential. A token that can *publish* is not automatically able to
*read*: a granular npm token grants read and write separately, and a
write-only token 404s on install exactly like no token at all.

CI needs the same token as a secret plus an `.npmrc` step; a job that only
carries a GitHub token cannot install this package.

## Live editing the kit: `bun link`

The registry dep pins a published version, so a kit edit does not reach a
consumer until it is published and bumped. To get the old immediate-feedback
loop back for a working session:

```
cd ~/Documents/GitHub/tui-kit && bun link          # register the checkout once
cd ~/Documents/GitHub/board  && bun link @mattstack/tui-kit
```

That replaces `node_modules/@mattstack/tui-kit` with a link to the checkout,
so edits to existing files are picked up with no reinstall. Undo it with a
plain reinstall, which restores the published version:

```
bun install --force
```

Two things to know before relying on it:

- **A link is local and invisible to everyone else.** Nothing in
  `package.json` or `bun.lock` records it, so a build that works only while
  linked will fail in CI and for anyone who has not linked. Verify against
  the published version before you push.
- **Linking serves the kit's `src/`, publishing serves its `dist/`.** They
  are different inputs to the bundler, so a linked build and a published
  build are not byte-identical. The published package exposes only what its
  `exports` map declares (`.`, `/hooks`, `/theme`, `/provider`,
  `/theme.css`, `/canvas.css`, `/types/css-modules.d.ts`); an import that
  resolves while linked can fail once published if it is not in that map.

## Publishing a kit change

```
cd ~/Documents/GitHub/tui-kit
# bump version in package.json
npm publish --access restricted     # prepack runs the build
```

Then bump the range in each consumer and `bun install`. `--access
restricted` keeps it private; the org must be on a paid plan for that to
succeed, otherwise npm answers `402 Payment Required`.

## Transitive @soribashi resolution (adoption note, extends SORI-4) — SUPERSEDED, historical

**This section describes the file:-era topology and no longer matches the
tree.** Since the registry migration, the kit's `package.json` depends on a
single `@soribashi/core: "^0.1.0"` from the npm registry — no `file:` specs,
no `codegen`/`factory`/`theme` siblings. `@soribashi/core` now materializes
as an ordinary hoisted package directly under mr-board's own
`node_modules/@soribashi/core` (not a symlink into a sibling checkout, not
empty) the same as any other registry dependency, so the "hidden runtime
dependency on the kit checkout" problem this section describes does not
apply to `@soribashi/*` resolution anymore. Kept for the diagnostic technique
and as the reason the two-line `overrides` block existed at all (see the end
of this section) — both are now dead. `docs/tui-kit-adoption-notes.md` has
the current-state summary.

The kit's own `package.json` used to depend on
`@soribashi/core|codegen|factory|theme` via `file:../soribashi/packages/*`
(relative to the kit's own location). `bun install` in mr-board did **not**
physically materialize those packages anywhere in mr-board's `node_modules`
— not at the worktree root, not nested under
`node_modules/@mattstack/tui-kit/node_modules/@soribashi` (that directory
existed but was empty after install).

Resolution still succeeds, but only because of the symlink behavior above:
when bun/tsc resolve a bare `@soribashi/*` import from
`node_modules/@mattstack/tui-kit/src/theme.ts`, they follow that file's
symlink to its real path (`~/Documents/GitHub/tui-kit/src/theme.ts`) *before*
walking up `node_modules` — landing on `~/Documents/GitHub/tui-kit/node_modules/@soribashi`,
which is already populated because the kit checkout has been `bun install`ed
in its own right.

**This means the kit checkout is a hidden runtime dependency for any
adopter, even though the adopter's own lockfile lists `@soribashi/*` as
resolved.** If `~/Documents/GitHub/tui-kit/node_modules` were ever deleted or
fell out of sync (no `bun install` run there), mr-board's `bun install
--force` would **not** repair it — mr-board's own install doesn't own that
resolution, it just piggybacks on the kit's. An adopter-of-an-adopter (a repo
that only vendors/depends on mr-board, not on tui-kit or soribashi directly)
would need the same fact carried one hop further: keeping tui-kit itself
`bun install`ed is a precondition for the whole chain, not just for
tui-kit's own dev loop.

We did not need to mirror the kit's `soribashi` `file:` deps + `overrides`
into mr-board's own `package.json` — the brief's anticipated fallback for
when `@soribashi/*` "fail to resolve through the transitive file: chain."
Empirically they resolved (see above), so that fallback was not exercised
here. It remains a live risk if the symlink/piggyback resolution above ever
breaks (e.g. a linker-mode change, or a bun install run with
`--linker=isolated` producing a differently-shaped tree).

### The flattening fallback: tried, and now SUPERSEDED (R17) — archaeology only

Task 17 did exercise that fallback, and it was the wrong answer. Kept here
only so nobody re-derives it from first principles and reintroduces it.

Wiring the provider needed `SoribashiProvider` / `registerTheme`, which at the
time were reachable only from `@soribashi/core`, which does not resolve from
mr-board's own source (the piggyback above works from *kit* files, not from
the adopter's). So mr-board took three direct `file:` deps —
`@soribashi/core`, `/factory`, `/theme` — all three at top level, because with
only `core` declared, `factory` could not find `theme`.

That flattening *worked* in the sense that everything installed, type-checked
and booted. It was still wrong: it put mr-board's own imports on a different
resolved path than the kit's, and **bundlers key module identity by resolved
path**, so the bundle carried two copies of `@soribashi/factory` — two
`SoribashiContext` objects, two vocabulary registries. Silent wrong-theme
territory. The measurement is below under "It costs an @soribashi/factory
DOUBLE INSTANCE", kept as the worked example of how to diagnose this class of
bug.

**The fix, and the shape to copy now:** tui-kit re-exports both symbols
(`@mattstack/tui-kit/provider`, also on the barrel — tui-kit `908348a`), so
they travel the same resolved path as `tuiTheme` and every recipe. All three
`@soribashi/*` dependencies are gone from mr-board's `package.json`.
Re-verified after the change: exactly 1x `provider/context.ts`, 1x
`vocabulary-registry.ts`, 1x `create-theme.ts` in the bundle, in the shipped
`main.tsx` shape *and* in the Task 18 shape that adds a kit recipe.

**The two-line `overrides` block stayed at the time, for an unrelated reason
— now dead too.** Bun applies `overrides` only from the ROOT package, so the
kit's own overrides did not reach mr-board's install; installing
`@mattstack/tui-kit` made bun walk into the kit's `package.json` and resolve
its `@soribashi/*` `file:` deps, whose own `workspace:*` requirements then
had nothing to resolve against. Removing the block used to fail the install
outright:

```
error: @soribashi/factory@workspace:* failed to resolve
error: @soribashi/theme@workspace:* failed to resolve
```

That was the failure mode the block existed to prevent. It went away the
moment soribashi published to the registry (the `@soribashi/core` dependency
above): registry `core` declares ordinary semver deps, not `workspace:*`
ones, so nothing in the graph requests `@soribashi/theme` or
`@soribashi/factory` anymore, and the `overrides` block became fully inert —
bun ignores an override nothing requests. The merge-time cleanup removed the
block from mr-board's `package.json` entirely; a clean install
(`rm -rf node_modules bun.lock && bun install`) with it gone produced an
identical lockfile apart from the two now-pointless override lines.

## css-modules.d.ts

`src/client/tsconfig.json`'s `include` was extended with:

```
"../../node_modules/@mattstack/tui-kit/types/css-modules.d.ts"
```

This resolved cleanly — `bunx tsc --noEmit -p src/client` stayed clean both
with a soribashi-free `@mattstack/tui-kit/hooks` import and with a full
barrel import that pulls in a `.module.css`-importing recipe
(`CopyButton`). The brief's fallback (copying the 4-line `.d.ts` into
`src/client/`) was not needed.

## TS2578 from @soribashi/factory — RESOLVED in Task 17

Any import that pulls `@soribashi/factory` into the client program — the
full barrel (`import { CopyButton } from "@mattstack/tui-kit"`), or
`@soribashi/core` for the provider wiring — used to fail `tsc --noEmit -p
src/client` with two errors *inside node_modules*:

```
node_modules/…/@soribashi/factory/src/style-props/theme-resolvers/is-dev.ts(10,5): error TS2578: Unused '@ts-expect-error' directive.
node_modules/…/@soribashi/factory/src/validate-vocabulary-props.ts(18,5): error TS2578: Unused '@ts-expect-error' directive.
```

**Cause.** factory ships types as source (`"types": "./src/index.ts"`), so
its `@ts-expect-error` suppressions are re-checked under whichever
*consumer's* tsconfig pulls them in. Both sit on `const viteEnv =
import.meta?.env;`. `bun-types` declares `readonly env: Bun.Env &
NodeJS.ProcessEnv & ImportMetaEnv` on `ImportMeta`; `@types/node` does not.
So under `"types": ["bun"]` the guarded line has no error and the directive
reads as unused.

**The fix this doc previously suggested does not work.** Adding `"node"`
*alongside* `"bun"` changes nothing: the two ambient declaration sets merge
and bun's `env` survives, so the directive stays unused. Nothing else on the
consumer side suppresses TS2578 either — `skipLibCheck` only covers `.d.ts`,
and factory's `"types"` points at real `.ts`, so the source is genuinely
type-checked.

**What actually works** (shipped in Task 17):

1. `src/client/tsconfig.json` uses `"types": ["node"]` — *replacing* `"bun"`,
   not adding to it. This is the same setting tui-kit's own tsconfig checks
   factory under, so the suppressions are needed and therefore used.
2. That leaves exactly two errors, `import.meta.dir` in `src/config.ts` and
   `src/triage/memory.ts` (reached through type-only imports from client
   code). `src/client/bun-import-meta.d.ts` declares just that one member:

   ```ts
   interface ImportMeta {
     /** Bun: absolute path to the directory containing this module. */
     readonly dir: string;
   }
   ```
3. The **root/server** project keeps `"types": ["bun"]`. It never imports the
   kit, and it is the project that owns the real Bun API surface — so those
   server files are still fully checked against Bun's types by `tsc --noEmit
   -p .`. Nothing is unchecked; the two projects just disagree about the
   ambient environment for the handful of files both include.

Both projects are clean. The wart in (3) disappears the moment factory stops
depending on the consumer's ambient types — the upstream fix is a cast that is
correct under any tsconfig:

```ts
const viteEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } })?.env;
```

**Post-registry-migration note.** `@soribashi/factory` is no longer in the
dependency graph at all — not in mr-board's `node_modules`, not in the kit's
own (`find … -iname '*factory*'` under both trees comes up empty after the
registry migration). The `"types": ["node"]` split and the
`bun-import-meta.d.ts` shim above are therefore live code addressing a bug
class that can no longer trigger from `@soribashi/factory` specifically. Left
as-is here since reverting them is a code change, not a doc correction, and
outside this cleanup's scope — flagging in case a future pass wants to
re-evaluate whether the split is still earning its keep.

## The provider import: FIXED (R17) — and how the double instance was found

**Current, correct shape.** Import the wiring from the kit:

```tsx
import { registerTheme, SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
```

mr-board declares **no** `@soribashi/*` dependency and, since the registry
migration, no `overrides` block either — see the "SUPERSEDED, historical"
section above for why that block existed at the time and why it later became
dead weight. tui-kit `908348a` added the `/provider` subpath and the matching
barrel exports.

The rest of this section is the bug that forced that fix, kept because it is
the worked example for diagnosing *any* duplicate-module suspicion in this
stack.

**How it started.** `@soribashi/core` resolves only from files *inside* the
kit (the piggyback described above), never from an adopter's own source:

```
$ bun build src/client/probe.tsx --target=browser
error: Could not resolve: "@soribashi/core". Maybe you need to "bun install"?
```

So mr-board took direct `file:` deps on **three** soribashi packages. All
three had to be top-level: with only `core`, bun builds a factory store entry
whose nested `@soribashi/` has no `theme` sibling, and the bundle dies with
`Could not resolve: "@soribashi/theme"`.

### It cost an @soribashi/factory DOUBLE INSTANCE — measured (now fixed)

That direct dependency did not merely risk a second instance, it produced one.
**mr-board's client bundle contained two physical copies of
`@soribashi/factory` and two of `@soribashi/theme`.** Reproduce this class of
bug by bundling and grouping the emitted module-path comments by package root:

```
A. import from "@soribashi/core" only          →  factory: ../soribashi/packages/factory
B. import a kit recipe only                    →  factory: ../tui-kit/node_modules/.bun/@soribashi+factory@…
C. both (the Task 18-20 shape)                 →  factory: BOTH of the above
D. the shipped main.tsx shape                  →  factory: BOTH of the above
```

and the consequence is visible in the bundle itself:

```
provider/context.ts     : 2 copies   (<CANONICAL>/factory, <KIT-STORE>/@soribashi/factory)
vocabulary-registry.ts  : 2 copies
provider/provider.tsx   : 2 copies
theme/src/create-theme.ts: 2 copies
```

**Why the two do not collapse into one.** The two trees are hardlinked —
same inode, byte-identical (`stat -f %i` matches, `cmp` is silent) — but they
sit at *different paths*, and the bundler keys module identity by resolved
path, not by inode. So each becomes its own module record with its own
`createContext(...)` call.

**Why each side lands where it does:**

- From mr-board's own source, `@soribashi/core` resolves to the hoisted
  `node_modules/@soribashi/core`, whose leaves symlink out to the canonical
  `~/Documents/GitHub/soribashi/packages/core`. Resolution continues from
  *there*, so `@soribashi/factory` comes from the canonical soribashi
  checkout's own workspace links.
- From a kit file, the leaf symlink resolves to
  `~/Documents/GitHub/tui-kit/src/…` **first**, and `@soribashi/*` is then
  resolved from the canonical kit checkout — landing in
  `~/Documents/GitHub/tui-kit/node_modules/.bun/…`. That is the piggyback the
  "Transitive @soribashi resolution" section describes, and it still holds.

Note this is *not* the "empty nested stubs fall through to the hoisted
top-level" story. The nested
`node_modules/@mattstack/tui-kit/node_modules/@soribashi/{core,factory}`
directories really are empty skeletons (`find … -type f -o -type l` → 0), and
`Bun.resolveSync("@soribashi/factory", "<mr-board>/node_modules/@mattstack/tui-kit/src/recipes/Chip")`
does fall through to the hoisted copy — but the **bundler does not take that
path**, because it realpaths the kit's leaf symlink before resolving. Probe B
above is the proof: a kit-only bundle contains only the tui-kit store copy and
never mr-board's hoisted `node_modules/@soribashi/*`. Trust the bundle, not
`resolveSync`, when diagnosing this.

**What it broke.** `tuiTheme` is built by the KIT-STORE copy of `createTheme`,
while `registerTheme()` and `<SoribashiProvider>` imported from
`@soribashi/core` were the CANONICAL copy. So the vocabulary registry written
and the React context provided both belonged to the canonical instance, and a
kit recipe's `useTheme()` read the *kit-store* context — found no Provider
above it — and silently fell back to the DEFAULT theme, emitting token refs
the real theme never defines. It never surfaced in Task 17's pixel gate
because the board rendered no kit recipe; the first adopted recipe is where it
would have bitten.

**The fix, applied (R17): import the two symbols from the kit.** tui-kit
`908348a` re-exports them from `@mattstack/tui-kit/provider` (and from the
barrel), so they resolve along the same path as `tuiTheme` and every recipe.
Single identity by construction rather than by lockfile luck, and mr-board's
three `@soribashi/*` `file:` deps are gone.

Re-measured after the fix, with the same probe:

```
SHIPPED main.tsx shape                provider/context.ts     : 1 ✓
                                      vocabulary-registry.ts  : 1 ✓
                                      create-theme.ts         : 1 ✓
shipped shape + a kit recipe (T18)    all three               : 1 ✓
the REAL src/client/main.tsx          all three               : 1 ✓
```

All resolving inside
`../tui-kit/node_modules/.bun/@soribashi+{factory,theme}@…`.

**The lesson worth keeping.** Three times on this surface, an inspection of
`node_modules` (symlink targets, store-entry names, `Bun.resolveSync`) gave a
confident answer that the bundle then contradicted. For linker questions, use
`readlink -f` on several leaves. For module-identity questions, group the
emitted bundle's module-path comments by package root. Nothing else settles
either.

## Linker mode: confirmed symlinked (Task 17)

The "Linker mode: symlinked, not copied" section above is **correct** and
still describes the tree. Re-verified after `bun install --force`:

```
$ readlink -f node_modules/@mattstack/tui-kit/src/theme.ts
/Users/matt/Documents/GitHub/tui-kit/src/theme.ts
$ readlink -f node_modules/@mattstack/tui-kit/src/canvas.css
/Users/matt/Documents/GitHub/tui-kit/src/canvas.css
$ readlink -f node_modules/@mattstack/tui-kit/src/generated/theme.css
/Users/matt/Documents/GitHub/tui-kit/src/generated/theme.css
$ readlink -f node_modules/@mattstack/tui-kit/package.json
/Users/matt/Documents/GitHub/tui-kit/package.json
```

Every leaf is an `lrwxrwxrwx` symlink to the canonical checkout, so **editing
an existing file in the kit is still picked up immediately**, exactly as
documented above, and the transitive-`@soribashi` topology in that section is
still accurate. A transient mid-task observation of hardlink copies in
mr-board's own store did not survive the next argument-less
`bun install --force`; treat the symlink description as the truth and
`readlink -f` on a few leaves as the way to check.

## Bun's `light-dark()` polyfill: only `:root` / `.dark` flip it

Bun's CSS pipeline rewrites the kit's `light-dark(a, b)` token values into
`var(--buncss-light,a) var(--buncss-dark,b)`, and emits the toggles onto
`:root` and `.dark` only. Setting `color-scheme` on any *other* element
therefore does nothing to these tokens — the standard `light-dark()` behaviour
of resolving against the nearest element's own `color-scheme` is lost in the
bundled output. A scoped/nested dark region will not work by setting
`color-scheme: dark` on a wrapper; it needs the `dark` class, or the
`--buncss-light` / `--buncss-dark` pair set by hand. Worth knowing before
Tasks 18-20 reach for a locally-inverted surface.

## The React singleton: an adopter-side bundler pin (Task 18)

The `@soribashi/factory` double instance above has a sibling, and Task 18 is
where it bites: **React itself**. Same root cause, different package.

A kit file's leaf symlink is realpathed to `~/Documents/GitHub/tui-kit/src/…`
*before* its own imports resolve, so a recipe's bare `react` specifier resolves
from `~/Documents/GitHub/tui-kit/node_modules/.bun/react@19.2.8/…` while
mr-board's own resolves from `node_modules/react`. Two paths, two module
records, two dispatchers. The first kit recipe the board rendered (`<Icon>`)
threw immediately:

```
Invalid hook call. … You might have more than one copy of React in the same app
TypeError: Cannot read properties of null (reading 'useContext')
    at Icon (…/app.js)
```

**The kit is not at fault and cannot fix this.** Its `package.json` already
declares `react`/`react-dom` as `peerDependencies` (with devDependency copies
for its own workshop and test tiers), which is the correct authoring. A peer
declaration is a statement about the *installed* graph; it has no say over what
a bundler resolves after realpathing a symlink. Bumping mr-board's react to the
kit's exact version would not help either — the two copies would still sit at
two paths, and identity is keyed by path.

**The fix is one adopter-side `onResolve` plugin**, in `src/server.ts`'s
`Bun.build`:

```ts
const reactSingleton: BunPlugin = {
  name: "react-singleton",
  setup(builder) {
    builder.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, import.meta.dir),
    }));
  },
};
```

`Bun.resolveSync` from `src/` always lands in mr-board's own `node_modules`, so
every react/react-dom specifier in the graph — ours and the kit's alike —
collapses onto one copy. `Bun.build` has no `alias` option in Bun 1.3.13; a
plugin is the only lever.

**This invalidates the "group the bundle's module-path comments" technique
above for React specifically, unless you reproduce the plugin.** A bare
`bun build src/client/main.tsx --outdir …` from the CLI applies no plugins, so
it still shows two react roots and always will. That output is not what the
server serves. To check module identity from now on, either bundle through the
server's own build config or add the same plugin to your probe. Everything the
technique says about `@soribashi/*` is unchanged: those still collapse by
construction, via the kit's own re-exports.

## `@mattstack/tui-kit/hooks` needs `lib: DOM` on whatever project imports it

The kit's `/hooks` subpath ships the pure functions (`pushLayer`,
`handleEscape`, `acquireScrollLock`, `releaseScrollLock`) in the SAME module as
the React hooks that touch `document` and `HTMLElement`, and the kit ships types
as source — so the whole module is re-checked under whichever consumer project
pulls it in, exactly like `@soribashi/factory`'s `@ts-expect-error` pair. When
`src/__tests__/escape-stack.test.ts` and `scroll-lock.test.ts` retargeted onto
the kit, the ROOT project (`tsc --noEmit -p .`, `lib: ["ESNext"]`, no DOM) grew
eleven errors *inside the kit's source* — `Cannot find name 'document'`,
`Property 'style' does not exist on type 'HTMLTextAreaElement'`, and so on.
`skipLibCheck` does not help; it only covers `.d.ts`.

**The resolution is a THIRD tsconfig program, not a widened root.** Widening
the root to `lib: ["ESNext", "DOM", "DOM.Iterable"]` was the first attempt and
it was the wrong trade — it hands the server program a DOM it does not have.
Neither existing program can host these tests on its own:

| program | `types` | DOM lib | why it can't take them |
| --- | --- | --- | --- |
| root (`-p .`) | `["bun"]` | no | the kit's hooks module needs `document`/HTMLElement |
| client (`-p src/client`) | `["node"]` | yes | `bun:test` does not resolve; adding `"bun"` re-raises the two factory TS2578 errors above (verified, not assumed) |

So the two tests live at `src/client/__tests__/` with their own
`tsconfig.json` declaring BOTH `types: ["bun"]` and the DOM lib, and
`src/client/tsconfig.json` excludes that directory. `bun run typecheck` is now
three `tsc` invocations. Both at once is only safe there because
`@mattstack/tui-kit/hooks` imports nothing but React — it never reaches
`@soribashi/factory`, so there is no TS2578 to raise. **A test that imported a
RECIPE would not belong in that program**, and would have to solve the factory
problem some other way.

The upstream fix would be for the kit to expose its DOM-free half on its own
subpath — the README already advertises the hooks as "DOM-free at their core",
which is true of the functions and not of the module they ship in.
