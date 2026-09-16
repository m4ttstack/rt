# Herd Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daemon sweep that detects wedged or quietly-finished herd participants (workers AND the shepherd) and revives them by guarded pane injection, escalating worker -> shepherd -> human notification.

**Architecture:** One new daemon module (`lib/daemon/herd-watchdog.ts`) holding pure wedge tests plus an escalation ladder with in-memory strike state, driven by the existing `scheduleSweep` facility on a ~60s cadence. It senses only through existing stores (herd, gates, chat, herdr pane state) and acts only through the existing `injectIntoPane` prompt path and the notifier queue. It never closes panes and never respawns; closing stays a shepherd act, so the finished-pane case only nags.

**Tech Stack:** Bun/TypeScript daemon module, bun:test with injectable deps, suite settings registry in `packages/rt-client`.

**Spec:** `/Users/matt/Documents/GitHub/repo-tools/.local-dev/superpowers/specs/2026-09-16-herd-watchdog-design.md`

## Global Constraints

- Public repo: run `sh scripts/repo-purity.sh` before any push; no employer terms, no personal ticket ids in code or comments (Linear ids live in commits/PR bodies only).
- `bun run test` does NOT run e2e; the verification gate for every task is `bun run test:all` with `RT_DAEMON_SOCK`, `HERD_*`, `HERDR_*` stripped from the env.
- Daemon logging: domain events only via `childLogger("herd-watchdog")`; command outcomes are already logged at the seams. No logging try/catch wrappers.
- The daemon never mutates settings; it reads them through the resolver.
- All timer work goes through `scheduleSweep`/`safeInterval` (`lib/daemon/safe-timers.ts`); never a bare `setInterval`.
- Comments follow clean-code rules: constraints only, no narration, no ticket ids.
- Never publish or bump `@mattstack/rt-client` in this work; announce any schema change in #rt before merging (shared `SCHEMA_VERSION` and shared live db).
- A merged daemon change is NOT live until the daemon restarts; say so in the report, do not restart the daemon yourself.

## File Structure

- `packages/rt-client/src/settings/registry-defs.ts` — eight new `herd.watchdog.*` keys.
- `lib/daemon/herd-store.ts` — `shepherdPane` column on herds (guarded ALTER, gates-store pattern) + setter.
- `lib/daemon/handlers/herd.ts` — record shepherd pane on `herd:start`/`herd:resume`; expose watchdog annotations in `herd:status`.
- `packages/rt-client/src/commands.ts` — `callerPane` on the start/resume payloads; watchdog fields on `HerdStatusData` jobs.
- `commands/herd.ts` — CLI sends `HERDR_PANE_ID` as `callerPane`; status prints poke annotations; fix the stale `close` description in `lib/command-tree-def.ts`.
- Create `lib/daemon/herd-watchdog.ts` — sensors interface, pure wedge tests, ladder, sweep entry point.
- Create `lib/daemon/__tests__/herd-watchdog.test.ts` — one test per transition.
- `lib/daemon.ts` — construct the watchdog with real deps, register the sweep, join the stop handles.

---

