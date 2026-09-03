# Gate Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review gates become events on the rt bus answerable from any surface, board launches move to rt agent, focus buttons land in board and console, and panes auto-close at completion and park after an unanswered gate goes quiet.

**Architecture:** The wrapper skill emits `board/gate/opened/<gateId>` and blocks on the answer topic; the board ingests gate events off its existing rt WS relay subscription, renders an answer card, and emits `board/gate/answered/<gateId>`; rt's notifier bridges gate events to macOS notifications whose click focuses the pane via the tray. Launch and resume go through `agent:start` / `agent:resume` so session and pane ids are durable from launch.

**Tech Stack:** bun + TypeScript everywhere; bun:test; Hono (console); Swift/AppKit (rt-tray); rt daemon verbs over unix socket via `@mattstack/rt-client`; herdr CLI (retained solely for `tab close` and the focus fallback).

**Spec:** `docs/superpowers/plans/../specs/2026-09-02-gate-events-design.md` (board repo). Read it first; every task argues from it.

## Global Constraints

- Four working trees: **board** = this worktree; **repo-tools** = `/Users/matt/Documents/GitHub/repo-tools`; **console** = `/Users/matt/Documents/GitHub/console`; team pack repos only in Task 16. Each task names its tree; run that repo's own test/typecheck commands from its root.
- Purity gates: nothing tracked in board, repo-tools, or console may contain a real employer, project, or person name. Examples use `acme/web`.
- No em dashes in any prose file (docs, commit messages). SKILL.md files are exempt.
- Tests use each repo's existing idiom: injected deps/gateways, no network, no live daemon. Board: `bun test` + `bun run typecheck`. repo-tools: `bun test <file>`. Console runs **vitest**, not bun test: `bun run test -- --run` in the console root (its suites use `vi.mocked` and `vitest.setup.ts`).
- Commit after every task (each task carries its commit step). Lanes land in order; within a lane, tasks in order.
- Event topics are exactly `board/gate/opened/<gateId>` and `board/gate/answered/<gateId>`. The gate id is a UUID minted by `board gate open`.
- Settings keys added this pass: `rt.notify.eventBridges` (repo-tools), `board.agent.account`, `board.agent.model`, `board.agent.effort`, `board.gateGraceMinutes` (board). Register each per the rt:settings skill (invoke it in the task that adds the key).

---

## Lane 1: rt (repo-tools)

### Task 1: `pane:list` carries herdr's `focused` flag

**Files:**
- Modify: `lib/daemon/handlers/pane.ts` (`HerdrPane` interface at :21-32, `paneRow` at :87-110)
- Modify: `packages/rt-client/src/commands.ts` (`ChatPane` interface, near :158-168)
- Test: `lib/daemon/__tests__/pane-handlers.test.ts`

**Interfaces:**
- Consumes: herdr `session.snapshot` panes already carry `focused: boolean` (see existing fixtures in the test file at :36-43).
- Produces: `ChatPane.focused?: boolean`; `paneRow` copies it through. Task 3's suppression check and any client may read it.

- [ ] **Step 1: Write the failing test.** In `pane-handlers.test.ts`, the snapshot fixture at :41-43 has `focused: false` on all three panes; flip `w1:p1` to `focused: true` in the fixture, then assert the returned `ChatPane` rows carry the flag through (one `true`, one `false`).

```ts
const rows = (await handlers["pane:list"]({})).data!.panes;
expect(rows.find((p) => p.paneId === "w1:p1")?.focused).toBe(true);
expect(rows.find((p) => p.paneId === "w1:p2")?.focused).toBe(false);
```

- [ ] **Step 2: Run to verify it fails.** `bun test lib/daemon/__tests__/pane-handlers.test.ts` — expect FAIL (`focused` is `undefined`).
- [ ] **Step 3: Implement.** Add `focused?: boolean` to `HerdrPane`; in `paneRow`, copy `focused: pane.focused ?? false` onto the returned row; add `focused?: boolean` to `ChatPane` in `commands.ts` with a doc line ("herdr's per-pane focus flag; false when herdr itself is backgrounded").
- [ ] **Step 4: Run to verify it passes.** Same command, expect PASS; then the full pane handler suite.
- [ ] **Step 5: Commit.** `git commit -m "pane:list: propagate herdr's per-pane focused flag"`

### Task 2: rt-client events wrappers (`eventsEmit`, `eventsWait`, `eventsList`)

**Files:**
- Modify: `packages/rt-client/src/client.ts` (beside `eventsHead` at :324)
- Modify: `packages/rt-client/src/index.ts` (export list)
- Test: `packages/rt-client/test/events.test.ts` (new; `test/` is the house location): use the existing `fakeDaemon` helper from `packages/rt-client/test/fake-daemon.ts` (`fakeDaemon({...}) -> {sock, seen, stop}`, same pattern as `test/agent-wrappers.test.ts:23-33` and `test/pane-focus.test.ts`) and assert each wrapper sends the right verb name and payload via `seen`.

