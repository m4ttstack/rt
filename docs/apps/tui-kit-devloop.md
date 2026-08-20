# @mattstack/tui-kit dev loop (mr-board adoption)

mr-board consumes the kit as `"@mattstack/tui-kit": "file:../tui-kit"` — a
sibling checkout at `~/Documents/GitHub/tui-kit`, resolved the same way
`@mattstack/rt-client` already is (`file:../repo-tools/packages/rt-client`).

## Linker mode: symlinked, not copied

`bun install` does **not** copy the kit's files into
`node_modules/@mattstack/tui-kit`. It mirrors the kit's *directory
structure* with real directories, then symlinks every leaf file back to the
canonical checkout:

```
$ ls -la node_modules/@mattstack/tui-kit
lrwxrwxrwx  package.json -> /Users/matt/Documents/GitHub/tui-kit/package.json
lrwxrwxrwx  tsconfig.json -> /Users/matt/Documents/GitHub/tui-kit/tsconfig.json
drwxr-xr-x  src/                    (real directory)
drwxr-xr-x  types/                  (real directory)
...

$ readlink -f node_modules/@mattstack/tui-kit/src/theme.ts
/Users/matt/Documents/GitHub/tui-kit/src/theme.ts
```

Every `.ts`/`.tsx` file we spot-checked (`src/index.ts`, `src/hooks/index.ts`,
`src/theme.ts`, `src/builders.ts`) resolved as an individual symlink to the
real file in `~/Documents/GitHub/tui-kit`, not an independent copy.

**Consequence:** editing an *existing* file's contents in the kit checkout is
picked up immediately by mr-board — no reinstall needed, because bun and
`tsc` both follow the symlink to the real file. What is **not** live is the
*file set itself*: the list of symlinks bun creates is a snapshot taken at
install time. A file added to (or removed from) the kit after that snapshot,
or a change to the kit's `package.json` (new export, new dependency), needs a
fresh install to regenerate the mirrored tree.

## Refresh rule

```
bun install --force
```

Argument-less. This forces a full reinstall (229 packages reinstalled vs. a
normal incremental `bun install`'s ~67) and regenerates the symlink tree
against the kit's current file set and manifest. Verified: ran it after
adding the dependency, full suite (`bun test`) and both `tsc --noEmit`
projects stayed green afterward.

**Never** run `bun install --force @mattstack/tui-kit` (or any other package
name after `--force`). That is bun's *add* form — it goes to npm for a
package by that name (which does not exist there, or exists as someone
else's unrelated package) instead of re-resolving the `file:` spec already in
`package.json`. Bare `bun install --force` is the only safe refresh.

## Transitive @soribashi resolution (adoption note, extends SORI-4)

The kit's own `package.json` depends on `@soribashi/core|codegen|factory|theme`
via `file:../soribashi/packages/*` (relative to the kit's own location).
`bun install` in mr-board does **not** physically materialize those packages
anywhere in mr-board's `node_modules` — not at the worktree root, not nested
under `node_modules/@mattstack/tui-kit/node_modules/@soribashi` (that
directory exists but is empty after install).

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

## Known friction beyond this task's scope (not filed — Linear is down)

Type-checking a **full barrel** import (`import { CopyButton } from
"@mattstack/tui-kit"`, as opposed to the `/hooks` subpath) under mr-board's
`src/client/tsconfig.json` produces two spurious `TS2578: Unused
'@ts-expect-error' directive` errors inside
`@soribashi/factory/src/style-props/theme-resolvers/is-dev.ts` and
`validate-vocabulary-props.ts`. Diagnosis: factory ships types as source
(`"types": "./src/index.ts"`), so its `@ts-expect-error` suppressions get
type-checked under whichever *consumer's* tsconfig pulls them in. Under
mr-board's `src/client/tsconfig.json` (`"types": ["bun"]`, no `"node"`),
`import.meta?.env` apparently type-checks without error, making factory's
`@ts-expect-error` on that line "unused" — whereas under the kit's own
tsconfig (`"types": ["node"]`) the suppression is needed. This did not block
Task 16 (the required smoke uses the soribashi-free `/hooks` subpath, which
stays clean), but it will need a decision — either mr-board's `src/client`
tsconfig gains `"node"` to `"types"`, or factory relaxes/genericizes that
`@ts-expect-error` — before any later task imports a full recipe from the
main barrel and runs `tsc --noEmit -p src/client` in CI.