### Task 1: Settings keys

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`
- Test: existing registry conformance tests (`packages/rt-client/test/`)

**Interfaces:**
- Produces: setting keys `herd.watchdog.enabled` (boolean, default true), `herd.watchdog.fastMins` (number, 2), `herd.watchdog.shepherdFastMins` (number, 5), `herd.watchdog.backstopMins` (number, 15), `herd.watchdog.retryMins` (number, 5), `herd.watchdog.notifyQuietMins` (number, 30), `herd.watchdog.nagMins` (number, 30), `herd.watchdog.notifyHuman` (boolean, true).

- [ ] **Step 1:** Read the registry checklist section of `docs/settings-architecture.md`. There are NO existing `herd.*` keys in `registry-defs.ts`; model the eight rows on the existing machine-scoped daemon-behavior keys there (same shape, machine scope).
- [ ] **Step 2:** Run the rt-client test suite: `(cd packages/rt-client && bun run build && bun test)`. Expected: PASS (registry conformance tests pick the rows up; a shape mistake fails here).
- [ ] **Step 3:** Run `bun run test` at the repo root. Expected: PASS (settings resolver tests see the new registry via the freshly built dist).
- [ ] **Step 4:** Commit: `git add packages/rt-client && git commit -m "settings: herd.watchdog.* keys"`.

### Task 2: Shepherd pane recording

**Files:**
- Modify: `lib/daemon/herd-store.ts`, `lib/daemon/handlers/herd.ts`, `packages/rt-client/src/commands.ts`, `commands/herd.ts`
- Test: `lib/daemon/__tests__/herd-handlers.test.ts` (extend), herd-store tests if present

**Interfaces:**
- Consumes: `HerdStore` as defined at `lib/daemon/herd-store.ts:32-46`.
- Produces: `HerdRow.shepherdPane: string | null`; `HerdStore.setShepherd(id, { session, handle, pane })` (pane optional, null clears); `herd:start` and `herd:resume` payloads gain optional `callerPane?: string`.

- [ ] **Step 1:** Write a failing test in `lib/daemon/__tests__/herd-handlers.test.ts`: `herd:resume` with `callerPane: "wX:p1"` stores it, a follow-up `herd:status` (or direct store read) shows `shepherdPane === "wX:p1"`, and a resume WITHOUT callerPane clears it to null (a shepherd that moved to an unpaned session must not keep a stale pane).
- [ ] **Step 2:** Run it: `bun test lib/daemon/__tests__/herd-handlers.test.ts -t shepherdPane`. Expected: FAIL (unknown column / field).
- [ ] **Step 3:** Implement: add the column with the guarded-ALTER pattern used for `consumedAt` in `lib/daemon/gates-store.ts:325-330` (`PRAGMA table_info` check, then `ALTER TABLE herds ADD COLUMN shepherdPane TEXT`); extend `setShepherd` and the row mappers; thread `callerPane` through `herd:start`/`herd:resume` handlers; type it in `commands.ts`; in `commands/herd.ts` pass `process.env.HERDR_PANE_ID ?? undefined` from both verbs.
- [ ] **Step 4:** Run the test again. Expected: PASS. Then `(cd packages/rt-client && bun run build)`.
- [ ] **Step 5:** Post the schema-change announcement in #rt (guarded ALTER, no SCHEMA_VERSION bump needed; say so explicitly), then commit: `git commit -m "herd: record shepherd pane on start/resume"`.

### Task 3: Watchdog module core (sensors + pure wedge tests)

**Files:**
- Create: `lib/daemon/herd-watchdog.ts`
- Create: `lib/daemon/__tests__/herd-watchdog.test.ts`

**Interfaces:**
- Consumes: `HerdStore.jobs/list/get` (Task 2's row shape), `GatesStore.unconsumedAnsweredPushes(now)` and open-gate listing (`lib/daemon/gates-store.ts`), `peekUnread` (`lib/state/chat-store.ts:504`) filtered to DMs + mentions via the wake-mode rules, pane agent state as `handlers/herd.ts:230` reads it (`paneRow.agent !== "claude"` = dead; `blocked` = modal), and the Step 0 lifecycle accessor below.
- Produces:

```ts
export interface WatchdogSensors {
  now(): number;
  herds(): HerdRow[];
  jobs(herd: string): HerdJobRow[];
  paneState(pane: string): "working" | "idle" | "modal" | "dead" | "gone";
  /* "modal" = herdr agent_status "blocked"; "dead" = pane listed, agent !== "claude" */
  idleSinceMs(pane: string): number | null;
  /* DMs + mentions only (the wake-mode filter); room chatter never counts */
  unreadDmMentionsFor(handle: string): number;
  openHumanGates(herdPrefix: string): { id: string; ageMs: number }[];
  unconsumedAnswered(session: string): { id: string; ageMs: number }[];
}
export type WedgeVerdict =
  | { kind: "healthy" }
  | { kind: "wedged"; path: "fast" | "backstop"; evidence: string }
  | { kind: "finished-lingering"; evidence: string }
  | { kind: "dead" | "modal" };
