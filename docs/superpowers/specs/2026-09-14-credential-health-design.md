# Credential health: tell the user before a token dies

**Date:** 2026-09-14
**Status:** Design, pre-implementation

## Problem

Every integration rt holds a credential for (github, gitlab, linear, slack,
switchboard, and the CLI-owned sessions doppler and ldcli) has a validator in
`lib/setup/validators/accounts.ts` that calls the service and answers three
ways: ready, invalid (the service rejected it), error (could not determine).
Those validators are correct and tested.

Nothing runs them on a schedule. They fire only when the setup wizard or the
checklist is open, or when someone types `rt setup status`. The daemon runs
nine sweeps (events, gates, gate-nudge, gate-escalation, reconciler, runs,
logs, chat, agents) and state backup; not one touches accounts.

So an expired GitLab PAT is invisible until something downstream fails: a
clone, an MR query, an invite, the board's refresh, a daemon push. The user
meets the failure as a confusing error in the middle of other work, never as
"your token expired."

Two facts sharpen this. GitHub fine-grained tokens and GitLab PATs both
carry hard expiry dates (90 days is the common default), and GitHub's
`/user` response and GitLab's `/personal_access_tokens/self` both report the
expiry, so the death date is knowable in advance. And rt's own daemon pushes
with those tokens, so the first symptom is often a sync that silently stops.

## Design

### A tenth sweep: `accounts-sweep`

`scheduleSweep("accounts-sweep", ...)` in `lib/daemon.ts` alongside the
others, every 6 hours, first fire 90 seconds after boot (behind the existing
boot settle, so a cold start does not spend its first second on network
calls).

Each cycle, for every integration the team and packs actually declare (the
same set the accounts group builds today, so a machine that never connected
Linear is never asked about Linear):

1. Run the integration's existing `validate()` through the real probes. No
   new validation logic: this is the same call the checklist makes.
2. When the def exposes an expiry probe (below), read the expiry too.
3. Write the outcome to a new `credential_health` table (see below).
4. Compare with the previous outcome and notify only on a transition or on
   a daily repeat of a live problem (see Notification policy).

The sweep never touches a credential, never refreshes, never repairs. It
reports.

### Expiry lookahead

Add an optional `expiry?: (p: Probes, token: string, ctx: ValidateCtx) =>
Promise<{ expiresAt: string | null } | null>` to `IntegrationDef` in
`lib/setup/integrations.ts`. Null means this integration cannot tell us,
which is the honest answer for most of them.

Implemented for the two that can:

- **github**: `GET /user` returns the `github-authentication-token-expiration`
  response header for fine-grained and classic PATs. Absent header = no
  expiry (a token that never expires), which is a real answer, not an error.
- **gitlab**: `GET /personal_access_tokens/self` returns `expires_at`
  (date only, no time) and `active`. Requires the token to have `api` or
  `read_api`; a 403 means we cannot tell, which is null, not invalid.

Everything else returns null today. Linear API keys do not expire; Slack
tokens do not expose an expiry; the CLI-owned sessions (doppler, ldcli) are
the CLI's to manage and their validator already reports a dead session.

### Storage: `credential_health`

A table in rt's state.db (schema bump, `IF NOT EXISTS` only, per the
repo's migration rule; announce the version number before merging):

| column | meaning |
|---|---|
| `integration` | primary key, the integration id |
| `status` | `ready` / `invalid` / `error` |
| `detail` | the validator's own detail string |
| `expires_at` | ISO date or null |
| `checked_at` | epoch ms of this check |
| `last_notified_at` | epoch ms of the last notification about this row |
| `last_notified_kind` | `dead` / `expiring` / null |

One row per integration, replaced each cycle. This is a cache of a remote
fact, so it is re-derivable and needs no backup source entry.

### Notification policy

The user chose: tray notification plus the checklist row, warn 7 days out,
once a day.

- **invalid** (the service rejected the credential): notify immediately on
  the transition from ready, then at most once every 24h while it stays
  invalid. Title: "GitLab token rejected". Body: the validator's detail plus
  "Reconnect in Settings". Open target: the settings deep link for that
  integration.
- **expiring** (`expires_at` within 7 days and still ready): notify once
  every 24h. Title: "GitHub token expires in 3 days". Body names the date
  and the reconnect path.
- **error** (could not determine): never notify. A network hiccup must not
  read as a credential problem; that distinction is why the validators are
  three-valued, and the sweep must not collapse it. Errors are recorded and
  visible in `rt setup status`, nothing more.
- Recovery is quiet: a row returning to ready clears `last_notified_*` and
  raises nothing.

Delivery reuses the existing notifier (`lib/notifier.ts` pushes to the
tray's `/notify`); no new transport. The sweep emits an events-bus topic
`credential/health` with the transition payload, so the notify-bridge rules
in `rt.notify.eventBridges` can be pointed at it like any other event, and
a user who does not want these can drop the rule.

### The checklist row

`account.<integration>` rows already render invalid correctly when the
checklist runs. Two additions:

- The row's detail carries the expiry when known and near: "expires in 3
  days (2026-12-01)" beside a ready status, so a user opening setup sees it
  without waiting for the notification.
- The row reads `credential_health` for its last known result when the live
  validate errors (network down), rendering "last checked 4h ago: ready"
  rather than a bare error. The live answer always wins when it arrives.

### `rt accounts` verb

One leaf verb, `rt accounts` (JSON-first, agent-usable, `--json`), printing
the table: integration, status, detail, expiry, last checked. `--recheck`
forces a sweep cycle now rather than waiting for the timer. Declares
`omitBehavior` per the picker-conformance rule (no required positional, so
this is the no-arg listing case).

## Error handling

- A validator that throws is caught per-integration; one bad integration
  never aborts the cycle, and the failure is recorded as `error` with the
  message.
- The whole sweep is wrapped the way the other sweeps are: a throw logs at
  warn with `{ err }` and the timer survives.
- Network calls get the probes' existing timeout; a timeout is `error`,
  never `invalid`.
- The sweep never runs while the machine is offline in a way that would
  spam errors: a cycle where every integration returns `error` logs once
  and notifies nothing.

## Testing

- Unit: the transition matrix (ready to invalid notifies once; invalid to
  invalid within 24h does not; invalid to ready clears silently; error
  never notifies; expiring notifies daily; expiry beyond 7 days does not).
- Unit: the two expiry probes against recorded responses, including the
  absent-header case (no expiry) and the 403 case (null, not invalid).
- Unit: `rt accounts --json` shape; `--recheck` runs a cycle.
- The sweep's registration in the daemon, with a fake clock, asserting it
  does not fire before the boot settle.
- No test calls a real service; the validators' own suites already cover
  the live shapes through recorded fixtures.

## Out of scope

- Refreshing or rotating a credential automatically. rt asks; the human
  reconnects.
- A board card. The user chose tray plus checklist; a third surface is a
  third thing to keep in sync.
- Anything for tokens rt does not hold (the npm granular token, the Apple
  API key, Bitwarden). Those live outside the integration registry.
