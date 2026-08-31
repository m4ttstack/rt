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
- Health means the tunnel is actually connected to Cloudflare, read cheaply from
  the connector's local metrics endpoint, not inferred from a pid.
- The deck self-heals: on its own timer it re-asserts that the service, config,
  and DNS match its recorded state, and repairs drift.
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
  Cross-zone rebind is out of scope (a single `cfZoneId` secret is assumed).
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
metrics: 127.0.0.1:<fixed-port>

ingress:
  - hostname: "*.<domain>"
    service: http://localhost:7950
  - service: http_status:404
```

The deck generates this file in full and never expects it to be hand-edited. The
`metrics` address is pinned (the default metrics port floats in a range) so the
deck can read connector health from a known local endpoint (see Health).

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

`tunnel` is added to the store-migrated `MigratedFields` Pick and threaded
through **four seams** in `src/api/platform-settings.ts` (mirroring `railway`):
the `DEFAULTS`, `withPlatformStoreFallback`, the store write in
`updatePlatformSettings`, **and the error-revert `setSetting` in that same
function, which independently enumerates the migrated fields** (this is the
fourth seam the first draft missed), plus the file-strip destructure. No
rt-client registry change is needed: `deck.platform` is registered as a loose
`object`, and `setSetting` replaces the key's value wholesale, so `tunnel: null`
clears cleanly. Default is `null`.

Recording `{ name, uuid }` is what makes teardown and reconciliation
deterministic: the deck never asks "what is my tunnel called," it reads it.

### Tunnel naming

cloudflared tunnel names are account-global, so two machines each running a deck
would collide on a shared constant. The tunnel name is therefore
per-machine-unique: `deck-edge-<machine-key>`, where `<machine-key>` is the
stable machine identity rt uses for machine-scoped settings (the
`user/local/<machine-key>/` segment). `machineKey()` exists in rt-client
(`settings/paths.ts`) but is not re-exported from the package index; the
implementation either re-exports it or derives an equivalent stable key (it must
survive reboots and must not fall back to a shared literal like `"default"`,
which would reintroduce the collision). The launchd label stays the fixed
`com.mattstack.deck.tunnel` (one deck per machine, so the label need not vary),
which is what the existing service scan keys the badge on.

## Drivers (seams)

All external effects go through injectable drivers, each with a fake for tests.

### TunnelDriver (cloudflared)

Extends the existing `TunnelDriver` in `src/edge/tunnel.ts`:

```ts
interface TunnelDriver {
  create(name: string): Promise<{ uuid: string }>;        // exists
  delete(name: string): Promise<void>;                    // exists; MUST pass `-f`
  list(): Promise<Array<{ name: string; uuid: string }>>; // NEW: identity + collision checks
  info(name: string): Promise<{ connections: number }>;   // NEW: bind-time verification ONLY
}
```

- `list` and `info` shell `cloudflared tunnel list --output json` and
  `cloudflared tunnel info <name> --output json` (both verified present on the
  installed cloudflared). `info` is a CF API roundtrip, so it is called ONLY at
  bind time to confirm the connector came up; it is never called on the status
  poll (poll-cadence health comes from the local metrics endpoint, see Health).
- `delete` MUST pass `-f`. cloudflared refuses to delete a tunnel that still has
  active connections, and edge-registered connections linger briefly after the
  launchd service is uninstalled, so an unforced delete fails intermittently and
  strands the tunnel and its credentials.
- `routeDns` is dropped from the driver: DNS is owned via the Cloudflare API
  (`CfDns`) so the deck can upsert and delete records, which `cloudflared tunnel
  route dns` cannot do against a pre-existing record.

### CfDns (Cloudflare API)

Reuses `CfDns` (`src/edge/cf-dns.ts`), with one **required change**:

- `writeProxiedCname("*.<domain>", "<uuid>.cfargotunnel.com")` must be made an
  **upsert**. Today it is a bare POST, and Cloudflare rejects a CNAME create when
  a record with that name already exists (error 81053), so the design's central
  "overwrite the existing wildcard record" step fails as written. The fix is
  list-then-update-or-create. This also removes a latent throw in
  `src/edge/remote.ts` (the Railway per-host CNAME path), where a re-run or
  reconcile against an existing record would fail the same way.
- `deleteHostRecords("*.<domain>")` on unbind. It does an exact-name list+delete,
  which works for the literal `*.<domain>` record name.
- `tokenCanEditDns()` as a bind preflight.

`<uuid>.cfargotunnel.com` is the correct proxied-CNAME target. The DNS token,
zone id, and account details already live in the deck secrets store
(`cfDnsToken`, `cfZoneId`), read via the daemon `secrets:read` deck scope.

### ServiceManager (launchd)

Reuses the existing `ServiceManager` (`install`, `uninstall`, `isInstalled`,
`kickstart`). The tunnel is a supervised service like any app, under label
`com.mattstack.deck.tunnel`, RunAtLoad + KeepAlive, with its own log paths, and
its ProgramArguments include the pinned `--metrics 127.0.0.1:<fixed-port>`.

## Lifecycle

### `deck domain <domain>` (bind)

1. Validate `<domain>` shape (a registrable dotted name).
2. Preflight:
   - `cloudflared` binary present, else error with an install hint.
   - `~/.cloudflared/cert.pem` present, else return the one operator step the
     deck cannot automate: `cloudflared tunnel login` (a browser login). This is
     a 428-style "operator action required" result, not a failure.
   - `CfDns.tokenCanEditDns()` true, else the token-scope error.
3. Guard: refuse (409) unless `--force` if any app is **remote** (those apps
   carry per-host CNAMEs pinned to this domain, exactly the case the existing
   `bindDomain` guard checks). Do NOT gate on `published`: it defaults to `true`
   for every routed app, so gating on it makes `--force` mandatory and the guard
   theater. A rebind to a **different** domain runs as unbind-then-bind (so the
   old `*.<old>` wildcard is not stranded); rebinding the **same** domain is an
   idempotent reconcile of steps 4 to 9.
4. Create the tunnel `deck-edge-<machine-key>`, capture its uuid. If a tunnel of
   that name already exists in `list()`, reuse its uuid **only when the local
   credentials file `<uuid>.json` exists**; otherwise delete and recreate, since
   a name whose creds are gone (a wiped `~/.cloudflared`, or a name owned by
   another machine) yields a service that can never connect.
5. **Record `{ tunnel: { name, uuid } }` in `deck.platform` immediately**, before
   any further step. A crash after tunnel creation but before this would orphan a
   CF tunnel the deck cannot see; recording first keeps a partial bind visible to
   `show` and removable by `unbind`.
6. Write the config file (the exact ingress shape above, metrics pinned) to the
   deck-owned path.
7. `CfDns.writeProxiedCname("*.<domain>", "<uuid>.cfargotunnel.com")` (upsert).
8. `ServiceManager.install(...)` the `com.mattstack.deck.tunnel` unit and
   `kickstart` it.
9. Set `publicDomain: <domain>` in `deck.platform`, and confirm the connector
   registered via `TunnelDriver.info(name)` (the one bind-time use of `info`).

### `deck domain` (show)

Prints the current `publicDomain`, the recorded tunnel `{ name, uuid }`, and a
live health read from the local metrics `/ready` endpoint (see Health):
connected (n ready connections), running-but-disconnected, not installed, or the
bad "re-run `deck domain`" state.

### `deck domain unbind` (teardown)

1. Guard: refuse (409) unless `--force` if any app is **remote**. Tunnel-served
   apps do not hard-block, but unbind first prints the apps that will go offline
   and requires an explicit confirmation (or `--force` in a script). The edge is
   shared infrastructure; unbinding it takes every public app offline.
2. `ServiceManager.uninstall("com.mattstack.deck.tunnel")`.
3. `CfDns.deleteHostRecords("*.<domain>")`.
4. `TunnelDriver.delete(name)` (with `-f`, since edge connections linger after
   the uninstall) and remove the credentials file, so nothing is left orphaned in
   the Cloudflare account.
5. Remove the config file.
6. Clear `{ publicDomain: null, tunnel: null }` in `deck.platform`.

Teardown never happens as a silent side effect of another command. `deck
uninstall` (the whole-deck removal) calls the same teardown, reading the
recorded identity to delete the correct tunnel.

## Health

Tunnel health is the tunnel's live Cloudflare connection state, read on the
status poll from the connector's **local metrics endpoint**, not from
`cloudflared tunnel info`. `tunnel info` is a CF API roundtrip that needs
`cert.pem` and would sit inside every status response (the board polls at 5s and
`buildStatus` runs per GET). The launchd unit pins
`--metrics 127.0.0.1:<fixed-port>`, and the deck reads
`http://127.0.0.1:<fixed-port>/ready`, whose `readyConnections` is the health
signal (a cheap local HTTP GET, no cert, no CF API).