**Interfaces:**
- Consumes: daemon verbs `events:emit`, `events:wait`, `events:list` already in the `Commands` catalog at `commands.ts:421-424`. Copy payload/data shapes from there verbatim; do not invent fields.
- Produces (exact names, used by board Tasks 11-13 and the bridge in Task 3):
  - `eventsEmit(topic: string, payload?: unknown, o?: RtClientOptions)`
  - `eventsWait(payload: Commands["events:wait"]["payload"], o?: RtClientOptions)` with a client timeout above the daemon's 240s cap (use 250_000)
  - `eventsList(payload: Commands["events:list"]["payload"], o?: RtClientOptions)`

- [ ] **Step 1: Write the wrappers** following the exact style of `eventsHead` (one `rtCommand(...)` line each, explicit `timeoutMs`; `events:wait` gets 250_000, others 10_000). Export all three from `index.ts`.
- [ ] **Step 2: Build, typecheck, test.** Run `bun run build` in `packages/rt-client` first: `test/dist-freshness.test.ts` goes red on any `src/` change until dist is rebuilt. Then `bun test packages/rt-client`.
- [ ] **Step 3: Publish.** Bump `packages/rt-client/package.json` to the next minor, publish `@mattstack/rt-client` (npm OTP flow), and note the version number in the commit body: board Tasks 5+ pin it.
- [ ] **Step 4: Commit.** `git commit -m "rt-client: events emit/wait/list wrappers"`

### Task 3: notifier event bridge with pane-focus suppression

**Files:**
- Create: `lib/notify-bridge.ts`
- Modify: `lib/daemon.ts` (wire beside the existing notifier/agent-status wiring near :717-724)
- Modify: `lib/state/notifier-store.ts` (`NotificationEvent` at :36-46 gains `paneId?: string`). That is the WHOLE persistence change: `notify_queue` stores the full event as JSON in its `event` column and `pushToTray` already posts `JSON.stringify(event)`, so the field round-trips both for free. No db migration, no `pushToTray` edit.
- Test: `lib/__tests__/notify-bridge.test.ts` (new), plus the notifier-store test file for the paneId round-trip

**Interfaces:**
- Consumes: `EventsBus.onBroadcast` (`lib/daemon/events-bus.ts:264`); persisted emits reach broadcast subscribers as `("event", frame)` where `frame` is `{ id, topic, payload, emittedAt }` (contract pinned at `lib/daemon/command-router.ts:78-84`; verify the events handler fans the frame out and add the `fanOut("event", frame)` beside its `emitEvent` if it does not). `matchTopic` glob semantics from `events-bus.ts:70-78` (Bun.Glob, never SQLite GLOB).
- Produces:

```ts
export interface EventBridgeRule { pattern: string; category: string; title: string; message: string }
export function startNotifyBridge(deps: {
  onBroadcast(fn: (type: string, data: unknown) => void): () => void;
  rules(): EventBridgeRule[];                      // re-read per event: settings hot-reload
  enqueue(e: NotificationEvent): void;             // the notifier's existing queue entry point
  paneFocused(paneId: string): Promise<boolean>;   // herdr snapshot lookup; false on any error
  log?: { warn(o: unknown, msg: string): void };
}): () => void
```

