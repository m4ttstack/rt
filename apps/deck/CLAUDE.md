# Deck

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

## Manifest-first

Each app declares a `mattstack.deck.json` with a `dev` node: `dev.start` (the
dev serve command), optional `dev.build`/`dev.deploy` (LOCAL action buttons on
the board, dev-mode gated... they build/restart locally, they are NOT the
remote push), plus `env`, `port`, `displayName`/`icon`. The legacy `commands`
shape is gone — no grandfathering; a managed record carrying stored commands
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

## Board surface color: use tui-kit tokens, not hand-picked hex

The board has no card/panel wrapper around its content (unlike mr-board,
where every row group sits inside tui-kit's `<Panel>`, giving it
`var(--surface-wash-panel-88)` against the flat canvas). Nothing wraps the
apps table, so deck's page body IS the content surface and takes
`var(--card)` directly (`core/board/board.css`), reading as `#ffffff` light /
`#2c3352` dark. Since tui-kit 0.2.0 the light ramp is near-white and the four
rungs sit within ~1.03 of each other (`--chrome` #f3f4f7, `--bg` #f7f8fa,
`--panel` #fbfbfc, `--card` #ffffff), so surface fill no longer carries
structure the way it did... reach for `--border` / `--border-soft` before
hunting for a bigger fill step. Deck paints no chrome-role surface, so
`--chrome` is unused here. If a surface still needs more contrast, step up
through the kit's existing surface tokens (`--bg` -> `--panel` -> `--card`)
before hand-picking a hex: `--bg` also feeds formulas elsewhere in the kit
(`--surface-wash-bg-55`, text-on-accent colors), so reassigning that shared
token ripples beyond the page canvas. A literal hex works, but confirm it
against the kit's actual token values (`tui-kit/src/generated/theme.css`)
rather than guessing a shade from a shift and eyeballing it against light AND
dark; and it must go through `light-dark(<light>, <dark>)` so the toggle in
`core/board/main.tsx` (the `.dark` class on `<html>`) still finds a value in
both modes.

## House rules

No em dashes or en dashes anywhere. Comments only for a constraint the code
cannot show. Commit incrementally.