| State | Meaning | Badge tone |
|---|---|---|
| readyConnections >= 1 | edge is serving | ok |
| installed, running, readyConnections 0 | process up, not reaching Cloudflare | warn |
| installed, not running | crashed or stopped | bad |
| bound, tunnel deleted remotely / cert revoked | edge gone; reconcile cannot rebuild it (it never creates tunnels) | bad + hint: re-run `deck domain <domain>` |
| not installed / no binding | no edge bound | badge absent |

`StatusRow.health` is currently `{ ok, status, ms }` and orphan (tunnel) rows
hardcode it `null`. Carrying this tri-plus-state (ok / warn / bad /
bad-needs-rebind) needs a small `health` type widening and the board rendering
for the new tones. That widening plus its rendering is the one board-side change;
the detection wiring (the `com.mattstack.deck.*` scan) is unchanged.

## Reconciliation (self-heal)

`reconcileEdge()` runs on its **own timer**, not from the status GET. The status
path must stay read-only: `buildStatus` runs per request and overlapping polls
would double-kickstart. The loop is guarded by an in-flight latch with backoff,
the same pattern `src/edge/remote.ts` already uses for its Railway reconcile.
Given a recorded `{ domain, tunnel }`, it asserts and repairs, acting only on
drift:

- launchd service installed and running, else install/kickstart.
- config file present and byte-matching the expected shape, else rewrite **and
  kickstart** (cloudflared reads its config only at start, so a rewrite without a
  restart is inert).
