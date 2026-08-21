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
