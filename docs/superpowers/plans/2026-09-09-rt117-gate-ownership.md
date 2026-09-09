# RT-117 Gate Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gates know who owns them; owners get them pushed, non-owners cannot answer them, humans are only notified when they should be, and the shepherd-facing surfaces stop lying.

**Architecture:** A derived `owner` field on gate rows (daemon-side at open, stored as `human` or `herd:<id>`), enforced at `gate:answer`, fanned out through owner-scoped subscriptions, escalated to the human by a sweep. Satellite honesty fixes ride the same wave. Everything builds on RT-113's `bg-server-spec` baseline (branch `rt-117-gates`).

**Tech Stack:** Bun, TypeScript, bun:sqlite, bun test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-rt117-gate-ownership-design.md`

## Global Constraints

- Base branch is `bg-server-spec` (RT-113). Never touch that branch; commit only to `rt-117-gates`.
- Run `bun install` once before any test run (rt-client moved on the baseline).
- No em dashes or en dashes anywhere, including docs and test names. Use "..." or parentheses.
- Clean-code comments: a comment states a constraint the code cannot show; never narrates, never cites tasks/reviews. Decision records go in the task report, not source.
- This repo is public. Neutral fixture names only (no client/work repo names in tests); `scripts/repo-purity.sh` must pass before any push.
- `bun run test` does NOT run e2e. Any verbatim string change (refusal messages, doorbell phrases, dm output) needs its e2e assertion updated and `bun run test:all` green.
- gates.db migrations: only `CREATE ... IF NOT EXISTS` plus the store's `PRAGMA table_info` column-add loop. Never a bare `ALTER TABLE` outside that loop.
- Commit after every task (and after every green step 5 below); short imperative messages ending with the Claude attribution line already used on this branch.

---

### Task 1: gates-store owner, escalatedAt, and subscription scope columns

**Files:**
- Modify: `lib/daemon/gates-store.ts`
- Test: `lib/daemon/__tests__/gates-store.test.ts` (existing file, add cases)

**Interfaces:**
- Consumes: existing `createGatesStore`, `GateRow`, `GateSubscription`.
- Produces: `GateRow.owner: string | null` (`"human" | "herd:<id>"`), `GateRow.escalatedAt: number | null`, `GatesStore.markEscalated(id: string): void`, `OpenGateInput.owner?: string`, `GateSubscription.scope: "prefix" | "owner"`, `GateSubscription.ownerRef: string | null`, `AddSubscriptionInput` gains `{ scope?: "prefix" | "owner"; ownerRef?: string }`, `GatesStore.pruneDeadSubscriptions(olderThanMs: number, now?: number): number`.

- [ ] **Step 1: Write the failing tests** (append to `gates-store.test.ts`)

```ts
test("open stores owner and get returns it", () => {
  const { store } = makeStore();
  const { row } = store.open({ ...baseOpen(), owner: "herd:h-1" });
  expect(store.get(row.id)?.owner).toBe("herd:h-1");
});

test("owner defaults to null and markEscalated stamps escalatedAt once", () => {
  const { store } = makeStore();
  const { row } = store.open(baseOpen());
  expect(row.owner).toBeNull();
  expect(row.escalatedAt).toBeNull();
  store.markEscalated(row.id);
  const stamped = store.get(row.id)!.escalatedAt;
  expect(typeof stamped).toBe("number");
});

test("subscriptions carry scope and ownerRef; prune removes stale dead rows", () => {
  const { store } = makeStore();
  store.addSubscription({ subjectPrefix: "", session: "s1", scope: "owner", ownerRef: "herd:h-1" });
  const sub = store.subscriptions({ live: true })[0]!;
  expect(sub.scope).toBe("owner");
  expect(sub.ownerRef).toBe("herd:h-1");
  store.markSubscriptionDelivery(sub.id, "failed");
  store.markSubscriptionDead(sub.id);
  expect(store.pruneDeadSubscriptions(0)).toBe(1);
  expect(store.subscriptions({}).length).toBe(0);
});
```

Match the file's existing helper names: if the suite builds stores through a different factory than `makeStore()`/`baseOpen()`, use its actual helpers; the assertions stay as written.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/gates-store.test.ts`
Expected: FAIL (unknown `owner` input / missing `markEscalated` / missing `pruneDeadSubscriptions`).

- [ ] **Step 3: Implement**

