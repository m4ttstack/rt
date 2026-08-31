# Deck Public Edge (Cloudflare Tunnel) Design

**Status:** Draft for review
**Date:** 2026-08-30
**Author:** Claude (with Matt)

## Summary

Make the deck the sole owner of its public edge: a single wildcard Cloudflare
tunnel that forwards `*.<domain>` to the local gateway, created, configured,
supervised, health-checked, and torn down entirely by the deck. No hand-edited
config, no foreign launchd services, no tunnel that "just exists somewhere."

This is the local, machine-on public edge. Serving an app while the machine is
off is a separate, already-built feature (Railway push-to-remote). The two are
independent: this design never touches Railway, and the Railway path never
touches the tunnel.

## Motivation

Today the deck can render a tunnel row and badge, but only for a launchd
service under its own `com.mattstack.deck.*` namespace, and its `bindDomain`
flow assumes a hardcoded tunnel name (`local-edge`), records no tunnel
identity, and drives DNS through `cloudflared tunnel route dns` (which fails
when the wildcard record already exists). The result is that a real edge tunnel
set up outside that exact shape is invisible and unmanaged: the deck cannot show
its health, reconcile it, or tear it down.

The goal is a from-first-principles design where the deck owns the whole edge
lifecycle deterministically, with recorded identity and self-healing.

## Goals

- `deck domain <domain>` sets up the entire public edge on a fresh machine end
  to end: tunnel, config, wildcard DNS, launchd service, recorded identity.
- The deck records the managed tunnel's identity so every later operation is
  deterministic, never a guess against a hardcoded name.
- Health means the tunnel is actually connected to Cloudflare, not merely that a
  process has a pid.
- The deck self-heals: on boot and on each status poll it re-asserts that the
  service, config, and DNS match its recorded state, and repairs drift.
- Teardown is explicit and complete: `deck domain unbind` removes the launchd
  service, the DNS record, the Cloudflare-side tunnel and its credentials, the
  config, and the recorded state, and it refuses while live apps depend on the
  edge.
- The board tunnel badge and `deck domain` status both reflect real edge health.

## Non-Goals

- Per-app tunnels or per-app custom edge routes. One wildcard tunnel per deck;
  per-app concerns (publish, password, sign-in) stay in the gateway.
- Cloudflare Access provisioning. Access remains a per-app gateway/app concern.
- Multi-domain or multi-machine same-domain serving. One domain, one machine.
- Machine-off serving. That is the Railway push-to-remote feature.
- Adopting a pre-existing foreign tunnel in place. The deck creates and owns its
  own tunnel. Migrating an existing machine onto this design is an apply step
  (see Migration), not a code path.

## Architecture

### Model: one wildcard tunnel per deck

```
public request  ->  Cloudflare edge  ->  cloudflared tunnel  ->  localhost:7950 (deck gateway)  ->  <app>:port
   <app>.<domain>        TLS + Access              QUIC                 per-app access control
```

A single cloudflared tunnel ingests `*.<domain>` and forwards to the deck
gateway on port 7950; the gateway performs per-app access control (publish flag,
password, Cloudflare Access) and proxies to each app's local port. One tunnel
and one wildcard DNS record (`*.<domain>` CNAME to `<uuid>.cfargotunnel.com`,
proxied) cover every app, present and future, with no per-app edge churn.

The tunnel config is exactly:

```yaml
tunnel: <uuid>
credentials-file: <dir>/<uuid>.json

ingress:
  - hostname: "*.<domain>"
    service: http://localhost:7950
  - service: http_status:404
```

The deck generates this file in full and never expects it to be hand-edited.

### State model

The deck-managed edge identity lives in the `deck.platform` settings key
(machine scope, the same store that already holds `publicDomain` and the Railway
config):

```ts
interface TunnelIdentity {
  name: string; // per-machine-unique cloudflared tunnel name
  uuid: string; // cloudflared tunnel id
}

interface PlatformSettings {
  publicDomain: string | null; // exists today
  tunnel: TunnelIdentity | null; // NEW
  // ...tlds, legacyPrefixes, railway, secrets
}
```

`tunnel` is added to the store-migrated `MigratedFields` set, threaded through
`withPlatformStoreFallback`, the store write in `updatePlatformSettings`, and the
file-strip destructure, exactly as `railway` already is. Default is `null`.

Recording `{ name, uuid }` is what makes teardown and reconciliation
deterministic: the deck never asks "what is my tunnel called," it reads it.

### Tunnel naming

cloudflared tunnel names are account-global, so two machines each running a deck
would collide on a shared constant. The tunnel name is therefore
per-machine-unique: `deck-edge-<machine-key>`, where `<machine-key>` is the same
stable machine identity rt uses for machine-scoped settings (the
`user/local/<machine-key>/` segment). The launchd label stays the fixed
`com.mattstack.deck.tunnel` (one deck per machine, so the label need not vary),
which is what the existing service scan keys the badge on.

## Drivers (seams)

All external effects go through injectable drivers, each with a fake for tests.

