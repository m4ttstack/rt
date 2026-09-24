# AGENTS.md -- apps/deck

UI colour and type in this app follow the repo-wide authoring guide:
`docs/ui-authoring.md` at the repo root. Read it before writing any
colour, contrast, or font decision; tokens are picked by role there,
and raw values fail lint and the contrast gates.

Deck is a local-app supervisor for macOS: it runs your web apps as launchd
services, routes them at `<name>.localhost` / `<name>.mattstack` via portless,
and (optionally) serves them publicly through a Cloudflare tunnel it owns. A
per-host gateway on `:7950` does access control (publish flag, password, Google
sign-in). State is plain JSON under `~/.mattstack/deck`.

## Run only from main

Deck runs from `~/.local/bin/deck`, compiled from **main**. Never deploy from a
feature branch: merge to `main` first, then `bun run deploy` from the `main`
checkout. `deploy` compiles `dist/deck`, installs it over `~/.local/bin/deck`,
and self-restarts (`deck restart deck`; the socket drop mid-restart is
expected).

On a machine with the mattstack app installed, the app's SMAppService helper
(`com.mattstack.deck.dev`, or `com.mattstack.deck` in prod) owns deck and runs
the bundle's pinned release, not `~/.local/bin/deck`. There `deck setup` and
`bun run deploy` refuse, `deck restart deck` kickstarts the helper's label,
and the helper's boot retires a hand-installed agent
(`src/services/helper-owner.ts`) and moves deck's self record and `deck.*`
routes to the port it serves on (`src/registry/self-port.ts`). The helper
starts on launchd's bare PATH, so it composes its own; Bun spawns with the PATH
it started on, so any new spawn of a non-OS binary must pass
`env: process.env`.

## Manifest-first

Each app declares a `mattstack.deck.json` with a `dev` node: `dev.start` (the
dev serve command), optional `dev.build`/`dev.deploy` (LOCAL action buttons on
the board, dev-mode gated... they build/restart locally, they are NOT the
remote push), plus `env`, `port`, `displayName`/`icon`. The legacy `commands`
shape is gone (no grandfathering); a managed record carrying stored commands
raises a loud dev-link issue. `deck register --dir <path>` links a managed
app's source checkout (and slims legacy record fields); dev commands are read
LIVE from the linked manifest, never copied onto the record. Deck adopts its
own minimal manifest this way too (just a `dev.deploy` button); its serve
shape stays the bare `com.mattstack.deck` serve unit, never manifest-declared.

Dev mode is only for mattstack's own apps. `managedBy` classifies every entry:
`rt` (mattstack-owned), `deck` (deck itself), or `user` (someone's own local
app, which they registered themselves and which is not bundled with
mattstack). Only `rt` and `deck` entries carry `devLink`/`devDir`. A `user`
app has no dev node, no dev-link, and nothing to link TO, so its own stored
command is the whole story and the absence of a dev-link issue on one is
correct rather than a missing signal. Everything above about manifests and
`dev.*` applies to `rt`/`deck` entries only... do not audit a `user` app
against a manifest `dev` node, and do not read its lack of one as drift.
`deck status` prints this class in its third column, so check there before
concluding anything about an app's shape.

One asymmetry worth knowing when an app is down for no visible reason: dev
commands are read live from the manifest, but the SERVE unit is rendered from
the stored `record.command` (`src/registry/convert.ts`) and is only compared
against what launchd has when `register` runs (`src/api/register.ts`). So a
linked app that moves its entry point keeps a stale unit, with a correct
manifest, until something re-registers it. `deck register --dir <path>`
rewrites the unit from the manifest and is the fix.

## .localhost redirects to .mattstack, app-side