- wildcard DNS record present and pointing at `<uuid>.cfargotunnel.com`, else
  upsert. The DNS check is throttled so the loop hits the CF API at most once per
  N minutes, not every tick.

It must tolerate the rt daemon being down at boot: secrets unreachable is not DNS
drift, so it backs off rather than treating it as something to repair. It never
creates a tunnel or DNS from nothing; a remotely-deleted tunnel surfaces as the
bad "re-run `deck domain`" health state rather than being silently recreated.
With no recorded binding, `reconcileEdge()` is a no-op.

## Board / detection

Detection wiring is unchanged: the service is `com.mattstack.deck.tunnel`, in
the deck namespace the existing `readServices` scan already reads, so the tunnel
row and header badge render as they do for any deck service. The board-side
changes are the `StatusRow.health` type widening and the rendering of the new
tones (see Health); the tunnel row's health is now populated from the metrics
read rather than hardcoded `null`.

## Error handling and refuse matrix

| Operation | Condition | Result |
|---|---|---|
| bind | cloudflared missing | error, install hint |
| bind | cert.pem missing | 428, `cloudflared tunnel login` |
| bind | DNS token cannot edit zone | error, token-scope hint |
| bind | rebind to new domain, an app is remote | 409 unless `--force`; runs as unbind-then-bind |
| bind | tunnel name exists, local creds present | reuse its uuid (idempotent) |
| bind | tunnel name exists, local creds absent | delete and recreate |
| bind | DNS record already exists | overwrite (upsert) |
| unbind | an app is remote | 409 unless `--force` |
| unbind | tunnel-served apps exist | confirm (list apps going offline) unless `--force` |
| any | recorded state absent | show reports "no edge bound"; reconcile no-ops |

## Testing strategy

Unit tests with fakes for `TunnelDriver`, `CfDns`, and `ServiceManager` (a
`FakeTunnelDriver` and fake service manager already exist; extend them with
`list`/`info`, a fake local `/ready`, and recorded calls):

- bind happy path: creates tunnel, records identity immediately, writes config,
  upserts DNS, installs service; asserts the recorded `deck.platform` value and
  the ordering (identity recorded before DNS/service).