### TunnelDriver (cloudflared)

Extends the existing `TunnelDriver` in `src/edge/tunnel.ts`:

```ts
interface TunnelDriver {
  create(name: string): Promise<{ uuid: string }>;        // exists
  delete(name: string): Promise<void>;                    // exists (deleteTunnel)
  list(): Promise<Array<{ name: string; uuid: string }>>; // NEW: identity + collision checks
  connections(name: string): Promise<{ connected: boolean; count: number }>; // NEW: health
}
```

- `list` and `connections` shell `cloudflared tunnel list --output json` and
  `cloudflared tunnel info <name> --output json` respectively and parse the JSON.
- `routeDns` is dropped from the driver: DNS is owned via the Cloudflare API
  (`CfDns`) so the deck can upsert and delete records, which `cloudflared tunnel
  route dns` cannot do against a pre-existing record.

### CfDns (Cloudflare API)

Reuses the existing `CfDns` built for Railway push-to-remote
(`src/edge/cf-dns.ts`), no new methods required:

- `writeProxiedCname("*.<domain>", "<uuid>.cfargotunnel.com")` to create or
  overwrite the wildcard record. This must be an upsert: overwrite an existing
  record for the host rather than erroring. (Confirm/adjust `writeProxiedCname`
  during implementation; a list-then-create-or-update is the expected shape.)
- `deleteHostRecords("*.<domain>")` on unbind.
- `tokenCanEditDns()` as a bind preflight.

The DNS token, zone id, and account details already live in the deck secrets
store (`cfDnsToken`, `cfZoneId`), read via the daemon `secrets:read` deck scope.

### ServiceManager (launchd)

Reuses the existing `ServiceManager` (`install`, `uninstall`, `isInstalled`,
`kickstart`). The tunnel is a supervised service like any app, under label
`com.mattstack.deck.tunnel`, RunAtLoad + KeepAlive, with its own log paths.

## Lifecycle

### `deck domain <domain>` (bind)

1. Validate `<domain>` shape (a registrable dotted name).
2. Preflight:
   - `cloudflared` binary present, else error with an install hint.
   - `~/.cloudflared/cert.pem` present, else return the one operator step the
     deck cannot automate: `cloudflared tunnel login` (a browser login). This is
     a 428-style "operator action required" result, not a failure.
   - `CfDns.tokenCanEditDns()` true, else the token-scope error.
3. Guard: if already bound to a different domain and any app is published or
   remote, refuse (409) unless `--force`. Rebinding to the same domain is an
   idempotent reconcile (step through 4 to 8, repairing only what drifted).
4. Create the tunnel `deck-edge-<machine-key>`, capture its uuid. If a tunnel of
   that name already exists in `list()`, reuse its uuid rather than erroring
   (makes bind idempotent and recoverable).
5. Write the config file (the exact ingress shape above) to the deck-owned path.
6. `CfDns.writeProxiedCname("*.<domain>", "<uuid>.cfargotunnel.com")` (upsert).
7. `ServiceManager.install(...)` the `com.mattstack.deck.tunnel` unit and
   `kickstart` it.
8. Record `{ publicDomain: <domain>, tunnel: { name, uuid } }` in `deck.platform`.
9. Return the bound domain, tunnel identity, and a first health read.

### `deck domain` (show)

Prints the current `publicDomain`, the recorded tunnel `{ name, uuid }`, and a
live health read from `TunnelDriver.connections(name)`: connected (n
connections), running-but-disconnected, or not installed.

### `deck domain unbind` (teardown)

1. Guard: refuse (409) if any app is published or remote, unless `--force`. The
   edge is shared infrastructure; unbinding it takes every public app offline.
2. `ServiceManager.uninstall("com.mattstack.deck.tunnel")`.
3. `CfDns.deleteHostRecords("*.<domain>")`.
4. `TunnelDriver.delete(name)` and remove the credentials file, so nothing is
   left orphaned in the Cloudflare account.
5. Remove the config file.
6. Clear `{ publicDomain: null, tunnel: null }` in `deck.platform`.

Teardown never happens as a silent side effect of another command. `deck
uninstall` (the whole-deck removal) calls the same teardown, reading the
recorded identity to delete the correct tunnel.

## Health

Tunnel health is the tunnel's live Cloudflare connection state, not its pid:

| State | Meaning | Badge tone |
|---|---|---|
| connected (>=1 connection) | edge is serving | ok |
| installed, running, 0 connections | process up, not reaching Cloudflare | warn |
| installed, not running | crashed or stopped | bad |
| not installed | no edge bound | badge absent |

`status.ts` populates the tunnel row's `health` field from
`TunnelDriver.connections(name)` (today it is hardcoded `null`). The board tunnel
badge and `deck domain` status both read this. The connection read is a single
cheap cloudflared call, made on the same cadence as the status poll.

## Reconciliation (self-heal)

A `reconcileEdge()` routine runs on deck boot and on each status poll. Given a
recorded `{ domain, tunnel }`, it asserts and repairs, acting only on drift:

