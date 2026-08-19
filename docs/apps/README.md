# @mattstack/tui-kit

The mattstack TUI look, packaged as a [soribashi](https://github.com/) component library.
Currently source-consumed by mr-board; no published releases yet.

## What this is

A theme + recipe library (`createTheme`, hooks, and hand-rolled compound components)
built on the unpublished `soribashi` framework, consumed from a sibling checkout via
verified `file:` + `overrides` wiring (not workspace protocol — soribashi is not a
member of this repo's workspace).

See `docs/superpowers/specs/2026-08-19-tui-kit-design.md` for the full design.

## Setup

Requires a sibling checkout at `../soribashi` (relative to this repo) that has
already been `bun install`ed.

```sh
bun run setup   # sh scripts/setup.sh — installs, twice (see script comment)
```

`workshop/` currently holds only a placeholder `package.json` (needed so `bun
install` can resolve the `workspaces: ["workshop"]` entry at all) — the real
Vite preview app lands in a later task.

### soribashi wiring shape

`dependencies` declares four soribashi packages directly, all as `file:`
pointers into the sibling `../soribashi` checkout:

```json
"@soribashi/core": "file:../soribashi/packages/core",
"@soribashi/codegen": "file:../soribashi/packages/codegen",
"@soribashi/theme": "file:../soribashi/packages/theme",
"@soribashi/factory": "file:../soribashi/packages/factory"
```

plus an `overrides` block redirecting `@soribashi/theme` and
`@soribashi/factory` to the same `file:` paths, so that `core`'s and
`codegen`'s own internal `"workspace:*"` requests for them resolve too.

Both halves are necessary: `overrides` alone does not reach a nested
`workspace:*` dependency one level inside an already-overridden `file:`
package (confirmed empirically — with only `core`/`codegen` as direct
dependencies, `@soribashi/factory`'s own `"@soribashi/theme": "workspace:*"`
never got linked, on Bun 1.3.13, no matter how many times `bun install` was
re-run). Declaring `theme`/`factory` directly puts them in root
`node_modules`, where `factory`'s runtime walk-up module resolution finds
them regardless of that unresolved nested link.

`clsx`, `tailwind-merge`, and `zod` are declared as top-level `dependencies`
too (ranges copied verbatim from `soribashi/packages/{factory,theme}/package.json`)
because overrides-delivered `file:` packages don't install their own deps.

## soribashi pin

This repo pins against soribashi at the commit recorded in `SORIBASHI_COMMIT`.
Bump it manually when picking up new soribashi changes; there is no automated sync.

## Status

Bootstrap only — no theme/recipes yet. See the plan and task briefs under
`docs/superpowers/specs/` and the `mr-board` SDD ledger for the build sequence.