In `gates-store.ts`:
- Add `owner TEXT` and `escalatedAt INTEGER` to the `gates` CREATE block; add `scope TEXT NOT NULL DEFAULT 'prefix'` and `ownerRef TEXT` to the `gate_subscriptions` CREATE block.
- Extend the existing column-add loop: `for (const col of ["context", "origin", "owner", "escalatedAt"])` (all TEXT is fine for owner; use a second small loop or a typed map so `escalatedAt` is added as INTEGER). Add a matching `PRAGMA table_info(gate_subscriptions)` loop for `scope` (TEXT, backfill `'prefix'` via `UPDATE gate_subscriptions SET scope='prefix' WHERE scope IS NULL`) and `ownerRef` (TEXT).
- Thread `owner` through `open()` input, the INSERT statement, and `rowToGate` (null when absent). Same for `escalatedAt` in `rowToGate`.
- `markEscalated`: `UPDATE gates SET escalatedAt = ? WHERE id = ? AND escalatedAt IS NULL`.
- `addSubscription` stores scope/ownerRef; `rowToSubscription` returns them.
- `pruneDeadSubscriptions(olderThanMs, now = Date.now())`: `DELETE FROM gate_subscriptions WHERE dead = 1 AND (lastDelivery IS NULL OR json_extract(lastDelivery, '$.at') <= ?)` with `now - olderThanMs`; return `changes`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/daemon/__tests__/gates-store.test.ts`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/gates-store.ts lib/daemon/__tests__/gates-store.test.ts
git commit -m "gates-store: owner, escalatedAt, subscription scope columns" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: owner derivation at gate:open

**Files:**
- Modify: `lib/daemon/handlers/gate.ts`, `lib/daemon/command-router.ts`
- Test: `lib/daemon/__tests__/gates-handlers.test.ts`

**Interfaces:**
- Consumes: Task 1's `OpenGateInput.owner`.
- Produces: `createGateHandlers` deps gain `runSpawnedBy?: (runId: string) => string | null`. Derivation rule (single function `deriveOwner(origin, runSpawnedBy)` exported for tests): origin has `runId` and `runSpawnedBy(runId)` returns a string starting `herd:` → that string; anything else (no origin, no runId, null lookup, non-herd spawner such as `shepherdr`) → `"human"`. The `gate/opened/<id>` event payload gains `owner`.

- [ ] **Step 1: Write the failing tests**

```ts
test("gate:open derives herd owner from the run's spawner", async () => {
  const handlers = makeHandlers({ runSpawnedBy: () => "herd:h-9" });
  const res = await handlers["gate:open"]({ ...openPayload(), origin: { runId: "r-1", presentation: "wait" } });
  expect(res.ok).toBe(true);
  expect(store.get((res as any).data.id)?.owner).toBe("herd:h-9");
});

test("gate:open derives human for legacy spawners and missing runs", async () => {
  const handlers = makeHandlers({ runSpawnedBy: () => "shepherdr" });
  const res = await handlers["gate:open"]({ ...openPayload(), origin: { runId: "r-2", presentation: "wait" } });
  expect(store.get((res as any).data.id)?.owner).toBe("human");
});

test("gate:open without origin derives human and the opened event carries owner", async () => {
  const events: any[] = [];
  const handlers = makeHandlers({}, (topic, payload) => events.push({ topic, payload }));
  await handlers["gate:open"](openPayload());
  expect(events[0].payload.owner).toBe("human");
});
```

Adapt `makeHandlers`/`openPayload` to the suite's existing builders; the deps object is the third/fourth argument of `createGateHandlers`, so the builder must accept overrides for it.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/gates-handlers.test.ts`
Expected: FAIL (`owner` null / event payload missing owner).

- [ ] **Step 3: Implement**

- `handlers/gate.ts`: export `deriveOwner(origin: GateOrigin | undefined, runSpawnedBy?: (runId: string) => string | null): string { const runId = origin?.runId; if (runId && runSpawnedBy) { const s = runSpawnedBy(runId); if (s && s.startsWith("herd:")) return s; } return "human"; }`. Call it in `gate:open` and pass `owner` into `store.open`. Add `owner: row.owner` to the opened `eventPayload`.
- `command-router.ts`: next to the existing `runWorktree` wiring (`:135`), add `runSpawnedBy: (runId) => findRun(runId)?.fields.find((f) => f.key === "spawned_by")?.value ?? null,` and pass it into `createGateHandlers`'s deps.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/daemon/__tests__/gates-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/gate.ts lib/daemon/command-router.ts lib/daemon/__tests__/gates-handlers.test.ts
git commit -m "gate open: derive owner from the run's spawner" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: answer enforcement, override, and clean terminal-gate rejections

**Files:**
- Modify: `lib/daemon/handlers/gate.ts`, `lib/daemon/command-router.ts`, `commands/gate.ts`, `lib/command-tree-def.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/gates-handlers.test.ts`, `e2e/tests/` (the file asserting gate CLI output; create `e2e/tests/gate-answer.test.ts` if none exists)

