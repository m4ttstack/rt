# AGENTS.md

Contract for anyone (human or agent) working in this repo.

## Read first

1. `ARCHITECTURE.md`: how a message gets from `rt chat post` to the screen,
   the `/api` and `/ws` surface, the `/r/<room>#m-<id>` link contract with
   rt, what a message body renders, how to run it with real or fixture data
   (`CHAT_FIXTURES=1`), and the deploy loop (`bun install && bun run build &&
deck restart chat`, port 11002).
2. The rest of this file: what's app-specific about chat's use of
   `@mattstack/app-kit` + `@mattstack/app-server` (icon registration). The
   kit contract itself lives in the repo root `AGENTS.md` (see below).

The other half lives in `~/Documents/GitHub/repo-tools`: `skills/rt-chat/SKILL.md`
(the agent-facing rules), `docs/superpowers/specs/2026-08-2{3,4}-rt-chat-*.md`
(schema and wake protocol), `packages/rt-client/README.md` (the client this
app calls).

chat is a thin consumer of `@mattstack/app-kit` (the Mantine-based UI kit,
shell, boot, icons, router glue) and `@mattstack/app-server` (the Hono/Bun
server frame). The kit contract itself, covering the import walls, icon
registry, theme override patterns, facade recipes
(modals/notifications/forms), the `MattstackShell`/`mountMattstackApp`
mattstack layer, and the server package's routes/relay/static contract,
lives at this repo's root:

**`AGENTS.md` (repo root)**

Read that first for anything touching `@mattstack/app-kit/*` or
`@mattstack/app-server`. What follows here is only what's specific to how
chat consumes it.

## UI colour and type

Colour and type follow the repo-wide authoring guide: `docs/ui-authoring.md`
at the repo root. Read it before writing any colour, contrast, or font
decision; tokens are picked by role there, and raw values fail lint and the
contrast gates.

Chat-specific: the app has ONE type ladder (xs 12 / sm 13 / md 14 / lg 16 /
xl 20), defined in `src/app/chat-font-theme.ts` and merged at the ROOT
Mantine provider so portalled content resolves the same sizes. Never size
text with a raw px or a Mantine size the ladder does not define.
`design/spec.json` predates the Radix migration: its font sizes are historic
reference, its colours are stale -- do not conform new work to its colour
values.

## Product code lives in `src/app`, not a vendored kit

There is no `src/ui/` in this repo and no `@ui/*` alias. Every Mantine-shaped
import goes straight through `@mattstack/app-kit`'s package subpaths
(`@mattstack/app-kit/core`, `/hooks`, `/forms`, `/modals`, `/notifications`,
`/icons`, ...), enforced by the `mattstackEslint()` preset spread into
`eslint.config.js`. Product code (rooms, transcript, roster, composer) is
`src/app/**`; the server route handlers are `src/server/routes.ts` (composed
from `src/server/chat.ts`) served via `@mattstack/app-server`'s
`serveMattstackApp`. See `ARCHITECTURE.md` for the request path and API
surface.

## Icon registration

`src/app/icons.ts` is chat's one sanctioned place to import `lucide-react`
directly (`eslint-disable-line no-restricted-imports`), registering the
app-specific `hash` icon via `@mattstack/app-kit/icons`'s `registerIcons` +
`lucideWrapperFn`. `src/app/app-icons.d.ts` carries the matching
`declare module '@mattstack/app-kit/icons' { interface AppIcons { hash: true
} }` augmentation that widens `IconName`. It's named `app-icons.d.ts`, not
`icons.d.ts`, specifically so it doesn't share a basename with `icons.ts` in
the same directory, since TypeScript silently drops a `.d.ts` that does, and
the augmentation never loads. See app-kit's AGENTS.md §8 "The `AppIcons`
augmentation contract" for the full mechanism.

## Dependencies

`@mattstack/app-kit`, `@mattstack/app-server`, and `@mattstack/mantine-tokyo`
are workspace packages (`workspace:*` in `package.json`) since the fold-in;
there is no `vendor/` and no tarball step. Kit changes land in
`packages/{ui,server,tokyo}` in this same repo and are picked up directly.

## Mantine: look it up, don't recall it

This app pins **Mantine 9.5.2** (via `@mattstack/app-kit`'s peer range).
Before using a component or prop you're not already certain of, call the
`mantine` MCP server (configured in `.mcp.json`, pinned to the installed
version): `get_item_props`, `get_item_doc`, `search_docs`, `list_items`.
Without MCP there's `docs/mantine-llms.txt`, an index only: it names
components and links a page each, never a prop signature offline.

## Design conformance

`design/CONFORMANCE.md` and `design/ANATOMY.md` are the UI contract; the
artboards under `design/artboards` are the authority on layout and values,
and no UI task is done until `design/audit.mjs` passes against them.

## Right-click menus

Use `Menu.ContextMenu` (Mantine 9.5.2), never a `Menu.Target` with a
hand-rolled `onContextMenu`: `Menu.Target` composes a click handler, so a
left click would open the menu too. `Menu.ContextMenu` wraps the one
element that should answer a right-click (and a long press on touch),
positions the dropdown at the cursor, and suppresses the native menu
itself; the child must not call `preventDefault()` in its own
`onContextMenu`. Keep the `Menu` uncontrolled and read its state through
`onChange` when the UI needs to know it is open. One `Menu` per row, never
a shared portal. `src/app/FleetTree.tsx` is the reference.
