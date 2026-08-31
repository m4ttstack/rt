# deck push-to-remote (Railway): remote as a public-serving mode — design

Date: 2026-08-29
Status: ratified by deck-b9 (stakeholder proxy) in-session; pending Matt's review.
Builds on: `2026-08-28-deck-manifest-first-design.md` (the `mattstack.deck.json`
manifest and its `commands.start`/`build`/`deploy` contract, which this design
consumes unchanged) and the existing `deck domain` / Cloudflare Access edge
(`src/edge/domain.ts`, `src/edge/access.ts`, `src/edge/tunnel.ts`).

## Problem

Every deck app runs on the laptop. Going public means one Cloudflare tunnel
(`local-edge`, wildcard `*.domain` → gateway:7950) back to that machine, gated
by Cloudflare Access. When the laptop sleeps, every public site sleeps with it.
For a site meant to be up regardless of the laptop, the tunnel model is the
wrong shape.

The goal: let a deck-managed app serve its **public** hostname from a real
remote host that survives the laptop being off, without the app changing shape
and without deck itself running remotely.

## Scope and frame (the north star)

- Remote is an **alternate public-serving mode per app**: opt-in,
  toggle-shaped, exactly like `publish` is today. Nothing goes remote by
  default.
- `<app>.localhost` is **always** present. Remote never replaces local; it
  swaps the origin behind the app's **public** hostname only.
- **Railway = compute, Cloudflare = edge.** Railway runs the app; Cloudflare
  keeps owning DNS and Access. Not an either/or.
- Deck runs the **app** remotely, never itself. Registry, settings, logs, and
  state stay in `~/.mattstack/deck` on the laptop. Laptop off ⇒ the board is
  off, and that is fine; the public site is what must survive.
- v1 targets **stateless / self-contained** supervised apps and says so
  plainly. An app that needs local disk, a local sqlite, or secrets to boot is
  not a v1 candidate.

Non-goals in v1: a secret store / rotation, a `deck env` verb, a Cloudflare
Pages static target, multi-region, deck-remote, public-origin failover,
`altConfig` remote overlays, and git-based deploy. All deferred (see Deferred).

## The app contract

No manifest changes. Remote consumes what the app already declares (the
manifest model shipped on main: `commands.start` is the supervised service,
every other `commands` key is a local action command, and `env` is the service
environment — `src/registry/deck-manifest.ts`):

- **Start** is the supervised `commands.start` (stored as the record's
  `command`). It is the Railway start command too, so the same app runs
  unchanged. Never an `altConfig` overlay — overlays stay local-only in v1.
- **Build** is `commands.build` when the app declares it, else nixpacks
  auto-detect. Deck NEVER runs the local `deploy` action command on Railway:
  `deploy` means "rebuild + restart the local service" (see the next section),
  which is meaningless on a host that builds and runs the app itself.
- **Env** is manifest-first now: `manifest.env → record.env`, which `specFor`
  merges with `PORT` into the supervised plist (`src/api/register.ts`,
  `src/api/register-manifest.ts`). Remote mirrors the same `record.env` (plus
  `PORT`) onto the Railway service, which is what makes "the same app moves
  unmodified" true.
- **Upload cwd** is `record.sourceDirectory ?? record.workingDirectory`,
  matching how the command route resolves an action command's cwd
  (`src/api/server.ts`). Ordinary apps set only `workingDirectory`.
- A v1 candidate is a **supervised** record: it has `commands.start` and, being
  deck-supervised, already honors `$PORT` (deck sets `PORT` in every plist).
  A port-only `deck add --port` app and an `external` record have no start
  command; the toggle refuses them with **"no start command, cannot push"**.
  deck itself is never a candidate: its manifest declares only a `deploy` action
  command and no serve shape (`attachSource` in `src/api/register-manifest.ts`),
  so remote's supervised-record check excludes it. The docs still name `$PORT`
  so a hand-written manifest author knows why.

## Relationship to local build/deploy (action commands)

Every app's manifest already turns its non-`start` `commands` into **local
action buttons** on the board (`build`, `deploy`, …): the board's `CommandsCell`
renders one button per command (`core/board/AppsTable.tsx`), and
`POST /api/v1/apps/:name/commands/:cmd` spawns the shell string in the app's
directory, streamed to the app log, dev-mode gated
(`src/services/command-runner.ts`). These run **on the laptop**. `deploy` is the
local "rebuild + restart the local service" button; deck's own row has exactly
one, `deploy` (`bun run deploy` = rebuild the binary + self-restart).