**Interfaces:**
- Consumes: `GateRow.owner`, `HerdRow.shepherdSession`.
- Produces: `createGateHandlers` deps gain `herdShepherd?: (herdId: string) => string | null`. `gate:answer` payload gains `session?: string` and `override?: boolean`. New structured refusals, exact strings pinned by e2e:
  - non-owner: `{ ok: false, error: "owned-by", owner: "herd:<id>" }`, CLI text: `gate <id> is owned by herd:<id>; pass --override to answer anyway`
  - closed gate: `{ ok: false, error: "gate-closed", reason: <closedReason>, supersededBy?: <id> }`, CLI text: `gate <id> is closed (<reason>)` plus `; superseded by <id>` when known.
  - Answer rows written under override carry `overridden: true` inside the stored `answer` JSON.

- [ ] **Step 1: Write the failing handler tests**

```ts
test("gate:answer refuses a non-owner session", async () => {
  const handlers = makeHandlers({ runSpawnedBy: () => "herd:h-1", herdShepherd: () => "shep-session" });
  const open = await handlers["gate:open"]({ ...openPayload(), origin: { runId: "r", presentation: "wait" } });
  const res = await handlers["gate:answer"]({ id: (open as any).data.id, by: "intruder", session: "other-session", answers: validAnswers() });
  expect(res).toEqual({ ok: false, error: "owned-by", owner: "herd:h-1" });
});

test("gate:answer allows the owning shepherd, the pane, and override", async () => {
  const handlers = makeHandlers({ runSpawnedBy: () => "herd:h-1", herdShepherd: () => "shep-session" });
  const a = await handlers["gate:open"]({ ...openPayload(), origin: { runId: "r", presentation: "wait" } });
  const ok1 = await handlers["gate:answer"]({ id: (a as any).data.id, by: "shep", session: "shep-session", answers: validAnswers() });
  expect(ok1.ok).toBe(true);
  const b = await handlers["gate:open"]({ ...openPayload({ kind: "k2" }), origin: { runId: "r", presentation: "wait" } });
  const ok2 = await handlers["gate:answer"]({ id: (b as any).data.id, by: "matt", override: true, answers: validAnswers() });
  expect(ok2.ok).toBe(true);
  expect((ok2 as any).data.row.answer.overridden).toBe(true);
});

test("gate:answer on a superseded gate returns a structured rejection", async () => {
  const handlers = makeHandlers({});
  const first = await handlers["gate:open"](openPayload());
  const second = await handlers["gate:open"](openPayload()); // same subject+kind supersedes
  const res = await handlers["gate:answer"]({ id: (first as any).data.id, by: "anyone", answers: validAnswers() });
  expect(res).toEqual({ ok: false, error: "gate-closed", reason: "superseded", supersededBy: (second as any).data.id });
});
```

`by === "pane"` (the `GATE_BY_PANE` constant) must stay exempt from the owner guard; assert that in the second test if the suite has a pane-answer builder.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/gates-handlers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `gate:answer`, after `store.get(id)` and before `validateAnswers`:

```ts
if (gate.status === "closed") {
  const supersededBy = gate.closedReason === "superseded" ? store.supersederOf?.(gate.id) : undefined;
  return { ok: false as const, error: "gate-closed", reason: gate.closedReason, ...(supersededBy ? { supersededBy } : {}) };
}
const owner = gate.owner;
if (owner?.startsWith("herd:") && payload?.override !== true && by !== GATE_BY_PANE) {
  const shepherd = deps.herdShepherd?.(owner.slice("herd:".length)) ?? null;
  const session = typeof payload?.session === "string" ? payload.session : "";
  if (!shepherd || session !== shepherd) return { ok: false as const, error: "owned-by", owner };
}
```

