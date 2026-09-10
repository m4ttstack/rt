# rt skills sync — Design

**Goal:** one deterministic verb, `rt skills sync --pack <name>`, that brings a pack's
compiled skills and installed plugin caches current with their sources, plus a console
button that runs it. Authoring stays on the agent path; sync owns only the
no-content-change recompile/update chain.

**Motivation.** The console flagged a team pack as needing a recompile; fixing it took an
agent walking the editing-skills release chain by hand. Every step was deterministic:
pull the engine checkout (it was parked on a merged branch, silently stale), update the
engine plugin, patch-bump the pack manifest, `rt skills compile`, `rt skills check`,
update the pack plugin. Worse, the installed pack cache had lagged one version behind
its source for a day and **nothing surfaced it**: `rt skills check` compares compiled
output against sources, never against the installed cache. This design closes both gaps.

**Non-goals.** No AI calls, no daemon involvement, no authoring. A pack whose compiled
output still drifts after a recompile has real content changes pending; sync refuses and
names the agent path (mattstack:editing-skills). rt is not an orchestrator: this is a
bounded chain of subprocess calls and file reads, as code.

## Placement

A CLI leaf beside `check`/`compile`: `commands/skills-sync.ts` (registered in
`lib/module-registry.ts`), chain logic in `lib/skills/sync.ts` with injected process/fs
deps so the chain is unit-testable without spawning anything. Not a daemon verb: the
console server already spawns the rt CLI directly for every skills route, so the button
reuses that seam, and the CLI keeps the verb usable from a terminal by humans and agents.

## Name and path derivation

Nothing is assumed; every name is read from the same data `claude plugin update` reads,
under the Claude config dir (`CLAUDE_CONFIG_DIR`, default `~/.claude`):

- `plugins/known_marketplaces.json` maps marketplace name → source. Local marketplaces
  are `directory` or `file://` url sources; their paths are how sync finds checkouts.
- The **pack's** `<plugin>@<marketplace>` pair: the marketplace whose
  `.claude-plugin/marketplace.json` lists a plugin whose resolved source directory equals
  the pack directory (from the existing packs discovery). The plugin name comes from that
  entry, the marketplace name from the marketplace manifest — they routinely differ
  (an `acme` pack can ship as `acme@beacon`), so neither is ever derived from the other.
- The **engine** checkout and pair: the marketplace entry for the mattstack plugin, whose
  url source names the checkout directory.
- `plugins/installed_plugins.json` is the authority for installed versions (`version`
  per `<plugin>@<marketplace>` record). The cache directory is never globbed for
  versions: it can hold several.

A missing derivation (pack not listed in any local marketplace, no installed record) is
a refusal naming what was looked for and where, never a guess.

## The chain

Steps run in order; each is skipped with a reason when already satisfied, and every
subprocess's stderr is captured into the report. All steps are idempotent: recovery from
any failure is "fix the named problem, run sync again."