Push-to-remote is a **separate platform capability**, not another action
command:

- `deck push` deploys the app to **Railway**; the local `deploy` button
  rebuilds + restarts the **local** service. Different destinations, both stay.
- `deck remote` / `deck push` are **platform verbs** (like `publish` / `domain`),
  so they are NOT dev-mode gated and are declared in no manifest — deck
  orchestrates provisioning, DNS, and Access, which is not a shell string an app
  could carry.
- On the board they render as a distinct **Remote** control group (toggle +
  Push), labeled to read unmistakably as Railway and kept clear of the manifest
  action buttons, so "deploy" (local) and "push" (Railway) are never confused.
- If an app happens to name a manifest command `push` or `remote`, it still gets
  that as a local action button; the platform Remote controls are separate and
  win the UI copy (the button reads "Push to Railway").

## Target model (Railway)

**One Railway project for the whole deck install; one service per remote app;
one environment.** Not a project per app. Railway already isolates per service
(its own domain, variables, logs, deploys), so per-app teardown is clean without
per-app projects, and there is one place for billing and observability.

- `railwayProjectId` and `railwayEnvironmentId` live **once** in platform
  settings. Each app record carries its own `serviceId` — a pointer into that
  single shared project.
- **Ownership boundary**: deck only ever touches services it created
  (name-prefixed, e.g. `deck-<app>`), and never another service in the project
  — the same posture as `deck uninstall` refusing to touch apps it does not own.
- **Credentials** (two Railway tokens in the deck-secrets store
  `src/edge/rt-secrets.ts`, validated against the live API; no browser login):
  - `railwayApiToken` — an **account/team** token, used for the **GraphQL**
    Public API (`serviceCreate` / `serviceInstanceUpdate` build+start /
    `variableCollectionUpsert` / `serviceDelete`). A *project* token cannot
    delete a service (GraphQL returns "Not Authorized"), which is why service
    management needs account/team scope.
  - `railwayToken` — a **project** token, used for the **`railway` CLI**
    (`railway up` source upload + `railway domain` add/status/delete). The CLI
    needs a project token for implicit project context; an account token yields
    "no linked project" there.
  `RailwayCli` (`src/edge/railway.ts`) is the REAL driver, not a stub, built
  from both tokens plus `railwayProjectId`/`railwayEnvironmentId`. A missing
  Railway token surfaces as a 428 **`railway-token-required`**, like a missing
  Cloudflare token. (This supersedes an earlier "one token drives both" draft;
  the CLI and GraphQL genuinely need different token scopes.)

## Deploy pipeline (`deck push <app>`)

`deck push` uploads the app's own checkout and lets Railway build it:

- **`railway up`** from `record.sourceDirectory ?? record.workingDirectory`.
  The upload respects `.gitignore` (plus `.railwayignore` if present) —
  `node_modules`, `dist`, logs, `.env` never ship. If an **untracked
  `.env`-shaped file** would be uploaded, push **refuses** rather than leak it.
- **Builder = nixpacks auto-detect**, with `commands.build` fed as the explicit
  build command when the app declares one. v1 does not let apps configure the
  builder further. If detection/build fails, the push fails **loudly**: the
  Railway build log is surfaced as a `SyncIssue` on the app row, the same
  channel Cloudflare failures already use (`src/registry/records.ts` `addIssue`).
- **Start injected from the manifest** (`commands.start`) into the service
  config via the Railway API — the app carries no `railway.json` / `Dockerfile`
  / nixpacks file. The local `deploy` command is never sent.
- **`PORT` set explicitly** on the service to the record's local port (parity
  with local), and the custom domain's target port set to the same value. Never
  rely on Railway port auto-detect.
- **`record.env` pushed as service variables**, re-pushed on **every** `deck
  push` so remote can never drift from the local contract. Deck does not
  classify keys as secret or not and invents no secret store; whatever is in
  `record.env` (already plain JSON in `registry.json`) goes up as-is. Real
  secret sync stays v2.
- **Provenance recorded** on the app record: `{ sha, dirty, at }`. Pushing a
  dirty tree is allowed (that is the point of "push local code") but it is
  **labeled**, not hidden; the board shows what is live.
