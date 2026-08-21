# Board dev loop notes

Detail behind the "Board dev loop" section of the README: the `file:`
kit dependency's refresh rules, and the react-singleton constraint on
the board's build.

## The `file:` kit dependency

`@mattstack/tui-kit` is declared as `"file:../tui-kit"` - a sibling
checkout, resolved the same way any other `file:` dependency is.

`bun install` does not copy the kit's files into
`node_modules/@mattstack/tui-kit`. It mirrors the kit's directory
structure with real directories, then symlinks every leaf file back to
the canonical checkout (`readlink -f node_modules/@mattstack/tui-kit/src/theme.ts`
resolves to `~/Documents/GitHub/tui-kit/src/theme.ts`). Editing an
*existing* file's contents in the kit checkout is therefore picked up
immediately by this repo - no reinstall needed, because bun and `tsc`
both follow the symlink to the real file.

What is not live is the file *set*. The list of symlinks bun creates is
a snapshot taken at install time. Two different situations need two
different refreshes, and they are not interchangeable:

**Kit file contents changed, kit `package.json` unchanged** (edited an
existing file, added or removed a file):

```
bun install --force
```

Argument-less - this is bun's re-resolve form. Forcing `bun install
--force @mattstack/tui-kit` instead goes to npm for a package by that
name, which is not what a `file:` spec means; never do that.

**Kit `package.json` changed** (a dependency added, removed, or
bumped): `bun install --force` is not sufficient. For a locked `file:`
dependency, bun reuses the cached manifest it already recorded for that
package instead of re-reading the kit's `package.json` off disk, so a
manifest change silently does not propagate and `bun.lock` keeps the
kit's old dependency list. Only a genuinely clean install re-resolves
it:

```
rm -rf node_modules bun.lock && bun install
```

Reach for that whenever the kit's own `dependencies` /
`devDependencies` / `peerDependencies` change, not just `--force`.

## The react singleton

A kit file's leaf symlink is realpathed to the canonical
`~/Documents/GitHub/tui-kit/...` checkout before its own imports
resolve. That means a kit recipe's bare `react` specifier resolves from
the kit checkout's own `node_modules`, while this repo's own code
resolves `react` from its own `node_modules` - two different paths, two
module records, two React dispatchers. A component rendering both a kit
recipe and this repo's own React tree would throw "Invalid hook call...
You might have more than one copy of React" the moment a kit recipe
tried to call a hook.

The fix lives in `scripts/build-board.ts`: a `Bun.build` `onResolve`
plugin (`reactSingleton`) pins every `react`/`react-dom` specifier,
kit's and ours alike, back to this repo's own `node_modules` via
`Bun.resolveSync`. If the board bundle ever throws that error after
touching the build config, check that plugin is still wired into the
`Bun.build` call first.

## Testing the drawer era

The table + per-row drawer (roots, dev port, access, logs, edit,
remove) is covered by two independent suites: DOM specs assert
behavior, pixel captures assert appearance. Both drive the real
`src/main.ts serve` server in fixture mode, never a mock.

**DOM specs** — `bun run test:dom` runs the Playwright-driven specs
under `test/dom/` (`board`, `drawer`, `modals`, `port`, `access`,
`logs`, `proxy`, `shell`). `test/dom/rig.ts`'s `withBoard(fn, opts)`
spawns the server with `DECK_FIXTURE` pointed at a temp dir seeded from
`test/fixture/status.json`; pass `opts.fixture` (e.g.
`"status-stale.json"`) to copy a different fixture file in as
`status.json` instead. Each spec gets its own server + browser context
and a fresh `page` navigated to readiness (`[data-board-ready]`)
before the callback runs.

**Pixel captures** — `bun run capture:baseline` (writes
`test/baselines/`) and `bun run capture` (writes `test/.captures/`,
compared by `bun run capture:compare` at pixel threshold 0) both run
`test/capture.ts` against the same fixture-mode server, freezing the
page clock and disabling animations for determinism. The scenario list
covers: board default (day + night), empty, sections (scrolled to the
tunnel group), a stale-routes notice (ok + error, error also in dark),
the add-app modal (service mode + external mode), and the drawer set —
one root per row kind (healthy, broken, routeless service, tunnel,
mid-restart; root also in dark), dev port (override active + mid-edit),
access (root, password, who), logs (day + dark, the dark shot existing
specifically to catch the terminal box regressing to a scheme-dependent
token), edit, and the remove confirmation. Regenerated baselines always
get eyeballed against `docs/design/deck-redesign/board-composite.html`
and `drawer-states-atlas.html` before committing — the scenario list
exists to keep every screen in those references reachable by a named
capture, no more and no less.

**The drawer's own screen stack** — `RootScreen.tsx`'s `ScreenBuilder`
type builds a screen from the row/nav/board/data current as of the
render that calls it, so a mutation a pushed screen triggers is visible
immediately rather than a value frozen at push time. `Nav.push` takes
an optional `onLeave` callback that `AppDrawer.tsx` runs once when that
frame is removed — by `pop()`, `close()`, or a row switch — letting a
screen that stashes transient state (e.g. an in-flight form error)
clear it itself instead of leaving it to bleed into whatever renders
next.