1. **Guards (refusals, nothing mutated yet):**
   - engine checkout dirty or not on `main` → refuse
   - pack checkout dirty → refuse (compile auto-commits; it must only ever pick up
     sync's own version bump)
2. **Freshen sources:** `git pull --ff-only` in the engine checkout and the pack
   checkout; a pull that cannot fast-forward (diverged, no remote) is a refusal. Sync
   never bumps the engine version; it only consumes what `main` says.
3. **Freshen installed engine:** `claude plugin update <engine>@<marketplace>` — skipped
   when the installed engine version already equals the checkout's manifest version.
4. **Decide, via the check facility (in-process):**
   - compiled output drifts from sources → patch-bump the pack's `plugin.json` version
     (the version stamps into compiled output, so the bump precedes the compile),
     compile in-process (auto-commit + push, as `rt skills compile` does today),
     re-check. Drift **survives** the recompile → refuse: content changes are pending;
     take the agent path.
   - no drift, installed pack cache lagging → skip bump/compile, fall through to 5.
   - no drift, installed current → no-op report, exit 0.
5. **Freshen installed pack:** `claude plugin update <pack>@<marketplace>`, then verify
   the installed record now equals the source manifest version; mismatch → step fails.
6. **cswap sweep (warning only):** readlink each `~/.claude-swap-backup/sessions/*/plugins`;
   any that is not a symlink resolving to `<config>/plugins` is reported as a named
   warning. Today all sessions share the canonical cache, so this is an invariant check,
   not an update loop — sync never writes into another account's config dir.
7. **Report.**

**The mattstack pack itself:** compile and check for `--pack mattstack` read the
checkout, not the installed cache, so the chain degenerates cleanly — the engine and the
pack are the same repo, steps 2/3 collapse into one pull + one update, and the rest is
unchanged. No special-casing beyond deduplicating the checkout.

**Ordering constraint:** step 3 precedes step 4 because check compares compiled output
against the *installed* engine; a fresh engine cache can newly expose drift that the
stale cache masked.

## CLI shape

- `rt skills sync --pack <name> [--manifest <path>] [--json]` — `--pack` and
  `--manifest` behave exactly as on `check`/`compile` (auto-find when omitted). Flags
  only, no required positional, so no `omitBehavior` entry is needed; the leaf is
  agent-safe by construction (no picker, no TTY dependence).
- Exit codes follow the check/compile convention: 0 for synced or no-op; 1 with a
  parseable JSON payload on stdout for refusals and step failures ("rt answered"), so
  callers can tell a refusal from a usage error.
- JSON payload: `{ ok, pack, steps: [{ name, status: "ran"|"skipped"|"refused"|"failed",
  detail }], versions: { engine: { before, after }, pack: { source, installedBefore,
  installedAfter } }, warnings: [], restartNeeded }`. `restartNeeded` is true whenever an
  installed cache changed — running sessions keep their old cache; that is a badge for
  surfaces, never an action sync takes.
- The `claude` binary is resolved explicitly (PATH probe with known install-location
  fallbacks, mirroring how the console resolves `rt` in its `rt-bin` module) and its
  absence is a refusal with the probed locations named — the console server runs under
  launchd, where PATH is not a login shell's.

## `rt skills check` grows the installed dimension

Check gains a third comparison per pack: installed plugin version
(`installed_plugins.json`) vs source manifest version, reported in the JSON payload as
`installed: { version, sourceVersion, status: "current" | "lagging" | "missing" }` and
as a human summary line naming both versions and the fix (`rt skills sync`).

**Exit-code compatibility:** source drift keeps exit 1. Installed lag *alone* exits 0
with the warning line — existing flows assert "check → current" at points where the
installed cache necessarily still lags (between compile and plugin update), and sync
itself re-checks mid-chain at exactly such a point. Surfaces that care about lag (the
console badge, sync's decide step) read the JSON dimension, which carries it regardless
of exit code.

## Console surface (companion change, separate repo/ticket)

In the console's skills server module, which already spawns rt for check/compile:

- `POST /api/skills/sync` with the pack name; spawns
  `rt skills sync --pack <name> --json` through the existing spawner, applies the same
  per-pack cache sweep the compile route applies (compile changes what check/composition/
  compile routes would report).
- Badge states, driven by check's JSON: in-sync; recompile needed (drift); update needed
  (installed lag). After a successful sync the response's `restartNeeded` flips the badge
  to "restart sessions to apply" — informational, not clickable.
- One Sync button per stale pack badge (matching badge granularity), disabled while a
  sync is in flight; refusal and failure text renders verbatim, including the
  content-drift refusal that points at the agent path.
- The UI half enters implementation only after a short design pass over the badge,
  button, in-flight, and result states — no UI code before that sign-off.

## Error handling

- Refusals name the guard, the observed state, and the fix; they happen before any
  mutation wherever possible (all of step 1).
- A mid-chain step failure stops the chain, reports the step and its captured
  stderr verbatim, and exits 1. No rollback machinery: every step is idempotent and the
  chain re-runs from the top, skipping what is already satisfied.
- Sync never stashes, never force-pushes, never mutates a dirty tree, and never touches
  a non-canonical cswap cache.

## Testing

- `lib/skills/__tests__/sync.test.ts`: the chain with an injected runner — step
  ordering, every guard's refusal message, skip logic per starting state (no-op, lag
  only, drift, drift-survives-compile), the mattstack degenerate case, derivation
  failures, and the cswap sweep against fixture symlinks. Fixture
  `known_marketplaces.json`/`installed_plugins.json` under the test-isolated HOME.
- Check's installed dimension: fixtures for current/lagging/missing, and the exit-code
  rule (drift → 1, lag-only → 0).
- One e2e file pinning the `--json` envelope and usage string (CI runs e2e;
  `bun run test` does not).
- Console route tests with the fake spawner, following the existing skills route tests.
- `bun run docs:gen` for the generated command reference.

## Rollout

rt side first (verb + check dimension); the console button lands second and depends on
the verb being present in the rt binary the console spawns. Two tickets, one per repo,
console blocked on rt.