- The laptop checkout is the source of truth — literally "push the local code to
  remote." No GitHub coupling, no push-to-deploy.

`deck push` is the redeploy verb; turning remote **on** does the first push, and
every subsequent push is explicit.

## Origin swap (`deck remote <app> on`)

Turning remote on swaps the origin behind the app's existing public hostname
from the tunnel to the Railway service, reusing DNS and Access unchanged.

**Why client DNS caching does not bite the cutover.** Both the wildcard tunnel
record and the specific Railway record are **proxied** (orange-cloud), so the
public only ever resolves Cloudflare's anycast IPs at a fixed low TTL. The
tunnel-vs-Railway choice is an origin mapping made **inside** Cloudflare's edge,
per request — it updates in seconds and is not bound to any resolver TTL.

**Refuse-checks (all must pass before anything is created):**

1. `publicDomain` is bound (a `deck domain` exists).
2. The app's Access rule is **on** (emails/domains) — remote is Access-gated
   only. A **password-gated** app is refused: **"remote requires Access (Google
   sign-in); the password gate lives in the gateway and cannot ride the remote
   origin."** (The gateway, `core/gateway.ts`, is out of the request path once
   the origin is Railway, so its `published`/password logic no longer applies —
   see below.)
3. No live `cloudflare` `SyncIssue` on the record (Access must be healthy first).
4. The Cloudflare token has **Zone.DNS edit** scope (beyond Access) — else a
   `SyncIssue`.
5. The Railway token is present — else 428 `railway-token-required`.
6. Zone **SSL/TLS mode = Full** (NOT Full (strict)). Railway is explicit that
   strict does not work with its default origin cert. Deck **checks** this via
   the CF API and **refuses `zone-ssl-mode-full-required`** — it never mutates a
   zone-wide setting. Tunnel traffic ignores this mode, so Full is safe for the
   existing path. (Full means CF does not validate Railway's origin cert;
   acceptable for a zone that is otherwise tunnel-only.)
7. `publicDomain` is **not itself a subdomain** — proxied works for first-level
   subdomains only without Advanced Certificate Manager. `app.domain` is
   first-level, so fine; a subdomain `publicDomain` is refused (the tunnel
   wildcard lives under the same limit).

**Sequence (verified-first, zero-gap cutover):**

1. Create the Railway service (name-prefixed) and run the **first push**.
2. Set `PORT` and `record.env` on the service.
3. Add the Railway **custom domain** `app.publicDomain`.
4. Write the **TXT ownership record** via CF Zone.DNS — but **not** the traffic
   CNAME yet.
5. Enter **`verifying`** and poll Railway `domain-status` until it reports the
   domain verified + proxy detected. Because the wildcard already makes
   `app.domain` resolve to Cloudflare, Railway's DNS vantage point on
   `app.domain` is identical before and after the specific record, so
   verification completes on **TXT + wildcard** alone.
6. Write the **specific proxied CNAME** `app.domain → <railway-target>` as the
   **last** step. This is the atomic cutover: the tunnel serves right up to that
   instant, then the specific record (more specific than the wildcard) takes
   over at the edge. Access engages on request one.

The CNAME is the last step and **is** the publish: remote is
**published-by-construction**, independent of the gateway's `published` flag
(which is out of the remote path).

**Cutover guards** (this order is inference from Railway's docs, not a
documented promise):