- Template syntax: `{field}` in `title`/`message` interpolates `String(payload[field])`; unknown fields render as `{field}` literally. The event id becomes the NotificationEvent id (dedupe by id is the queue's existing behavior).

- [ ] **Step 1: Write failing tests** in `notify-bridge.test.ts` (fake deps, no daemon):
  - a broadcast `("event", {topic: "board/gate/opened/g1", payload: {iid: 7, paneId: "w1:p1", mrUrl: "https://gitlab.com/acme/web/-/merge_requests/7"}})` against rule `{pattern: "board/gate/opened/*", category: "gate", title: "review gate: !{iid}", message: "{mrUrl}"}` enqueues a NotificationEvent with the interpolated title/message, `category: "gate"`, `paneId: "w1:p1"`;
  - `paneFocused` resolving `true` suppresses (no enqueue);
  - a non-matching topic and a non-"event" broadcast type both no-op;
  - a payload without `paneId` enqueues without calling `paneFocused`.
- [ ] **Step 2: Run to verify failure.** `bun test lib/__tests__/notify-bridge.test.ts`
- [ ] **Step 3: Implement** `startNotifyBridge` (subscribe, filter type `"event"`, match rules with `Bun.Glob`, interpolate, suppression check, enqueue; every await wrapped so a throwing dep only logs). Add `paneId?: string` to `NotificationEvent`; nothing else in the persistence path changes.
- [ ] **Step 4: Wire in `daemon.ts`:** `startNotifyBridge({...})` with `rules()` reading the `rt.notify.eventBridges` setting (JSON array; invalid entries skipped with a warn), `enqueue` the notifier queue's insert, `paneFocused` via the same herdr snapshot accessor the pane handlers use. **Invoke the rt:settings skill** to register `rt.notify.eventBridges` correctly.
- [ ] **Step 5: Run the affected suites.** Bridge test, notifier-store tests, pane handler tests.
- [ ] **Step 6: Commit.** `git commit -m "notifier: settings-driven event bridge with paneId and focus suppression"`

### Task 4: tray focus action on pane-carrying notifications (Swift)

**Files:**
- Modify: `rt-tray/Sources/NotificationManager.swift` (`fire` at :264-290, `userNotificationCenter(_:didReceive:)` at :357-410)
- Modify: `rt-tray/Sources/TrayServer.swift` (the `/notify` payload decode near :301-318)

**Interfaces:**
- Consumes: `NotificationEvent.paneId` from Task 3's POST body; `HerdrBridge.shared.focusPaneById(_:)` (`HerdrBridge.swift:232-239`), already used by the `/pane/focus` route.
- Produces: clicking a notification whose event carried `paneId` focuses that pane instead of opening `event.url`.

- [ ] **Step 1: Decode `paneId`** in the `/notify` payload struct (optional String) and thread it into the `NotificationEvent` the tray builds.
- [ ] **Step 2: Stash it** in `content.userInfo["paneId"]` inside `fire(_:)`, beside the existing `pids` stash at :280-283.
- [ ] **Step 3: Handle the click.** In `didReceive`, before the default URL-open branch: if `userInfo["paneId"]` is a non-empty String, call `HerdrBridge.shared.focusPaneById(it)` and return. URL behavior for pane-less events is unchanged.
- [ ] **Step 4: Build.** Build the tray target the way the repo's tray build script does (see `rt-tray/` README or the release skill). No Swift test rig exists; this is compile-verified here and live-verified in Task 20.
- [ ] **Step 5: Commit.** `git commit -m "tray: pane-focus click action for notifications carrying paneId"`

---

## Lane 2: board launch via rt agent

### Task 5: agent launch adapter

**Files (board):**
- Create: `src/agent-launch.ts`
- Modify: `package.json` (bump `@mattstack/rt-client` to the version Task 2 published)
- Test: `src/__tests__/agent-launch.test.ts`

**Interfaces:**
- Consumes: `agentStart` / `agentResume` from rt-client (`agent:start` payload: `{repo, cwd, prompt?, surface?, model?, effort?, account?, label?, workspace?, tab?}`; `agent:resume`: `{id, prompt?, surface?, workspace?, tab?}`; both return `AgentRecord` with `id, sessionId, paneId?, tabId?, workspaceId?`).
- Produces (Tasks 6, 19 consume):

```ts
export interface AgentLaunchResult {
  agentId: string; sessionId: string;
  paneId: string; tabId: string; workspaceId: string;
  focusedExisting: boolean;
}
export interface AgentIo {  // injected for tests
  agentStart: typeof import("@mattstack/rt-client").agentStart;
  agentResume: typeof import("@mattstack/rt-client").agentResume;
}
export async function startAgentPane(opts: {
  repo: string; cwd: string; prompt: string;
  workspaceLabel: string; tabLabel: string;
  account?: string; model?: string; effort?: string;
}, io?: AgentIo): Promise<AgentLaunchResult>
export async function resumeAgentPane(opts: {
  agentId: string; prompt?: string; workspaceLabel: string; tabLabel: string;
}, io?: AgentIo): Promise<AgentLaunchResult>
```

- Both map an `ok:false` whose error matches `/already open; focused it/` to `{focusedExisting: true}` with empty ids; any other failure throws with the daemon's error text.
- `prompt` is optional on resume: a promptless herdr resume drops the human into the interactive continuation (the plain "reopen session" button), exactly as `agent:resume` allows. Only headless resumes require a prompt, and this adapter never passes headless.

- [ ] **Step 1: Write failing tests** with a fake `AgentIo`: success path returns the record's ids and `focusedExisting: false`; the dedup error string maps to `focusedExisting: true`; an unrelated error throws; `startAgentPane` passes `surface: "herdr"`, `workspace`, `tab`, and the account/model/effort fields through verbatim; `resumeAgentPane` passes `{id, prompt, surface: "herdr", workspace, tab}`, and a promptless call omits `prompt` from the payload entirely rather than sending `""`.
- [ ] **Step 2: Run to verify failure**, **Step 3: implement minimal**, **Step 4: run to pass** (`bun test src/__tests__/agent-launch.test.ts`), then `bun run typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "add src/agent-launch.ts rt agent adapter"`

### Task 6: launches and resumes go through rt agent; resume re-invokes the wrapper

**Files (board):**
- Modify: `src/herdr.ts`:
  - delete `reReviewResumePrompt` at :261-274 (and only it: `buildResumePaneCommand`, `claudeInvocation`, `buildPaneCommand`, `parseTabCreate`, `parseWorkspaceCreate`, and `launchInWorkspace` all stay for the legacy path below);
  - `launchReview`/`launchRespond`/`launchDoctor` at :346-397 call `startAgentPane` instead of `launchInWorkspace`;
  - rename `launchResume` to `launchLegacyResume`, unchanged mechanics (`buildResumePaneCommand` + `launchInWorkspace` over the `HerdrRunner`). It serves every state that predates rt agent adoption: `sessionId` on file, no `agentId`. It ages out as panes relaunch. Once Task 7 lands, a legacy resume starts plain `claude` (no `claudeCommand` override); that is the intended retirement behavior, not a regression.
- Modify: `src/review-state.ts` (`ReviewState` gains `agentId?: string; paneId?: string`), `src/respond-state.ts` and `src/doctor-state.ts` (same two fields on their state interfaces)
- Modify: `src/review-launch.ts` resume branch: build the prompt once with `dispatchPrompt("board:review", {mrUrl, statePath, statusBin: statusBinPath(), reportPath: reviewReportPath(statePath), skill: ctx.skill, reReview: true, note: ctx.note})`; then `existing.agentId` present resumes via `resumeAgentPane({agentId, prompt, ...})`, else `existing.sessionId` present resumes via `launchLegacyResume` with the SAME prompt (`claude --resume <sessionId> '<slash command>'` carries the wrapper re-invocation fine), else falls through to the fresh `launchReview` with `reReview: true`.
- Modify: `src/server.ts` `?resume=1` sites at :778 (review) and :847 (respond): same two-transport split, with `prompt: note ? operatorNoteParagraph(note) : undefined` (a plain reopen stays promptless and interactive; it must NOT become a re-review). The 400-when-no-session guard stays.
- Modify: `src/server.ts` and `bin/triage.ts` call sites that pass `claudeCommand` or destructure `{tabId, workspaceId}`: they now also persist `agentId` and `paneId` from the launch result
- Test: `src/__tests__/herdr.test.ts` adjustments, `src/__tests__/review-launch.test.ts` (rewrite the resume-path expectations: agentId states hit the agent io with the dispatchPrompt-built slash command; sessionId-only states hit the legacy runner with the same prompt; no test may reference `reReviewResumePrompt`)

**Interfaces:**
- Consumes: Task 5's `startAgentPane`/`resumeAgentPane`; existing `dispatchPrompt`, `mrTabLabel`, `reviewReportPath`.
- Produces: every launcher returns `{tabId, workspaceId, paneId, agentId, focusedExisting}` and callers persist all four ids into the matching state file. `LaunchPaneOpts` drops `claudeCommand` (Task 7 finishes the retirement); `repo` for `startAgentPane` is the SERIALIZED RT IDENTITY, never the project path: `repoIdentityField(mr.rtRepo)` (the same helper and value the board already hands `readDiscussions`). When `mr.rtRepo` is unset, fall back to `repoIdentityField(`${config.gitlabHost}/${projectPath}`)`, which is still canonical because `repoIdentityField` accepts the bare host/path form. Never hand the daemon a bare project path, and never hand-roll the codec. When both are null (malformed config), log and launch anyway rather than refusing... the pane still works.

- [ ] **Step 1: Update the failing tests first.** In `review-launch.test.ts`, replace the resume assertions: the fake io's resume call must receive a prompt starting `/board:review ` and containing `--state`, `--status-bin`, `--report`, and `--re-review`; no test may reference `reReviewResumePrompt`. In `herdr.test.ts`, delete tests of the deleted functions and add launcher tests against a fake `AgentIo` asserting workspace/tab labels are passed through and state ids come back.
- [ ] **Step 2: Run to verify the new expectations fail.**
- [ ] **Step 3: Implement** the rewires exactly as the Files block describes. The dedup path: `focusedExisting: true` maps to the existing focused-existing behavior (return the known tab, no state overwrite).
- [ ] **Step 4: Run the full board suite + typecheck.** `bun test && bun run typecheck`
- [ ] **Step 5: Commit.** `git commit -m "launch through rt agent; resumes re-invoke the wrapper slash command"`

### Task 7: retire `claudeCommand` for typed agent settings

**Files (board):**
- Modify: `src/config.ts` (drop the `claudeCommand` field, its validation at :221-222, default at :253, and the `storeValue("board.claudeCommand", ...)` read at :475; add `agent: { account?: string; model?: string; effort?: string }` read via `storeValue("board.agent.account", resolve)` etc.)
- Modify: launch call sites from Task 6 to pass `config.agent.account/model/effort` into `startAgentPane`
- Test: `src/__tests__/config.test.ts` (or the existing config suite file) for the new fields and the removed one

- [ ] **Step 1: Write failing tests** for `agent.account/model/effort` resolving from the settings store and defaulting to undefined; assert `claudeCommand` is gone from the parsed config type.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**, including **invoking the rt:settings skill** to register `board.agent.account`, `board.agent.model`, `board.agent.effort` and retire `board.claudeCommand`.
- [ ] **Step 4: Full suite + typecheck.**
- [ ] **Step 5: Commit.** `git commit -m "config: typed board.agent.* settings replace claudeCommand"`

---

## Lane 3: focus buttons

### Task 8: board focus goes through the tray

**Files (board):**
- Modify: `src/server.ts` at the four `focusTab(existing.tabId)` sites (:754, :787, :856, :910): each becomes `await focusPane(existing)` where

```ts
/** Tray-raised focus when a paneId is on file; herdr-internal tab focus otherwise. */
async function focusPane(state: { paneId?: string; tabId?: string }): Promise<void> {
  if (state.paneId) {
    const res = await paneFocus({ paneId: state.paneId });
    if (res.ok) return;
    console.error(`pane focus failed, falling back to tab focus: ${res.error}`);
  }
  if (state.tabId) await focusTab(state.tabId);
}
```

- Test: `src/__tests__/server-focus.test.ts` (new; test `focusPane` as an exported helper with fakes: paneId present + ok → no focusTab; paneId present + error → focusTab fallback; paneId absent → focusTab)

- [ ] **Step 1: Write the failing tests**, **Step 2: verify failure**, **Step 3: implement** (`paneFocus` imported from rt-client; helper exported for tests), **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "board focus raises the terminal via rt pane:focus, tab-focus fallback"`.

### Task 9: console focus button

**Files (console):**
- Create: `src/server/panes.ts`

```ts
import { Hono } from 'hono';
import { paneFocus } from '@mattstack/rt-client';

export const panes = new Hono()
  .post('/api/panes/:id/focus', async (c) => {
    const res = await paneFocus({ paneId: c.req.param('id') }, { sockPath: process.env.RT_SOCK_PATH });
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data);
  });