export interface WatchdogConfig { enabled: boolean; fastMins: number; shepherdFastMins: number; backstopMins: number; retryMins: number; notifyQuietMins: number; nagMins: number; notifyHuman: boolean }
export function evaluateJob(job: HerdJobRow, s: WatchdogSensors, cfg: WatchdogConfig): WedgeVerdict;
export function evaluateShepherd(herd: HerdRow, s: WatchdogSensors, cfg: WatchdogConfig): WedgeVerdict;
```

- [ ] **Step 0 (idleSince source):** herd-lifecycle already subscribes to `pane.agent_status_changed` but persists nothing, so nothing today can answer "idle since when". Failing test first in `lib/daemon/__tests__/herd-lifecycle.test.ts`: after a status-changed event, a new accessor `lastStatusChangeMs(pane)` returns the event time, and an unknown pane returns null. Implement as an in-memory map inside `lib/daemon/herd-lifecycle.ts` updated where the existing subscription handles the event (Modify: that file). Daemon restart resets it; the watchdog treats null as "not yet idle long enough" (never a poke on missing data). This map is the ONLY source for `idleSinceMs`. NOTE: herd-lifecycle's per-pane subscriptions come from reconcilePanes walking JOB rows only, so the shepherd pane never appears in this map; `evaluateShepherd` must NOT key on `idleSinceMs` (its tests key on gate/report age plus instantaneous `paneState`), and null stays never-poke.
- [ ] **Step 1:** Write failing tests for `evaluateJob` with a stub `WatchdogSensors`: (a) idle 3 min + 1 unread DM = wedged/fast; (b) idle 3 min + an unconsumed answered gate = wedged/fast; (c) idle 20 min, job `active`, nothing pending = wedged/backstop; (d) idle 20 min but job `at-gate` = healthy; (e) idle 5 min, nothing pending = healthy; (f) status `done` + `lastReport` set + pane still open past `nagMins` = finished-lingering; (g) pane dead = dead; (h) pane modal = modal.
- [ ] **Step 2:** Run: `bun test lib/daemon/__tests__/herd-watchdog.test.ts`. Expected: FAIL (module does not exist).
- [ ] **Step 3:** Implement `evaluateJob` as a pure function of the sensor readings (no I/O), thresholds from `WatchdogConfig` (minutes, mirroring the Task 1 keys).
- [ ] **Step 4:** Write failing tests for `evaluateShepherd`: (a) open human-owned gate aged past `shepherdFastMins` while shepherd pane idle = wedged/fast; (b) unread DMs/mentions past the same threshold = wedged/fast; (c) a job finished-lingering past `nagMins` = wedged/fast with that evidence; (d) shepherd pane `working` = healthy regardless; (e) BACKSTOP: a job done with a published report, no shepherd activity for `backstopMins` = wedged/backstop. Also add to the `evaluateJob` set: status `done` with pane `gone` = healthy (already closed; the nag never fires).
- [ ] **Step 5:** Run, watch them fail, implement, run to PASS.
- [ ] **Step 6:** Commit: `git commit -m "daemon: herd-watchdog wedge tests (pure evaluators)"`.

### Task 4: Escalation ladder + injection

**Files:**
- Modify: `lib/daemon/herd-watchdog.ts`
- Test: `lib/daemon/__tests__/herd-watchdog.test.ts` (extend)

**Interfaces:**
- Consumes: `injectIntoPane` from `lib/daemon/inject.ts:33` (wrap it behind the actuator dep), `enqueueNotification` from `lib/state/notifier-store.ts:95`.
- Produces:

```ts
export interface WatchdogActuators {
  /* Adapter resolves the herdr socket itself: job panes ride HerdRow.herdrSocket,
     the shepherd pane sits on the default socket. injectIntoPane refuses blocked
     agents and queues on working; refused/queued both return false (not delivered). */
  poke(pane: string, text: string): Promise<boolean>;
  parkStuckAtModal(herd: string, job: string): void;     // setJobStatus("stuck-at-modal")
  notifyHuman(summary: string): void;                    // builds the FULL NotificationEvent (id/title/message/category/timestamp, notifier-store.ts:36) and enqueueNotification
}
export class HerdWatchdog {
  constructor(deps: { sensors: WatchdogSensors; act: WatchdogActuators; cfg(): WatchdogConfig; log: Logger });
  sweep(): Promise<void>;
  annotations(herd: string, job: string): { strikes: number; lastPokeAt: number | null } | null;
}
```

- [ ] **Step 1:** Write failing ladder tests driving `sweep()` with a fake clock: (a) wedged worker gets ONE poke with text naming its evidence; (b) activity after the poke clears strikes (sensor flips to working, next sweep, then wedged again later restarts at strike 1); (c) still wedged after `retryMins` = second poke; (d) third trip = shepherd poke with a one-line summary containing job name and strike count, worker NOT poked again; (e) shepherd itself wedged and `shepherdPane` null = `notifyHuman` immediately; (f) shepherd poked twice without effect = `notifyHuman`; (g) a second `notifyHuman` within `notifyQuietMins` is suppressed; (h) a dead verdict skips injection and goes straight to the shepherd summary; a modal verdict calls `parkStuckAtModal` AND sends the shepherd summary, never an injection; (i) `enabled: false` = sweep does nothing.
- [ ] **Step 2:** Run, expected FAIL per case.
- [ ] **Step 3:** Implement: in-memory strike map keyed `herd/job` (daemon restart resets strikes deliberately; note that as a code comment constraint), ladder walk per verdict, quiet-period stamp per herd for `notifyHuman`. Poke text format: `watchdog: <evidence>. Consume it or post status.`
- [ ] **Step 4:** Run to PASS, then the module's full file: `bun test lib/daemon/__tests__/herd-watchdog.test.ts`.
- [ ] **Step 5:** Commit: `git commit -m "daemon: herd-watchdog escalation ladder"`.

### Task 5: Daemon wiring + status surfacing

**Files:**
- Modify: `lib/daemon.ts` (sweep block at ~742-780), `lib/daemon/handlers/herd.ts` (`herd:status`), `packages/rt-client/src/commands.ts` (`HerdStatusData`), `commands/herd.ts` (status render)
- Test: `lib/daemon/__tests__/herd-handlers.test.ts` (status annotation), `lib/__tests__/herd-cli.test.ts` (render)

**Interfaces:**
- Consumes: `HerdWatchdog` from Task 4.
- Produces: `herd:status` job rows gain `watchdog: { strikes: number; lastPokeAt: number | null } | null`; `rt herd status` prints `poked <n>x <ago>` on annotated rows.

- [ ] **Step 1:** Failing handler test: after a watchdog instance with recorded strikes is passed into `createHerdHandlers`, `herd:status` carries the annotation; null when the watchdog has none.
- [ ] **Step 2:** Run, FAIL; implement: construct `HerdWatchdog` in `lib/daemon.ts` with real sensor/actuator adapters (sensors read herdStore, gatesStore, `peekUnread`, and the pane table the handlers already consult; actuators wrap `injectIntoPane` and `enqueueNotification`), register `scheduleSweep("herd-watchdog", () => watchdog.sweep(), { bootDelayMs: 60_000, intervalMs: 60_000 }, log)`, push the stop handle, and hand the instance to `createHerdHandlers`.
- [ ] **Step 3:** Failing CLI test for the `poked 2x 3m ago` line; implement the render in `commands/herd.ts`; run to PASS.
- [ ] **Step 3b (whisper retirement):** the herd-lifecycle idle whisper (`herd-lifecycle.ts:227`, "idle with no open gate and no report", 180s debounce) duplicates every watchdog poke with a room notice. Failing test: with `herd.watchdog.enabled` true the whisper does not post; with it false the whisper still posts. Implement by gating the whisper on the resolved setting.
- [ ] **Step 4:** Rebuild rt-client (`bun run build` in the package) and run `bun run test:all` (env-stripped). Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "daemon: wire herd-watchdog sweep; status shows pokes"`.