- launchd service installed and running, else install/kickstart.
- config file present and byte-matching the expected shape, else rewrite.
- wildcard DNS record present and pointing at `<uuid>.cfargotunnel.com`, else
  upsert. (The DNS check is throttled so a status poll does not hit the CF API
  every few seconds; e.g. at most once per N minutes, or only when a cheaper
  local signal suggests drift.)

With no recorded binding, `reconcileEdge()` is a no-op. Reconciliation never
creates a tunnel or DNS from nothing; only `deck domain <domain>` binds.

## Board / detection

No change to detection wiring: the service is `com.mattstack.deck.tunnel`, in
the deck namespace the existing `readServices` scan already reads, so the tunnel
row and header badge render as they do for any deck service. The only board-side
change is that the tunnel row's health is now populated (above), so the badge
carries a real tone.

## Error handling and refuse matrix

| Operation | Condition | Result |
|---|---|---|
| bind | cloudflared missing | error, install hint |
| bind | cert.pem missing | 428, `cloudflared tunnel login` |
| bind | DNS token cannot edit zone | error, token-scope hint |
| bind | rebind to new domain, an app is published/remote | 409 unless `--force` |
| bind | tunnel name already exists | reuse its uuid (idempotent) |
| bind | DNS record already exists | overwrite (upsert) |
| unbind | an app is published/remote | 409 unless `--force` |
| any | recorded state absent | show reports "no edge bound"; reconcile no-ops |

## Testing strategy

Unit tests with fakes for `TunnelDriver`, `CfDns`, and `ServiceManager` (a
`FakeTunnelDriver` and fake service manager already exist; extend them with
`list`/`connections` and record calls):

- bind happy path: creates tunnel, writes config, upserts DNS, installs service,
  records identity; asserts the recorded `deck.platform` value.
- bind idempotency: existing tunnel name reused; existing DNS overwritten;
  re-running bind to the same domain repairs a single drifted piece.
- bind preflight failures: missing cert.pem, DNS token, cloudflared.
- bind guard: rebind refused while an app is published/remote; `--force` passes.
- unbind happy path: uninstalls, deletes DNS, deletes tunnel + creds, removes
  config, clears state.
- unbind guard: refused while an app is published/remote; `--force` passes.
- reconcile: each drift kind (stopped service, edited config, deleted DNS) is
  detected and repaired; no recorded state is a no-op.
- health mapping: connections result to badge tone, all four states.
- `deck.platform` round-trip: `tunnel` writes to and reads from the store, is
  store-migrated, and survives a reload (mirrors the existing railway test).

No live Cloudflare or launchd calls in the suite; the real drivers are validated
by hand during the migration apply.

## Migration (this machine, separate apply step)

Applying this design to Matt's existing machine, once the feature ships:

1. Stop and remove the hand-rolled tunnel: unload and delete
   `~/Library/LaunchAgents/com.matthewgoodwin.m4tthew-apps-tunnel.plist`, and its
   `~/.cloudflared/m4tthew-apps-tunnel.yml`.
2. Run `deck domain m4tthew.dev`. The deck creates `deck-edge-<machine-key>`,
   overwrites the existing `*.m4tthew.dev` wildcard record to point at the new
   tunnel (upsert), installs `com.mattstack.deck.tunnel`, and records identity.
3. Delete the now-dead `mrs.m4tthew.dev` record:
   `CfDns.deleteHostRecords("mrs.m4tthew.dev")` (or a one-off during the apply).
4. Optionally delete the old Cloudflare-side `m4tthew-apps-tunnel` tunnel.

Because the new and old tunnels both forward `*.m4tthew.dev` to gateway:7950,
the cutover is effectively gapless: the DNS record flips from one
`cfargotunnel.com` target to another, both of which reach the same gateway.
`publicDomain` is already `m4tthew.dev`, so no app-facing state changes.

## Decisions log

1. **Ownership: full lifecycle, sole owner.** The deck creates the tunnel, owns
   config, manages the wildcard DNS via the Cloudflare API, supervises launchd,
   records identity, and tears everything down on unbind.
2. **Health: actually connected to Cloudflare.** Queried from cloudflared, not
   inferred from a pid.
3. **Reconciliation: self-heal on boot and status poll.** Drift in service,
   config, or DNS is repaired against recorded state.
4. **Teardown: guarded and explicit.** Rebind and unbind refuse while apps are
   published/remote (without `--force`); teardown is never a side effect and
   deletes the Cloudflare-side tunnel too.

## Open questions

- Exact source of `<machine-key>` (reuse rt's machine identity vs derive from
  hostname). Resolved during implementation; must be stable across reboots.
- Whether `writeProxiedCname` already upserts or needs an overwrite path. Confirm
  against `cf-dns.ts` during implementation; the DNS-owns-upsert requirement is
  fixed regardless.
- DNS reconcile throttle interval (how often the self-heal check is allowed to
  hit the CF API). A concrete default is chosen in the plan.