For `supersededBy`: add a small `supersederOf(id)` query to the store (`SELECT id FROM gates WHERE subject = ? AND kind = ? AND openedAt >= ? AND id != ? ORDER BY openedAt ASC LIMIT 1` using the closed row's fields), or store `supersededBy` on the closed row at supersede time if that is simpler; either way the rejection shape above is the contract. When `override === true`, pass a flag into `store.answer` so the persisted answer JSON gains `overridden: true`.

- `command-router.ts`: wire `herdShepherd: (herdId) => herdStore.get(herdId)?.shepherdSession ?? null` (use the store's actual getter name).
- `packages/rt-client/src/commands.ts`: extend the `gate:answer` payload type with `session?: string; override?: boolean;` and the answer record type with `overridden?: boolean`.
- `commands/gate.ts`: `answer` gains `--override` (boolean) and `--session <id>` defaulting to `process.env.CLAUDE_CODE_SESSION_ID`; both forwarded. Map the two new errors to the CLI texts in the Interfaces block (same message on stderr for TTY and inside the `--json` envelope's `error` field).
- `lib/command-tree-def.ts`: declare both flags on the `gate answer` leaf.
- After `packages/rt-client` type changes: run `bun run build` inside `packages/rt-client` (dist freshness guard).

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/daemon lib/__tests__ packages/rt-client`
Expected: PASS including `dist-freshness`.

- [ ] **Step 5: Write the e2e pin and run it**

In the e2e gate test file, drive a real `rt gate open` (origin with runId is not needed; seed the store through the daemon fixture the suite already uses) and assert the exact refusal strings from Interfaces. Run: `bun run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "gate answer: owner guard with override; clean closed-gate rejections" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: owner-scoped fan-out and auto-subscription at herd start/resume

**Files:**
- Modify: `lib/daemon/gate-push.ts`, `lib/daemon/handlers/gate.ts` (subscribe payload), `lib/daemon/handlers/herd.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/gate-push.test.ts`, `lib/daemon/__tests__/herd-handlers.test.ts` (or the suite covering herd start)

**Interfaces:**
- Consumes: Task 1's `scope`/`ownerRef` on subscriptions; `GateRow.owner`.
- Produces: `gate:subscribe` payload gains `{ scope?: "owner"; ownerRef?: string }` (validated: `scope:"owner"` requires `ownerRef` starting `herd:`; prefix rows unchanged). `fanOut` matches owner rows by `row.owner === sub.ownerRef`. `subscribeShepherd(herdId, session)` in `handlers/herd.ts` registers BOTH the existing prefix row and an owner row, skipping duplicates (same scope+ownerRef+session already live).

- [ ] **Step 1: Write the failing tests**

```ts
test("fanOut pushes owner-scoped subscriptions for owned gates only", async () => {
  const sub = store.addSubscription({ subjectPrefix: "", session: "shep", scope: "owner", ownerRef: "herd:h-1" });
  const owned = store.open({ ...baseOpen({ subject: "run:r-1" }), owner: "herd:h-1" }).row;
  const foreign = store.open({ ...baseOpen({ subject: "run:r-2", kind: "k2" }), owner: "herd:h-2" }).row;
  await push.onOpened(owned);
  await push.onOpened(foreign);
  expect(delivered.map((d) => d.session)).toEqual(["shep"]);
});

test("herd start subscribes the shepherd to its own gates by owner", async () => {
  await herdHandlers["herd:start"](startPayload());
  const subs = gatesStore.subscriptions({ live: true });
  expect(subs.some((s) => s.scope === "owner" && s.ownerRef?.startsWith("herd:"))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure** ... `bun test lib/daemon/__tests__/gate-push.test.ts lib/daemon/__tests__/herd-handlers.test.ts`

- [ ] **Step 3: Implement**

- `gate-push.ts` `fanOut`: `const subs = allLive.filter((sub) => sub.scope === "owner" ? (row.owner !== null && row.owner === sub.ownerRef) : row.subject.startsWith(sub.subjectPrefix));`
- `handlers/gate.ts` `gate:subscribe`: accept and validate the two new fields; reject `scope:"owner"` without a `herd:`-prefixed `ownerRef`; pass through to `addSubscription`.
- `handlers/herd.ts` `subscribeShepherd`: after the prefix subscribe, call `deps.gate["gate:subscribe"]({ scope: "owner", ownerRef: "herd:" + herdId, subjectPrefix: "", session })`; before both, drop any live subscription rows for the same herd held by a DIFFERENT session (re-point on resume), using `gate:subscriptions` + `gate:unsubscribe`.
- `packages/rt-client/src/commands.ts`: payload type update; rebuild rt-client (`bun run build` in the package).

- [ ] **Step 4: Run to verify pass** ... same test command, plus `bun test packages/rt-client`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "gates: owner-scoped subscriptions; herd start/resume auto-subscribe" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: escalation sweep and the TTL setting

**Files:**
- Create: `lib/daemon/gate-escalation.ts`
- Modify: `lib/daemon.ts` (scheduleSweep wiring), `packages/rt-client/src/settings/registry-defs.ts`
- Test: Create `lib/daemon/__tests__/gate-escalation.test.ts`

**Interfaces:**
- Consumes: `GateRow.owner/escalatedAt`, `markEscalated`, `subscriptions()`, Task 2's owner values.
- Produces: `createGateEscalation(deps): { sweep(): number }` with deps `{ store: GatesStore; ttlMs: () => number; emit: (topic: string, payload: Record<string, unknown>) => void; log: Logger }`. Emits topic `gate/escalated/<id>` with payload `{ id, subject, kind, label, owner, reason: "ttl" | "owner-dead", paneId, origin }`, once per gate (guarded by `escalatedAt`). Settings key `rt.gates.escalationTtlMinutes` (type number, scopes `["user"]`, default `10`).

Before implementing, load the `rt:settings` skill: the new key must go through the settings registry checklist.

- [ ] **Step 1: Write the failing tests**

```ts
test("sweep escalates an owned gate past the TTL exactly once", () => {
  const { row } = store.open({ ...baseOpen(), owner: "herd:h-1" });
  const esc = createGateEscalation({ store, ttlMs: () => 0, emit, log });
  expect(esc.sweep()).toBe(1);
  expect(emitted[0].topic).toBe(`gate/escalated/${row.id}`);
  expect(emitted[0].payload.reason).toBe("ttl");
  expect(esc.sweep()).toBe(0);
});

test("sweep escalates immediately when the owner's subscription is dead", () => {
  store.addSubscription({ subjectPrefix: "", session: "shep", scope: "owner", ownerRef: "herd:h-1" });
  const sub = store.subscriptions({})[0]!;
  store.markSubscriptionDead(sub.id);
  store.open({ ...baseOpen(), owner: "herd:h-1" });
  const esc = createGateEscalation({ store, ttlMs: () => 60 * 60 * 1000, emit, log });
  expect(esc.sweep()).toBe(1);
  expect(emitted[0].payload.reason).toBe("owner-dead");
});

test("sweep ignores human-owned and unowned gates", () => {
  store.open(baseOpen());
  store.open({ ...baseOpen({ kind: "k2" }), owner: "human" });
  const esc = createGateEscalation({ store, ttlMs: () => 0, emit, log });
  expect(esc.sweep()).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure** ... `bun test lib/daemon/__tests__/gate-escalation.test.ts`

- [ ] **Step 3: Implement**

`gate-escalation.ts`: `sweep()` lists open gates (`store.list({ open: true, limit: <the store's max> })`, paging with the cursor if present), keeps rows where `owner?.startsWith("herd:") && escalatedAt === null`, and escalates when `openedAt <= now - ttlMs()` (reason `ttl`) or every live owner-scoped subscription with `ownerRef === owner` is absent-or-dead (reason `owner-dead`). On escalate: `emit(...)` then `store.markEscalated(id)`; count and return. Wrap the loop body in try/catch that logs at warn and continues (a bad row must not stall the sweep).

`lib/daemon.ts`: after the `gate-nudge-retry` sweep, add

```ts
sweepHandles.push(scheduleSweep(
  "gate-escalation",
  () => { gateEscalation.sweep(); },
  { bootDelayMs: 30_000, intervalMs: 60_000 },
  log,
));
```

constructing `gateEscalation = createGateEscalation({ store: gatesStore, ttlMs: () => escalationTtlMinutes() * 60_000, emit: (topic, payload) => { const emittedAt = Date.now(); const eventId = eventsBus.emitAt(topic, payload, emittedAt); broadcastFn("event", { id: eventId, topic, payload, emittedAt }); }, log })` next to `gatePush` (reuse the daemon's existing broadcast function; match how `createGateHandlers` receives it). `escalationTtlMinutes()` reads the settings resolver the same way existing daemon settings reads do (grep `rt.logRetentionDays` for the pattern).

`registry-defs.ts`: add the key with a description covering: what escalation is, the two trigger reasons, and that `0` means escalate on the first sweep. Rebuild rt-client.

- [ ] **Step 4: Run to verify pass** ... `bun test lib/daemon packages/rt-client`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "gates: escalation sweep emits gate/escalated on TTL or dead owner" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: notify-bridge owner filter

**Files:**
- Modify: `lib/notify-bridge.ts`, `packages/rt-client/src/settings/registry-defs.ts` (rt.notify.eventBridges description)
- Test: `lib/__tests__/notify-bridge.test.ts`

**Interfaces:**
- Consumes: `gate/opened` payloads now carrying `owner` (Task 2), `gate/escalated` events (Task 5).
- Produces: `EventBridgeRule.owner?: "human"`. A rule with `owner: "human"` skips events whose `payload.owner` is a string starting `herd:`; events with no `owner` field still match (non-gate events keep working). Parse rejects non-"human" values with a warn, like the other optional fields.

- [ ] **Step 1: Write the failing tests**

```ts
test("owner:human rule suppresses herd-owned gate events", async () => {
  const rules = [{ pattern: "gate/opened/**", category: "gate", title: "t", message: "m", owner: "human" as const }];
  await broadcastEvent({ topic: "gate/opened/g1", payload: { id: "g1", owner: "herd:h-1" } });
  expect(enqueued.length).toBe(0);
  await broadcastEvent({ topic: "gate/opened/g2", payload: { id: "g2", owner: "human" } });
  expect(enqueued.length).toBe(1);
});

test("parse skips rules with an invalid owner value and keeps valid ones", () => {
  const rules = parseEventBridgeRules([{ pattern: "p", category: "c", title: "t", message: "m", owner: "herd:x" }], warn);
  expect(rules.length).toBe(0);
});
```

Use the suite's existing harness for driving `startNotifyBridge`.

- [ ] **Step 2: Run to verify failure** ... `bun test lib/__tests__/notify-bridge.test.ts`

- [ ] **Step 3: Implement**

- `parseEventBridgeRules`: accept optional `owner`, only the literal `"human"`, warn-and-skip otherwise.
- In the rule loop of `onEvent`, after the `subjectPrefix` check: `if (rule.owner === "human") { const owner = payload.owner; if (typeof owner === "string" && owner.startsWith("herd:")) continue; }`.
- Registry description: document `owner?` and note the intended pair of rules (a `gate/opened/**` rule with `owner: "human"`, plus a `gate/escalated/**` rule without it). The default stays `[]`; the user's own settings carry the actual rules.

- [ ] **Step 4: Run to verify pass** ... `bun test lib/__tests__/notify-bridge.test.ts packages/rt-client`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "notify-bridge: owner filter so herd-owned gates skip human notifications" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: presentation required for pane origins, surfaced everywhere

**Files:**
- Modify: `lib/daemon/handlers/gate.ts` (invalidOrigin + default), `lib/daemon/gate-push.ts` (subscription phrase), `commands/gate.ts` (list rendering)
- Test: `lib/daemon/__tests__/gates-handlers.test.ts`, `lib/daemon/__tests__/gate-push.test.ts`, e2e file from Task 3

**Interfaces:**
- Consumes: existing `origin.presentation` validation (`form|wait`), Task 2's owner on rows.
- Produces: pane-origin opens without `presentation` are rejected with exact error `pane origin requires presentation ("form" or "wait")`. Non-pane origins default to `presentation: "wait"` before storing. `GATE_SUBSCRIPTION_PHRASE(row)` becomes `[gate] <id> is now <status> (<presentation>, owner <owner>); re-read the gate registry.` where `<presentation>` falls back to `wait` and `<owner>` to `human`. `rt gate list` rows append `presentation` and `owner` columns/tokens.

- [ ] **Step 1: Write the failing tests**

```ts
test("gate:open rejects a pane origin without presentation", async () => {
  const res = await handlers["gate:open"]({ ...openPayload(), origin: { paneId: "bg:w1:p1" } });
  expect(res).toEqual({ ok: false, error: 'pane origin requires presentation ("form" or "wait")' });
});

test("gate:open defaults non-pane origins to wait", async () => {
  const res = await handlers["gate:open"]({ ...openPayload(), origin: { runId: "r-1" } });
  expect(store.get((res as any).data.id)?.origin?.presentation).toBe("wait");
});

test("subscription phrase names presentation and owner", () => {
  expect(GATE_SUBSCRIPTION_PHRASE({ id: "g", status: "open", origin: { presentation: "form" }, owner: "herd:h-1" } as any))
    .toBe("[gate] g is now open (form, owner herd:h-1); re-read the gate registry.");
});
```

- [ ] **Step 2: Run to verify failure** ... `bun test lib/daemon/__tests__/gates-handlers.test.ts lib/daemon/__tests__/gate-push.test.ts`

- [ ] **Step 3: Implement**

- `invalidOrigin`: when `paneId` is a non-empty string and `presentation` is `undefined`, return the exact error string above (existing checks for invalid values stay).
- `gate:open`: after validation, `const origin = payload?.origin ? { presentation: "wait" as const, ...payload.origin } : undefined;` and store that (spread order makes an explicit presentation win).
- `GATE_SUBSCRIPTION_PHRASE`: widen its parameter to include `origin`/`owner` and render the parenthetical; update `fanOut`'s caller (it already has the full row).
- `commands/gate.ts` list: append presentation and owner to each rendered row where present (follow the file's existing column style; `--json` output is the raw rows and needs no change).
- The existing gate-push/e2e assertions on the OLD phrase will fail: update them to the new exact string in the same commit (this is the deliberate verbatim change, pinned in e2e).

- [ ] **Step 4: Run to verify pass** ... `bun test lib/daemon lib/__tests__` then `bun run test:e2e`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "gates: pane origins require presentation; phrase and list surface it with owner" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: herd status push probe and resume gate count

**Files:**
- Modify: `lib/daemon/handlers/herd.ts`, `commands/herd.ts`
- Test: the herd handlers suite

**Interfaces:**
- Consumes: `resolveSession`-style inbox resolution already available to the daemon (`resolveInbox` in `lib/daemon.ts`; thread it into herd handler deps as `probeInbox: (session: string) => Promise<"reachable" | "unreachable">`).
- Produces: `herd:status` data gains `push: { state: "reachable" | "unreachable"; lastDelivery: <existing subscription lastDelivery or null> }`. `herd:resume`'s `gates` uses the same job-worktree matching as `herd:gates` (extract that filter into a shared `listHerdRunGates(herdId)` inside the handler module and call it from both, adding the herd-prefix gates to resume's count).

- [ ] **Step 1: Write the failing tests**

```ts
test("herd:status reports push reachability from the probe", async () => {
  const handlers = makeHerdHandlers({ probeInbox: async () => "unreachable" });
  const res = await handlers["herd:status"]({ herd: seededHerdId });
  expect((res as any).data.push.state).toBe("unreachable");
});

test("herd:resume counts run gates belonging to the herd's jobs", async () => {
  // seed one herd job whose worktree matches an open run: gate, one foreign run: gate
  const res = await handlers["herd:resume"](resumePayload());
  expect((res as any).data.gates.length).toBe(2); // 1 herd-prefix + 1 owned run gate
});
```

- [ ] **Step 2: Run to verify failure** ... herd suite.

- [ ] **Step 3: Implement**

- `probeInbox` default: resolve the session binding; no binding → `"unreachable"`; with a binding, attempt a socket connect with a 250ms timeout (`Bun.connect` wrapped in a promise race) and close immediately; errors → `"unreachable"`. Wire the real implementation where herd handlers are constructed (follow how `deps.gate` is injected).
- `statusData`: add the `push` field; keep the existing `subscription` field so nothing consuming it breaks; `commands/herd.ts` status rendering prints `push: reachable|unreachable (last delivery <age|never>)` instead of headlining `dead`.
- Extract `herd:gates`'s run-gate filter (`handlers/herd.ts:363` area) into `listHerdRunGates(herdId)`; `herd:resume` returns herd-prefix gates plus these.

- [ ] **Step 4: Run to verify pass** ... herd suite + `bun run test` for command rendering fallout.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "herd: status probes the push channel; resume counts owned run gates" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: chat dm success line and outbound presence touch

**Files:**
- Modify: `commands/chat.ts`, `lib/daemon/handlers/chat.ts`
- Test: chat handler suite; the e2e chat file (exact dm line)

**Interfaces:**
- Produces: non-`--json` `rt chat dm` success prints exactly `dm → <handle> #<messageId>` (one line; when `chat.viewerUrl` is set, keep the existing link suffix behavior consistent with `post`). `chat:post` (both room posts and dms), `chat:ack`, and `chat:read` call `touchLastSeen` for the ACTING session's presence row (the sender/reader), alongside the existing arrival-side calls.

- [ ] **Step 1: Write the failing tests**

Handler test: after a `chat:post` by session S, S's presence `lastSeenAt` advanced (read through the presence store the suite already uses). e2e test: run `rt chat dm <handle> "hi"` against the fixture daemon and assert the exact stdout line.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In `handlers/chat.ts`, the post/ack/read verbs know the caller's session id; add `touchLastSeen` calls mirroring the delivery-side ones (same persistOrWarn wrapping). In `commands/chat.ts`, print the success line for dm (grep how `post` prints its confirmation and match its style and viewer-link handling).

- [ ] **Step 4: Run to verify pass** ... chat suites + `bun run test:e2e`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chat: dm success line; outbound activity touches presence" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: rt runs --repo resolves aliases and errors on unknown

**Files:**
- Modify: `commands/runs.ts`, `lib/runs/store.ts`
- Test: `lib/runs/__tests__/` (or wherever the runs store suite lives; create `store-repo-filter.test.ts` beside the store if none)

Before implementing, load the `rt:repo-identity` skill and read `docs/repo-identity.md`: this task converts between the serialized identity and the display key, and that doc names the right helper for each direction.

**Interfaces:**
- Produces: `resolveRunsRepoArg` maps a successfully resolved identity to the run-dir display key (rt-client's identity codec / display-key helper). `listRuns(repo)` is unchanged in signature. `commands/runs.ts` exits with error `unknown repo: <arg>` (stderr, exit 1; `--json` gets `{ ok: false, error: "unknown repo: <arg>" }`) when the arg neither resolves through the identity resolver nor names an existing run directory. A valid repo with zero runs still prints `no runs` exactly as today.

- [ ] **Step 1: Write the failing tests** ... unit: resolved identity for a known repo lists the same runs as the raw display key; unknown arg produces the error envelope (drive the command's resolver function directly, not a subprocess).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** ... in `resolveRunsRepoArg`, on resolver success derive the display key and return it; on `UnresolvedRepoArg`, keep the raw arg only if `lib/runs/store.ts`'s dir listing contains it, else throw the typed error the command maps to `unknown repo: <arg>`.

- [ ] **Step 4: Run to verify pass** ... runs suites + non-TTY behavior check: `bun run cli.ts runs --repo definitely-not-a-repo --json` prints the error envelope with exit 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "runs: --repo resolves aliases to the run-dir key and errors on unknown" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: non-terminal-run guards on herd close and worktree dispose

**Files:**
- Modify: `lib/runs/store.ts` (helper), `lib/daemon/handlers/herd.ts` (`herd:close`), `lib/worktree/dispose.ts`, `commands/herd.ts` (warning print)
- Test: runs store suite, herd suite, `lib/worktree/__tests__/dispose.test.ts` (existing dispose suite)

**Interfaces:**
- Produces: `findRunningRunByWorktree(worktree: string): { id: string; currentStage: string } | null` in `lib/runs/store.ts` (scan `listRuns()` for `status === "running"` and a matching worktree field). `herd:close` result data gains `warning?: string` shaped exactly `job worktree has running run <id> at <stage>; finish it or run: rt runs abandon <id>`; the CLI prints it after the closed line. `disposeTree` gains a `running-run` refusal in the `if (!force)` guard chain, refusal message naming the run id and the same abandon pointer; `--force` skips it like its siblings.

- [ ] **Step 1: Write the failing tests** ... store helper finds a seeded running run by worktree and returns null for done runs; `herd:close` on a job whose worktree has a running run returns the warning verbatim; `disposeTree` without force refuses with reason `running-run`, with force proceeds.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** exactly per Interfaces; in `dispose.ts` place the check after `unpushed` and before `attended` so `--force` semantics match the neighbors.

- [ ] **Step 4: Run to verify pass** ... the three suites.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "runs guard: herd close warns and dispose refuses on a running run" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: dead-subscription pruning in the gates sweep

**Files:**
- Modify: `lib/daemon/gates-store.ts` (call `pruneDeadSubscriptions` from `sweep()`)
- Test: `lib/daemon/__tests__/gates-store.test.ts`

**Interfaces:** `sweep()` additionally prunes dead subscription rows older than a 24h constant (`DEAD_SUBSCRIPTION_RETENTION_MS = 24 * 60 * 60 * 1000`), logging the count at info when nonzero. (The sweep is already scheduled hourly in `lib/daemon.ts`; no wiring change.)

- [ ] **Step 1: Failing test:** a dead subscription with `lastDelivery.at` 25h ago disappears after `sweep()`; one 1h ago survives.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (one call inside `sweep()` with the constant).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**

```bash
git add lib/daemon/gates-store.ts lib/daemon/__tests__/gates-store.test.ts
git commit -m "gates sweep: prune dead subscription rows after 24h" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: claimview pack migration (mattstack-skills repo)

**Files (in `~/Documents/GitHub/mattstack-skills`, NOT this repo):**
- Modify: the claimview team pack's shepherdr skill sources: `scripts/herd-init.py` and the skill text that instructs `rt gate subscribe --subject-prefix run:`
- Modify: the pack's gate-open templates (pipeline stage gates)

Before touching anything there, load the `mattstack:editing-skills` skill (compiled/vendored pipeline verbs have their own edit-and-promote flow) and work on a branch in that repo.

**Interfaces:**
- Consumes: `rt herd start` auto-subscription (Task 4), pane-origin presentation requirement (Task 7).
- Produces: herd-init drives `rt herd start` (visible or hidden per its current flag) instead of raw pane spawning, so every spawned run carries `spawned_by=herd:<id>`; the manual machine-global `rt gate subscribe --subject-prefix run:` instruction is REMOVED from the skill text (replaced by a sentence stating the subscription is automatic); every `rt gate open` template gains `presentation` in its `--origin` JSON (`"form"` for gates presented as pane forms, `"wait"` for background-wait gates).

- [ ] **Step 1:** Read the pack's current herd-init and skill text; list every `gate open`/`gate subscribe` call site in a scratch note.
- [ ] **Step 2:** Make the three changes above; run the pack's own check (`rt skills check` per the editing-skills skill).
- [ ] **Step 3:** Commit in that repo on a branch, PR per that repo's flow, and report the PR URL in the task report. Do NOT merge; Matt gates pack releases.

---

### Task 14: whole-branch verification

**Files:** none (verification only)

- [ ] **Step 1:** `bun install` (once, if not already done this session).
- [ ] **Step 2:** `bun run test:all` ... full unit + e2e. Everything green; any failure is triaged against its task, fixed there, and re-run.
- [ ] **Step 3:** `bun run picker:check` (new `gate answer` flags touched the command tree).
- [ ] **Step 4:** `scripts/repo-purity.sh` passes.
- [ ] **Step 5:** `cd packages/rt-client && bun run build && cd -` then `bun test packages/rt-client` (dist freshness).
- [ ] **Step 6:** Commit anything the verification fixed; report suite counts in the final report.

## Self-review notes

- Spec coverage: ownership (T1-T2), enforcement + superseded rejection (T3), routing + auto-subscribe (T4), escalation + TTL setting (T5), notification suppression (T6), wait-mode (T7), herd status/resume honesty (T8), dm line + presence (T9), runs filter (T10), close/dispose guards (T11), subscription pruning (T12), pack companion (T13). Every spec section maps to a task.
- Exact strings that are contracts: the two refusal texts (T3), the subscription phrase (T7), the dm line (T9), `unknown repo: <arg>` (T10), the close warning (T11). Each is pinned in a test at its task.
- Type consistency: `owner` is `string | null` on rows, values `"human" | "herd:<id>"`; `scope` is `"prefix" | "owner"`; `ownerRef` is `string | null`. Tasks 2-6 all use these exact shapes.