- **Bounded poll**: if `verifying` has not reported verified within **10
  minutes** (matches Railway's "usually minutes"), write the CNAME anyway,
  accept the brief first-turn-on 404 window, and record
  `remote.cutover = "verified-first" | "cname-first"` so real runs are visible.
  Never block forever.
- **Spike first** (see Open spike): confirm empirically that Railway verifies on
  TXT + wildcard before any pipeline code is written.

## Flip-back (`deck remote <app> off`)

Symmetric and cheap:

1. Delete the specific CNAME. The wildcard immediately reclaims `app.domain` at
   the edge (still Cloudflare IPs, so no `NXDOMAIN` gap, no client re-resolve) —
   public traffic returns to the tunnel → gateway → local app.
2. Delete the TXT ownership record.
3. Remove the Railway custom domain, then delete the service.
4. Clear the `remote` block on the record.

The Access app is **untouched** either direction (it is keyed purely to the
hostname in `src/edge/access.ts` `syncOAuth`), and the app returns to whatever
its gateway `published`/password flag says.

## Rate-limit and idempotent-resume discipline

Let's Encrypt rate-limits **5 duplicate certificates per domain per week**, and
Railway warns against repeatedly deleting and re-adding a domain. Therefore:

- **Idempotent resume must REUSE an existing custom domain**, never
  delete-and-re-add. A re-run of `deck remote on` (or a reconcile repair) that
  finds the service/domain already present adopts them.
- Any e2e that exercises flip-off/flip-on **counts the cycles** and stays well
  under the weekly cap.
- The **unit suite uses the fake Railway/DNS drivers only** — no real Railway,
  no real certs.

## Local coexistence and failover

- Remote-on leaves the launchd service and `<app>.localhost` **untouched** —
  local stays the dev face, remote is the public face. This is the "serve
  localhost AND public" shape.
- The **dev-port override** only rewrites `routes.json` for `.localhost`, so it
  can never leak to the remote origin. Keep that invariant true.
- **No failover** in v1: the public origin is tunnel **XOR** Railway, never
  both, with no automatic fallback if Railway is down.
- `deck status` and the board row **state which** origin serves the public
  hostname: `public: tunnel` / `public: railway`, so Matt can tell at a glance.

## State and surfaces

**Platform settings** gain `railway { projectId, environmentId }` — a
store-migrated field of the **`deck.platform`** rt-settings key (machine scope),
routed through the same `getSetting`/`setSetting` ownership latch as
`publicDomain` (MAT-384), NOT a bespoke deck config or a raw `platform.json`
field. An operator sets it with `rt settings set deck.platform …`; no deck verb
is added. The Cloudflare DNS token is a **secret** (`cfDnsToken` via rt secrets,
falling back to `cfApiToken` when a single token carries both Access and
Zone.DNS scopes) — a secret is never a setting.

**App record** gains an additive, optional `remote` block:

```
remote: {
  target: "railway",
  serviceId: string,
  customDomain: string,
  // Railway-assigned CNAME target (<id>.up.railway.app), returned by
  // ensureCustomDomain and stored so reconcileRemote can write the CNAME.
  cnameTarget: string,
  status: "off" | "deploying" | "verifying" | "live" | "error",
  cutover: "verified-first" | "cname-first",
  url: string,
  lastPush: { sha: string, dirty: boolean, at: string }
}
```

Additive and optional ⇒ **no migration**. If platform settings change shape,
rewrite them — no legacy shim (house rule).

**Verbs** (platform verbs like `publish`/`domain`, **never** dev-mode gated):

- `deck remote <app> on|off` — the mode toggle (refuse-checks → provision →
  push → TXT → verify → CNAME; `off` = flip-back).
- `deck push <app>` — redeploy (re-run `railway up`).

**Board**: a distinct **Remote** control group (a toggle + a "Push to Railway"
button) on the app row, separate from the manifest action buttons `CommandsCell`
already renders (`core/board/AppsTable.tsx`) so local `deploy` and remote push
never blur. It shows `deploying`/`verifying`/`live`/`error` state and the live
URL + last-push sha the way restart state already is, and — unlike the action
buttons — is **not** dev-mode gated (it is a platform control, like publish).
Failures reuse the per-record `SyncIssue` channel.

**Reconcile**: the `verifying → live` transition is driven by the existing
reconcile tick (`core/reconcile.ts` / `src/api/tld-reconcile.ts`). Only records
in `deploying`/`verifying` poll Railway, with backoff, so a domain stuck at
`verifying` (up to Railway's 72h worst case) cannot hammer the API.

## Lifecycle edges

- **`deck remove <app>` while remote is on**: auto **flip-back first** (delete
  CNAME + TXT, remove custom domain, delete service), **then** remove the record.
  Never orphan a Railway service. (Remove is terminal, not churn, so the
  reuse-not-re-add rule is not violated.)
- **`deck uninstall --force` (it refuses otherwise) must NOT touch remote
  services.** The README's posture is that uninstalling the platform never
  silently kills an app it was serving — and a remote app is precisely designed
  to keep serving after deck and the tunnel are gone. Uninstall **prints each
  remote service with its Railway project URL and leaves it running.**
- **`deck domain` change / unbind refuses while any app is remote-on.** The
  public hostname's identity is what remote is pinned to; changing or removing
  the domain out from under a live remote app would strand its DNS and Access.
  Refuse with the offending app names, the same way `deck uninstall` refuses
  with still-registered apps.

## Testing

deck's existing harness (scratch state dir via env paths, fake `HOME`,
`FakeServiceManager` / `FakeEdgeProxy` / `FakeTunnelDriver`):

- **New fakes**: a `FakeRailwayDriver` (service create/up/config/domain/status/
  delete) and a fake CF **DNS** driver (TXT + proxied CNAME write/delete, zone
  SSL-mode read, token-scope read), mirroring the existing tunnel/edge fakes.
- **Refuse-check matrix**: each of the seven refuse-checks fails the toggle with
  its specific error; the happy path passes all seven.
- **Sequence + cutover**: TXT written before CNAME; `verifying` polls; CNAME
  written last on verify; the bounded-poll fallback writes the CNAME and records
  `cutover: "cname-first"` when the fake never verifies.
- **Flip-back symmetry**: on `off` / `remove`, every created object is torn down
  and none is orphaned; the Access app is untouched.
- **Idempotent resume**: a second `remote on` over an existing service/domain
  reuses them and issues **no** duplicate custom-domain add (rate-limit guard).
- **Provenance + env**: `lastPush` reflects sha/dirty; `record.env` is
  re-pushed on every `deck push`.
- **Reconcile backoff**: only `deploying`/`verifying` records poll; a
  long-`verifying` record backs off and does not busy-loop.
- **Status rendering**: `deck status` and the board row show `public:
  tunnel|railway` in both modes.
- **Lifecycle**: `remove` flips back then removes; `uninstall --force` lists and
  spares remote services; `deck domain` change refuses while remote-on.

No real Railway in the unit suite; a real-Railway e2e stays opt-in like the
existing launchd smoke test and counts its flip cycles.

## Spike result (settled 2026-08-30 — verified-first CONFIRMED)

The zero-gap cutover assumed Railway marks a custom domain verified on **TXT
ownership + Cloudflare-proxy-detected** alone, before the specific traffic CNAME
exists. **Confirmed empirically** against the real `mattstack deck` Railway
project and the live `m4tthew.dev` Cloudflare zone:

- Added a custom domain `spike.m4tthew.dev` (wildcard `*.m4tthew.dev` already
  proxied → cloudflared tunnel), wrote **only** the `_railway-verify.spike` TXT
  (no CNAME), and Railway flipped **`Verified: yes` after ~90 seconds**. So deck
  can write the TXT, wait for verified, then write the proxied CNAME LAST as an
  atomic, zero-404 cutover. `cname-first` remains as insurance only.

Concrete facts the pipeline must encode (from the live run):

- **TXT** name is `_railway-verify.<sub>` (relative to the zone), value
  `railway-verify=<hex>` — both returned by `railway domain <host>`.
- **CNAME** target is a Railway-assigned `<id>.up.railway.app` (e.g.
  `kw1ig666.up.railway.app`), NOT derivable from the host — so the driver must
  RETURN it from `ensureCustomDomain` and the record must STORE it
  (`RemoteState.cnameTarget`) for `reconcileRemote` to write later.
- Certificate status stays `VALIDATING_OWNERSHIP` after verify; for a proxied
  domain Railway serves CF→origin under its default `*.up.railway.app` cert, so
  the cert does not gate the cutover (matches the Full-not-strict requirement).
- **Auth**: a Railway **project token** (`RAILWAY_TOKEN`, scoped to a
  pre-provisioned project) is sufficient for service/domain/status — no account
  token. This refines the target model: deck uses ONE pre-provisioned project +
  a project token, not an account token that creates projects. `projectId` /
  `environmentId` are read once from `railway status` into platform settings.
- **CF token scope**: confirmed deck's existing Access-scoped token CANNOT
  read/write DNS — a `Zone.DNS:Edit` token (scoped to the public zone) is
  required, exactly as refuse-check #4 states. Setup docs must say so.

## Deferred (v2+)

- A real secret store / rotation and a `deck env` verb (v1 mirrors `record.env`
  as-is, no classification).
- A **Cloudflare Pages** static target (fast-follow for static apps; the target
  layer is designed to be pluggable).
- Multi-region, deck-remote, public-origin failover, `altConfig` remote
  overlays, git-based / push-to-deploy.