```

- Modify: `src/server/routes.ts` (chain `.route('/', panes)`; keep handlers inline per the file's RPC-inference comment)
- Modify: `src/app/runs/RunRow.tsx` (the actual row component, imported by `RunBoard.tsx:24` and rendered at :150): render a focus button when `run.agent && run.agent.status !== 'done'`, calling the api client's `POST /api/panes/{run.agent.pane}/focus`; on a non-ok response show the app's standard error notification with "couldn't focus the pane". Do NOT touch `RunBoard.tsx`'s page-level `actions=` slot at :128.
- Modify: `src/app/runs/RunDetail.tsx`: the same button, same gating, in the drawer's header action area (the spec asks for rows AND the drawer).
- Test (vitest, `bun run test -- --run`): `src/server/panes.test.ts` (mirror the chat repo's `src/server/panes.test.ts:73-99` shape: 200 `{paneId, focused:true}` passthrough, 502 `{error}` on `ok:false`); `src/app/runs/RunRow.test.tsx` gains: button renders for a run fixture with `agent: {status:'working', pane:'w1:p1'}`, absent for `agent: null` and for `status:'done'`; `src/app/runs/RunDetail.test.tsx` (or its existing equivalent) gains the same render/absent pair.

- [ ] **Step 1: failing server test**, **Step 2: verify**, **Step 3: implement route + chain**, **Step 4: failing component tests (RunRow, then RunDetail)**, **Step 5: implement both buttons**, **Step 6: full console suite (`bun run test -- --run`)**, **Step 7: commit** `git commit -m "runs: focus button raises a running run's pane via rt"`.

---

## Lane 4: gates

### Task 10: gate store

**Files (board):**
- Create: `src/gates/store.ts`
- Test: `src/__tests__/gates-store.test.ts`

**Interfaces (Tasks 11-14, 18, 19 consume; keep names exact):**

```ts
export interface GateQuestion { id: string; label: string; multi: boolean; options: string[] }
export type GateAnswers = Record<string, string | string[]>;
export interface GateState {
  gateId: string; mrUrl: string; iid: number; kind: "review-post";
  status: "open" | "answered" | "parked";
  openedAt: number; answeredAt?: number; parkedAt?: number;
  answers?: GateAnswers; answeredBy?: "board-ui" | "pane";
  questions: GateQuestion[];
  agentId?: string; sessionId?: string; paneId?: string; tabId?: string;
}
export const GATE_DIR: string;                       // join(APP_ROOT, "state", "gates")
export function gateFilePath(mrUrl: string, dir?: string): string;   // same slug scheme as reviewFilePath
export function readGateStates(dir?: string): Map<string, GateState>; // keyed by mrUrl
export function writeGateState(path: string, patch: Partial<GateState> & { gateId: string }): void;
export function pruneGateStates(onBoard: Set<string>, dir?: string): void;
```

- Semantics: `writeGateState` merges over the existing file like `writeReviewState` does; `readGateStates` skips unparseable files. One live gate per MR (a new `gate open` for an MR overwrites the file).

- [ ] **Step 1: failing tests** (round-trip, merge-patch, prune keeps on-board MRs, unparseable file skipped; use a temp dir, mirror `src/__tests__/review-state.test.ts`'s style).
- [ ] **Step 2: verify failure**, **Step 3: implement** (copy the mechanics of `review-state.ts`, one responsibility per function), **Step 4: pass + typecheck**, **Step 5: commit** `git commit -m "add src/gates/store.ts"`.

### Task 11: status-bin gate verbs

**Files (board):**
- Create: `bin/gate.ts`
- Modify: `src/subcommands.ts` (add `"gate": () => import("../bin/gate.ts")` to `VERBS`)
- Create: `src/gates/verbs.ts` (the logic, unit-testable; `bin/gate.ts` is a thin argv shell like `bin/review-status.ts`)
- Test: `src/__tests__/gates-verbs.test.ts`

**Interfaces:**
- Consumes: Task 10's store; Task 2's `eventsEmit`/`eventsWait`/`eventsHead` (injected); `readReviewStates` for mrUrl/iid/agentId/sessionId/paneId/tabId lookup from the `--state` path.
- Produces (argv contract the wrapper skill in Task 15 uses; `<state>` is the review state path the wrapper already holds):
  - `board gate open <state> --questions <json>` mints a UUID gateId, writes the gate file (`status: "open"`, ids copied from review state), emits `board/gate/opened/<gateId>` with the full event-contract payload, prints the gateId.
  - `board gate wait <state>` reads the gate file; if `answers` already present prints them and exits 0; else queries the journal via `eventsList` for `board/gate/answered/<gateId>` (journal-first: a parked resume finds the answer here); else loops `eventsWait` until an answer event arrives; on arrival writes `{status: "answered", answers, answeredBy, answeredAt}` and prints `{"answers":..., "by":..., "answeredAt":...}`.
  - `board gate answer <state> --answers <json> --by pane` emits `board/gate/answered/<gateId>` and updates the file. Used by the in-pane escape hatch.

```ts
// src/gates/verbs.ts
export interface GateVerbIo {
  eventsEmit: typeof import("@mattstack/rt-client").eventsEmit;
  eventsWait: typeof import("@mattstack/rt-client").eventsWait;
  eventsList: typeof import("@mattstack/rt-client").eventsList;
  eventsHead: typeof import("@mattstack/rt-client").eventsHead;
  now(): number;
}
export async function gateOpen(statePath: string, questionsJson: string, io: GateVerbIo): Promise<string>; // returns gateId
export async function gateWait(statePath: string, io: GateVerbIo): Promise<{ answers: GateAnswers; by: string; answeredAt: number }>;
export async function gateAnswer(statePath: string, answersJson: string, by: "pane", io: GateVerbIo): Promise<void>;
```

- [ ] **Step 1: failing tests** with a fake io: `gateOpen` writes the file and emits the contract payload (assert topic and every field); `gateWait` returns immediately from a pre-answered file; returns from a journaled answer without calling `eventsWait`; loops one timed-out `eventsWait` then returns on the second; `gateAnswer` emits with `by: "pane"`. Malformed `--questions` JSON exits nonzero with a message.
- [ ] **Step 2: verify failure**, **Step 3: implement** (`bin/gate.ts` parses argv, builds the real io from rt-client, dispatches; errors print to stderr and exit 1 so the wrapper's degraded mode triggers).
- [ ] **Step 4: pass + typecheck + full suite.**
- [ ] **Step 5: Commit.** `git commit -m "status-bin: gate open/wait/answer verbs over the rt events bus"`

### Task 12: board ingests gate events and serves gate state

**Files (board):**
- Modify: `src/server.ts`: the relay subscription at :1613 additionally handles `type === "event"` frames whose `data.topic` starts with `board/gate/`: parse `opened|answered` and the gateId from the topic, apply to the gate store (opened writes the full payload; answered merges `{status: "answered", answers, answeredBy: payload.by, answeredAt}`), then `sseNudge()`. Non-gate event frames fall through to the existing RELAY_TYPES logic untouched.
- Modify: `src/server.ts` `/data.json` handler: beside `readReviewStates()` at :562, `const gates = readGateStates()`, prune with the other prunes, and attach `gate` to each MR row (`gates.get(m.webUrl) ?? null`, shaped `{gateId, status, openedAt, questions, answers}`).
- Modify: `src/client/types.ts`: the MR row type gains `gate: { gateId: string; status: "open" | "answered" | "parked"; openedAt: number; questions: GateQuestion[]; answers?: GateAnswers } | null`.
- Boot reconcile: on server start, one `eventsList({ pattern: "board/gate/**", limit: 500 })` pass applies any journaled opened/answered events newer than each stored gate file's state (answered wins over open). The pattern MUST be `**`: the bus matches with `Bun.Glob`, whose `*` does not cross `/`, and gate topics have four segments, so `board/gate/*` matches nothing. Extract the apply logic into `src/gates/ingest.ts` so the relay handler and the boot pass share it.
- Create: `src/gates/ingest.ts` with `applyGateEvent(store, frame)` pure over an injected store. An `answered` frame carries only the gateId (in its topic and payload); ingest resolves it to a file by scanning `readGateStates()` values for the matching `gateId`, since the store is keyed by mrUrl.
- Bridge-rule registration (fills the value whose KEY Task 3 registered; Task 20's notifications depend on it): on server boot, the board upserts its own rules into the `rt.notify.eventBridges` setting, merge-not-clobber: read the current array, and only if no entry with `pattern: "board/gate/opened/*"` exists, append `{pattern: "board/gate/opened/*", category: "gate", title: "review gate: !{iid}", message: "{mrUrl}"}` and write back. Other apps' entries and hand edits are never touched; write through the settings resolver, never a file path. Extract as `ensureBridgeRule(read, write)` beside the ingest code and unit-test the three cases (absent appends, present no-ops, unrelated entries preserved).
- Test: `src/__tests__/gates-ingest.test.ts` (opened creates, answered merges, answered-before-opened tolerated, malformed payload skipped with no throw, non-gate topic ignored).

- [ ] **Step 1: failing ingest tests**, **Step 2: verify**, **Step 3: implement ingest + wire relay + data.json + boot pass**, **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "server: ingest board/gate events, serve gate state on rows"`.

### Task 13: gate answer endpoint

**Files (board):**
- Modify: `src/server.ts`: new `case "/gate/answer"` (POST, `isLocalRequest` gated like `/gate`-less peers such as `/draft`): body `{ mrUrl: string; answers: GateAnswers }`; loads the gate (404 unknown, 409 already answered), validates every answered question id exists in `questions` and multi/single shape matches, emits `board/gate/answered/<gateId>` with `{gateId, answers, by: "board-ui", answeredAt}` via `eventsEmit`, merges the gate file, `sseNudge()`, returns `{ok: true}`. If the gate was `parked`, also invoke the Task 19 resume hook (this task lands a `resumeParkedGate` stub that Task 19 fills; the stub logs and returns).
- Create: `src/gates/answer.ts` with the validation + orchestration as a pure function over injected io, mirroring the server's other extracted handlers.
- Test: `src/__tests__/gates-answer.test.ts` (happy path emits then merges; unknown MR 404; double answer 409; wrong option shape 400; parked gate calls the resume hook).

- [ ] **Step 1: failing tests**, **Step 2: verify**, **Step 3: implement**, **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "server: /gate/answer emits the answered event"`.

### Task 14: gate card UI

**Files (board):**
- Create: `src/client/board/GateCard.tsx`: renders `mr.gate` when non-null: the questions (checkbox group for `multi`, radio pair otherwise), a parked badge when `status === "parked"`, answered summary when `status === "answered"`, and a submit button posting `/gate/answer` with `{mrUrl, answers}` then relying on the SSE nudge for refresh. Follow the board client's existing component idiom (see `DraftModal.tsx` for a form-shaped sibling; reuse `chips.tsx`/`Disclosure.tsx` primitives where they fit).
- Modify: `src/client/board/RowView.tsx`: render `<GateCard mr={mr} />` in the row's expanded area whenever `mr.gate` is present.
- Test: board's client rig has no jsdom/testing-library (logic tests only), so extract `gateAnswerPayload(gate, selections)` into `src/client/board/gate-format.ts` and unit-test that (selection shaping, multi vs single, refusing empty required answers, and treating a zero-option question as non-required so an empty `tiers` never blocks submit) in `src/__tests__/client-format.test.ts` style.

- [ ] **Step 1: failing test on the payload/format helper**, **Step 2: verify**, **Step 3: implement helper + component + wiring**, **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "client: gate card renders and answers review gates"`.

### Task 15: wrapper skill: one event gate

**Files (board):**
- Modify: `skills/review/SKILL.md` (live via the `~/.claude/skills/board:review` symlink)

**Required approach:** invoke `superpowers:writing-skills` before editing and follow its verification flow. Em dashes are permitted inside SKILL.md.

Content changes (the what; writing-skills governs the how):
- Frontmatter `slot-review` becomes `required mr-review@2 -- owns the domain review flow for one MR: resolving the MR/ticket, producing the draft review, writing the report, reporting the severity levels present, and executing the posting once handed the human's decision. Never presents posting gates or decides disposition.`
- The HARD-GATE section is replaced by the gate protocol: after the report is written, build the combined questions (`tiers` multi-select over the levels the domain skill reported present, or omitted entirely when no levels are reported so a clean review opens with `outcome` alone and is approvable in one click; `outcome` single-select comment/approve), run `<status-bin> gate open <state> --questions <json>`, then `<status-bin> gate wait <state>`; act on the printed answers (hand them to the domain skill to post, or post directly on the generic path); then `review-status done` with the chosen outcome exactly as today.
- Re-entry rule, checked FIRST, before marking reviewing or reviewing anything: if `--resumed-gate <gateId>` was passed, this invocation is a parked-gate resume. Do NOT re-review and do NOT run `gate open`. Emit `reviewing`, run `<status-bin> gate wait <state>` (the answers are already in the gate file, so it returns at once), act on them, mark done. Every other step is skipped. State that this invocation supersedes any earlier gate contract remembered in the conversation.
- In-pane escape hatch: a human may interrupt the wait and answer conversationally; run `<status-bin> gate answer <state> --answers <json> --by pane` before acting.
- Degraded mode: if `gate open` or `gate wait` fails (rt daemon down), present ONE combined AskUserQuestion carrying both questions, never the old two-gate pair, and proceed on its answers.
- Re-review mode section is unchanged in substance; it no longer mentions posting gates beyond pointing at the gate protocol.

Deployment note: `~/.claude/skills/board:review` symlinks to the CANONICAL
checkout (`~/Documents/GitHub/board/skills/review`), not this worktree, so
the edit goes live for launched panes only once this branch merges and the
canonical checkout pulls. Task 20's live pass depends on that.

- [ ] **Step 1: invoke superpowers:writing-skills** and follow it (baseline read, edit, verification).
- [ ] **Step 2: Commit.** `git commit -m "skills/review: single event gate via status-bin gate verbs (mr-review@2)"`

### Task 16: pack fills to mr-review@2 (rollout, outside this repo)

**Files:** each installed team pack's review fill (the domain skill its manifest binds into the board's review slot). Do not name packs in board-tracked files.

- [ ] **Step 1:** For each pack the machine's manifests bind (`rt skills check --pack <pack>` enumerates), update its review fill per the mr-review@2 boundary: remove its posting gates; add "report the severity levels present when the review is done"; add "execute the posting when handed `{tiers, outcome}`". Follow the mattstack:editing-skills pipeline (bump, compile, commit, `claude plugin update`).
- [ ] **Step 2:** Record in each pack's commit that mr-review@1 boards remain compatible until their wrapper updates (the fill keeps working if it simply never gets gate questions asked of it).

---

## Lane 5: lifecycle

### Task 17: auto-close at done

**Files (board):**
- Modify: `src/herdr.ts`: add

```ts
export async function closeTab(tabId: string, runner: HerdrRunner = defaultRunner): Promise<void> {
  await runner(["tab", "close", tabId]);
}
```

- Modify: `src/server.ts` `/review/outcome` handler: when `signal.status === "done"`, look up the state's `tabId` and `closeTab` it (best-effort try/catch; log on failure); applies to review, respond, and doctor kinds. `error` status never closes. Placement matters: the close goes beside the latch step (:1024-1055), ABOVE the `signalEmoji` early-return at :1056-1059, or most done signals never reach it.
- Test: `src/__tests__/server-close.test.ts` for an extracted `closeOnDone(signal, states, close)` helper: done+tabId closes, done without tabId no-ops, error never closes, close throwing is swallowed.

- [ ] **Step 1: failing tests**, **Step 2: verify**, **Step 3: implement + wire**, **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "close the herdr tab when a launched pane reports done"`.

### Task 18: park sweep

**Files (board):**
- Create: `src/gates/sweep.ts`:

```ts
export interface SweepAction { kind: "park" | "close-missed-done"; mrUrl: string; tabId?: string; gateId?: string }
export function planSweep(
  gates: Map<string, GateState>,
  reviews: Map<string, ReviewState>,
  now: number,
  graceMs: number,
): SweepAction[]
```

  - `park`: gate `status === "open"` and `now - openedAt >= graceMs`.
  - `close-missed-done`: review `status done` with a `tabId` still on file and no gate open (the reconcile for a `/review/outcome` the server missed; executing it clears `tabId` from the state so it fires once).
- Modify: `src/server.ts`: a `setInterval` sweep (60s) beside the SSE heartbeat at :1610: `planSweep(...)` with `graceMs` from `config.gateGraceMinutes * 60_000`; executes each action (`closeTab`, then for `park` merge `{status: "parked", parkedAt: now}` and `sseNudge()`, and `notify` via the existing escalation notifier).
- Modify: `src/config.ts`: `gateGraceMinutes: number` (default 90, `storeValue("board.gateGraceMinutes", resolve)`, validated positive number). **Invoke the rt:settings skill** to register it.
- Test: `src/__tests__/gates-sweep.test.ts` (fresh gate untouched; aged gate parks; answered and parked gates never park again; done review with tabId closes once; boundary at exactly graceMs parks).

- [ ] **Step 1: failing tests**, **Step 2: verify**, **Step 3: implement + wire + settings**, **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "park unanswered gates after the grace window; reconcile missed closes"`.

### Task 19: parked answers resume the session

**Files (board):**
- Modify: `src/gates/answer.ts`: fill the Task 13 stub: when the answered gate was `parked`, build the wrapper prompt with `dispatchPrompt("board:review", {mrUrl, statePath: reviewFilePath(mrUrl), statusBin: statusBinPath(), reportPath: reviewReportPath(statePath), skill: resolveLaunchSkill("review", mrUrl, config), resumedGate: gate.gateId})` and call `resumeAgentPane({agentId: gate.agentId, prompt, workspaceLabel: config.reviewsWorkspace, tabLabel: mrTabLabel(gate.iid, undefined, "↺")})`; persist the fresh pane ids into review state. Missing `agentId` degrades to a notify ("parked gate answered but no agent on file; relaunch from the board") instead of throwing.
- Modify: `src/herdr.ts`: add `resumedGate?: string` to `SkillPromptOpts` and a `flag("--resumed-gate", opts.resumedGate)` line in `dispatchArgs`, so a parked-gate resume's prompt carries `--resumed-gate <gateId>`. A normal launch and a re-review never pass it (the wrapper only skips `gate open` when it is present).
- Test: extend `src/__tests__/gates-answer.test.ts`: parked answer triggers resume with a prompt containing `/board:review` and `--state`; open-gate answer does not resume; missing agentId notifies and still answers.

- [ ] **Step 1: failing tests**, **Step 2: verify**, **Step 3: implement**, **Step 4: full suite + typecheck**, **Step 5: commit** `git commit -m "answering a parked gate resumes the recorded session"`.

### Task 20: live verification pass

No code. With the rt daemon, tray, and board running and lanes 1-5 deployed:

- [ ] Launch a review on a scratch MR from the board; confirm the state file carries `agentId`/`sessionId`/`paneId` at launch.
- [ ] Let it reach the gate: gate card appears on the row; a macOS notification fires; clicking it raises the terminal on the pane; with the pane focused, a second gate (another scratch MR) fires no notification.
- [ ] Answer from the card: pane proceeds, posts, marks done, tab closes.
- [ ] Open one more gate, wait past a temporarily lowered `board.gateGraceMinutes` (set it to 1): pane parks; answer the card; a resumed pane appears, posts, closes.
- [ ] Console: a running run shows the focus button; clicking raises its pane.
- [ ] Record outcomes in the PR/MR description per repo.