portless proxies `<name>.localhost` and `<name>.mattstack` straight to the
app's port; the gateway on `:7950` only ever sees tunnel traffic, so a
hostname redirect cannot live there. Instead `serviceEnv`
(`src/registry/service-env.ts`) puts `MATTSTACK_CANONICAL_HOST=<name>.mattstack`
into every mattstack-owned unit's environment, app-server's `createApp`
(and board's own handler) answer a `.localhost` request with a 302 to it, and
deck's api server does the same for `deck.localhost`. A dev-port override
repoints `.localhost` at a process deck did not launch, so that process has no
canonical host and keeps serving. `reresolveManagedApps` diffs the installed
plist's environment too, so an env change reinstalls the unit on the next
`POST /api/v1/apps/managed/reresolve`.

## Settings and secrets go through rt, never raw files

- Settings: `getSetting`/`setSetting` from `@mattstack/rt-client` (bundled into
  the compiled binary), or `rt settings` from a shell. Deck's config lives in
  the `deck.platform` key (machine scope): `publicDomain`, `tunnel {name,uuid}`,
  `railway {projectId,environmentId}`, `legacyPrefixes`. It is store-migrated
  with a `platform.json` fallback (see `src/api/platform-settings.ts`); add a
  new migrated field to EVERY seam `railway` uses (interface, DEFAULTS,
  MigratedFields Pick, withPlatformStoreFallback, both `setSetting` calls
  including the error-revert, and the file-strip). Never hand-edit a settings
  jsonc or read `~/.mattstack/deck/*.json` for config that belongs in settings.
- Secrets: `rt secrets set deck <key>`; read env-first then the rt daemon's
  token-gated `secrets:read` (deck scope allowlist in repo-tools
  `lib/daemon/handlers/secrets.ts`: `cfApiToken`, `cfZoneId`, `cfDnsToken`,
  `railwayToken`, `railwayApiToken`). A secret is never a setting.

## Public edge: deck owns its Cloudflare tunnel

`deck domain <domain>` creates and owns ONE wildcard cloudflared tunnel
(`*.<domain>` to the gateway on `:7950`): it mints + creates the tunnel, records
its identity in `deck.platform`, writes the config, upserts the wildcard DNS via
the Cloudflare API, installs+supervises the launchd unit
(`com.mattstack.deck.tunnel`), and confirms the connector. `deck domain` shows
the bound domain + live `/ready` health; `deck domain unbind` tears it all down.
It self-heals on the reconcile tick (`src/edge/edge-reconcile.ts`). Health is
read locally from the connector's metrics `/ready`, never a CF API call per poll.
Edge code is behind seams with fakes: `TunnelDriver` (`src/edge/tunnel.ts`),
`CfDns` (`src/edge/cf-dns.ts`), `ServiceManager` (`src/services/`).

Requires the `cloudflared` binary at runtime (invoked via `Bun.spawn`;
`LOCAL_CLOUDFLARED_BIN` overrides the path... launchd needs an ABSOLUTE path, so
deck resolves it via `resolveProgram`/`composeServicePath`), a one-time
`cloudflared tunnel login` (writes `~/.cloudflared/cert.pem`), and the
`cfZoneId`/`cfDnsToken` (Zone.DNS:Edit) secrets. No new npm/bundle deps.

Serving an app while the machine is OFF is a separate feature (Railway
push-to-remote: `deck remote on|off`, `deck push`), fully independent of the
tunnel.

## Board bundle + tests

- The board UI compiles to `core/generated/board.{js,css}` via
  `bun run build:board`. After ANY `core/board/` edit you MUST regenerate it...
  `core/generated-fresh.test.ts` byte-compares and fails otherwise. The
  minifier churn in `board.js` is expected; commit source + regenerated bundle
  together.
- `bun run test` (`bun test core src`) is the scoped suite. `bun run test:dom`
  is separate and has 8 pre-existing failures on main (structural/text
  assertions, unrelated to most changes... verify before/after, do not chase).

## Board surface: canvas ground, tables as card panels

The page ground is `--bg` with the kit's graph-paper grid, replicated by
hand in `core/board/board.css`'s own `body` rule rather than importing
`canvas.css` (that file also resets `* { box-sizing: border-box }`, which
`.drawer-toggle-row` is deliberately written without). Each `.apps-grid`
table sits on a raised `--card` panel (border + radius), the same
bg-then-panel relationship `apps/board` gives its `Panel`-wrapped row groups
(`var(--surface-wash-panel-88)` there vs a flat `--card` fill here, since
deck has no wash formula of its own). Page-level ink (headings, the
subline) stays the canvas-tuned `--muted`/`--border`, already AA against
`--bg`; ink inside a panel (suffixes, pids, hairlines) is remapped to the
kit's on-card roles (`--text-muted-on-card` etc.) scoped to `.apps-grid`,
since the plain roles fall short of AA on the lighter `--card` surface --
see `packages/tokens`' on-card invariants tests.

Since tui-kit 0.2.0 the light ramp is near-white and the four rungs sit
within ~1.03 of each other (`--chrome` #f3f4f7, `--bg` #f7f8fa, `--panel`
#fbfbfc, `--card` #ffffff), so surface fill barely carries structure in
light mode; the panel's border does the work there. Deck paints no
chrome-role surface, so `--chrome` is unused here. Never hand-pick a hex for
a surface role: reach for the kit's existing tokens (`--bg` -> `--panel` ->
`--card`) and confirm any literal against
`packages/tui-kit/src/generated/theme.css` rather than eyeballing a shift
against light AND dark; it must go through
`light-dark(<light>, <dark>)` so the toggle in `core/board/main.tsx` (the
`.dark` class on `<html>`) still finds a value in both modes. `--card`
itself is `packages/tokens/src/values.ts`'s `dark.surface.card` -- a shared
token every app's dark "card" surface reads, so a change there is a
design-system-wide call, not a deck-local tweak.

## House rules

No em dashes or en dashes anywhere. Comments only for a constraint the code
cannot show. Commit incrementally.