### Task 5b: e2e (exact-string surfaces)

**Files:**
- Create: `e2e/tests/herd-watchdog.test.ts` (model on `lib/daemon/__tests__/gates-e2e.test.ts` and the existing e2e harness in `e2e/`)

- [ ] **Step 1:** Failing e2e: boot the test daemon with a compressed watchdog config (fastMins scaled down via the settings store the harness seeds), register a fake herd whose job pane is a scripted stub the harness controls, drive it idle with an unconsumed answered gate, and assert (a) the injected poke text verbatim (`watchdog: ...`) and (b) `rt herd status --json` carrying `watchdog: { strikes: 1, lastPokeAt: <number> }`. Exact strings, because this repo's CI-only failures live in verbatim surfaces.
- [ ] **Step 2:** Run `bun test --preload ./e2e/setup.ts e2e/tests/herd-watchdog.test.ts`; FAIL, implement any missing seam (the sensor/actuator adapters must be injectable enough for the harness to reach), PASS.
- [ ] **Step 3:** Commit: `git commit -m "e2e: herd-watchdog poke round trip"`.

### Task 6: `rt herd close` help text + shepherd lifecycle prose

**Files:**
- Modify: `lib/command-tree-def.ts:345` (description: "Close a worker job: retires the row and closes its pane")
- Modify (OTHER REPO, mattstack-skills checkout): the shepherdr engine's completion section — add the lifecycle step "on merge confirmation + ticket flip, run `rt herd close <job> --herd <id>` in the same breath".
- Test: `bun run picker:check` + docs-gen drift check for the CLI half; `sh tests/certify.sh` + `rt skills compile --pack mattstack` + `rt skills check --pack mattstack` for the skills half.

- [ ] **Step 1:** Fix the description string; run `bun run picker:check` and the docs drift check (`bun run docs:gen` if the reference embeds descriptions). Expected: PASS.
- [ ] **Step 2:** Commit (repo-tools): `git commit -m "herd close: description matches pane-reaping behavior"`.
- [ ] **Step 3:** In the mattstack-skills checkout, invoke superpowers:writing-skills AND mattstack:editing-skills, then add the completion-lifecycle sentence to the shepherdr engine where merge-confirmation handling lives; recompile, certify, read the compiled output in full.
- [ ] **Step 4:** Commit (mattstack-skills): `git commit -m "shepherdr: close the lane's job when its merge is confirmed"`. Do NOT sync packs; note it for the shipper.

### Task 7: Full verification + report

- [ ] **Step 1:** `bun run test:all` (env-stripped), `bun run picker:check`, `bunx tsc --noEmit -p .`, rt-client dist-freshness. Expected: all green; name any rotating-flake failures and prove them with isolation runs.
- [ ] **Step 2:** Write the report: per-task one-liners, the schema-announcement link, the not-live-until-daemon-restart caveat, and the pack-sync-pending note from Task 6.