- bind idempotency: existing name with creds reused; existing name without creds
  recreated; existing DNS overwritten (upsert); same-domain re-run repairs a
  single drifted piece.
- bind preflight failures: missing cert.pem, DNS token, cloudflared.
- bind guard: rebind refused while an app is remote; `--force` passes; a
  different-domain rebind runs unbind-then-bind and leaves no stranded `*.<old>`.
- unbind happy path: uninstalls, deletes DNS, deletes tunnel with `-f` + creds,
  removes config, clears state.
- unbind guard: refused while an app is remote; tunnel-served apps require
  confirmation; `--force` passes.
- reconcile: each drift kind (stopped service, edited config -> rewrite AND
  kickstart, deleted DNS) is detected and repaired; a remotely-deleted tunnel
  yields the bad health state, not a recreate; rt daemon down backs off; no
  recorded state is a no-op; runs on its own timer, never from a status GET.
- health mapping: `readyConnections` and running-state to badge tone, all five
  rows of the table.
- `writeProxiedCname` upsert: create when absent, update when present (no 81053).
- `deck.platform` round-trip: `tunnel` writes to and reads from the store, is
  store-migrated across all four seams, and survives a reload (mirrors the
  existing railway test).

No live Cloudflare or launchd calls in the suite; the real drivers are validated
by hand during the migration apply.

## Migration (this machine, separate apply step)

Applying this design to Matt's existing machine, once the feature ships. Order
matters: **bind first, remove second**, or the old tunnel is gone while the new
one is still coming up and `*.m4tthew.dev` 1033s.

1. Run `deck domain m4tthew.dev` **first**. The deck creates
   `deck-edge-<machine-key>`, upserts the existing `*.m4tthew.dev` wildcard record
   to the new tunnel's target, installs `com.mattstack.deck.tunnel`, records
   identity, and confirms the connector. The proxied-CNAME flip is CF-internal
   and near-instant (no public DNS TTL), and Cloudflare Access policies are
   hostname-scoped so sessions survive. The cutover is genuinely gapless: the old
   and new tunnels both forward `*.m4tthew.dev` to gateway:7950, so the record
   flips between two targets that reach the same gateway.
2. **Then** stop and remove the hand-rolled tunnel: unload and delete
   `~/Library/LaunchAgents/com.matthewgoodwin.m4tthew-apps-tunnel.plist` and its
   `~/.cloudflared/m4tthew-apps-tunnel.yml`.
3. Delete the now-dead `mrs.m4tthew.dev` record:
   `CfDns.deleteHostRecords("mrs.m4tthew.dev")`.
4. Delete the old Cloudflare-side `m4tthew-apps-tunnel` tunnel.

`publicDomain` is already `m4tthew.dev`, so no app-facing state changes.

## Decisions log

1. **Ownership: full lifecycle, sole owner.** The deck creates the tunnel, owns
   config, manages the wildcard DNS via the Cloudflare API (upsert), supervises
   launchd, records identity, and tears everything down on unbind.
2. **Health: actually connected to Cloudflare, read locally.** Poll-cadence
   health comes from the connector's pinned local metrics `/ready` endpoint;
   `cloudflared tunnel info` (a CF API call) is bind-time only.
3. **Reconciliation: self-heal on its own timer.** Not from the status GET.
   Drift in service, config (rewrite + kickstart), or DNS (throttled) is repaired
   against recorded state; a remotely-deleted tunnel surfaces as a bad state, not
   a silent recreate.
4. **Teardown: guarded on remote apps, explicit.** Rebind to a different domain
   is unbind-then-bind; unbind and cross-domain rebind hard-refuse (without
   `--force`) while any app is **remote**, and warn+confirm for tunnel-served
   apps (the `published` flag is degenerate and not used as the gate). Teardown
   is never a side effect and deletes the Cloudflare-side tunnel too (with `-f`).

## Open questions

- The concrete pinned metrics port and the DNS-reconcile throttle interval. Both
  are simple constants chosen in the plan.
- Whether to re-export `machineKey()` from rt-client's index or derive an
  equivalent stable per-machine key in the deck. Decided in the plan; the
  no-shared-fallback invariant is fixed regardless.
