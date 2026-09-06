# Gate Facility W4: Plumbing Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every gate answerable on sight from any surface (labels, context, and a path back to the live pane travel in the registry row) and make herdr panes form-first, completed remotely by a doorbell plus one injected Escape.

**Architecture:** Three additive fields (labeled options, context, origin) land on the rt daemon's gate row and its `gate/opened` event payload; the daemon's answer delivery gains an ordered doorbell-then-Escape step that drives herdr's existing `pane.send_keys` verb. Surfaces (board, console) learn to render the new fields and resolve focus from the row's origin, then openers (board status-bin + wrapper skills, engine gate-protocol part) start emitting them. Deploy ordering is normative: surfaces before openers, engine last.

**Tech Stack:** Bun + TypeScript everywhere except herdr (Rust, NO changes needed). rt daemon/CLI/rt-client with `bun:test` and SQLite via `bun:sqlite`; board server + status-bin (Bun) with a React/tui-kit client, `bun:test`; console Hono server + React/Mantine (app-kit) client, vitest + testing-library; engine = markdown skill parts certified by `tests/certify.sh`.

**Spec:** docs/superpowers/specs/2026-09-05-gate-facility-w4-design.md

## Global Constraints

- Every push, merge, publish, and plugin update is individually Matt-gated (the MATT GATE tasks; do not proceed past one without explicit approval).
- Repo purity: no real employer, team, or person names in tracked files (fixtures and tests included; use placeholder hosts like `gitlab.example.com` and names like `acme`).
- Surface deploys MUST precede opener adoption: labeled options from new openers crash un-updated surfaces. Task order in this plan IS that ordering; it is normative, not advisory.
- CAS answer semantics are untouched; the registry remains the ONLY authority for answers. Doorbell messages and injected keys never carry answer content.
- No em or en dashes in any tracked prose, commit message, or code comment. Engine SKILL.md prose uses the house `--` style.
- Caps are UTF-8 bytes: option label max 200, context max 8192. Openers pre-check; the daemon rejection is the backstop.
- Comments in code only where a constraint cannot be expressed in code. Never cite review rounds, task numbers, or process artifacts in source.

**Repos** (executors provision a worktree per repo at execution time; every path below is repo-relative and tagged with its repo):

| repo | canonical checkout |
|---|---|
| rt | `~/Documents/GitHub/repo-tools` |
| board | `~/Documents/GitHub/board` |
| console | `~/Documents/GitHub/console` |
| engine | `~/Documents/GitHub/mattstack-skills` |
| herdr | `~/Documents/GitHub/herdr` (read-only; no task modifies it) |

**Shared vocabulary produced by this plan** (referenced across tasks):

- `GateOption = string | { value: string; label: string }`; `gateOptionValue(o)` returns the string or `o.value`.
- `GateOrigin = { paneId?, tabId?, runId?, worktree?, presentation? }`, presentation `"form" | "wait"`, absent means wait.
- Form option cap: `FORM_OPTION_CAP = 4` options per question; any question over it forces `presentation: "wait"`.
- Respond collapse: kind `respond-plan`, question id `code-changes`, sentinel option value `skip`.
- Stop-hook marker: run field key `waiting-gate`, cleared by writing the value `-`.

---

## Lane map

- Task 1: SPIKE (go/no-go)
- Tasks 2-4: rt lane; Task 5: MATT GATE (rt merge + rt-client publish)
- Tasks 6-9: board surface; Tasks 10-11: console surface; Task 12: MATT GATE (surface deploys)
- Tasks 13-14: board opener; Task 15: MATT GATE (board opener deploy)
- Tasks 16-18: engine lane; Task 19: MATT GATE (engine release + pack recompile)
- Task 20: live verification (with Matt)

---

### Task 1: Delivery spike in a live herdr pane [SPIKE lane]

**Files:**
- Create: nothing tracked. Any harness text lives in the scratchpad and is thrown away. Findings go in the task report, not the repo.

**Interfaces:**
- Consumes: the LIVE rt daemon (W1-W3 shipped: `rt gate open/answer` with `--nudge`), herdr's CLI (`herdr pane send-keys <pane_id> <key>`), a scratch Claude session in a herdr pane.
- Produces: a go/no-go verdict on the Escape-injection delivery design. **A NO verdict on step (b) or (c) STOPS THE PLAN**: report to the coordinator and do not start Task 2. The rt delivery design (Task 3) assumes both.

The 2026-09-03 spike proved a doorbell frame queues behind a pending AskUserQuestion form and that nothing socket-deliverable dismisses one; it never sent keys, so the injection half is genuinely unproven. This spike proves it or kills it.

- [ ] **Step 1: Set up the target pane.** Open (or pick) a herdr pane running `claude`. Inside it, run `echo $CLAUDE_CODE_SESSION_ID` and note the session id as SID. From any terminal run `herdr pane list` and note the pane id as PANE. Paste this priming prompt into the pane, verbatim:

```
You are a spike harness. When I say GO: present a structured question
(AskUserQuestion) with the single question "Pick one" and exactly the
options "option-a" and "option-b". Do not answer it yourself. If you ever
receive a message saying a gate was answered elsewhere, treat it as a
verify-only signal: run `rt gate wait <the gate id> --timeout 2s`, say
which answer is recorded, and stop. Never invent an answer.
```

- [ ] **Step 2: Open a nudged gate.** From a second terminal:

```bash
rt gate open --subject spike:w4 --kind spike-form \
  --questions '[{"id":"pick","label":"Pick one","multi":false,"options":["option-a","option-b"]}]' \
  --nudge "{\"session\":\"<SID>\"}"
```

Note the returned id as GATE. Tell the pane `GO. The gate id is <GATE>.` and confirm the form is up.

- [ ] **Step 3: Verify (a) the doorbell queues.** From the second terminal: `rt gate answer <GATE> --answers '{"pick":"option-b"}' --by console`. Watch the pane for 30 seconds: the form must remain up and undismissed (the doorbell frame is queued behind it). Record PASS/FAIL.

- [ ] **Step 4: Verify (b) injected Escape dismisses the form.** Run `herdr pane send-keys <PANE> escape`. The pending form must dismiss. Record PASS/FAIL. FAIL here is a NO verdict.

- [ ] **Step 5: Verify (c) the queued doorbell delivers next and re-invokes.** After the dismissal, the queued doorbell frame must arrive as the pane's next input and the pane must act on it (per the priming: read the registry, report option-b). Record PASS/FAIL. FAIL here is a NO verdict.

- [ ] **Step 6: Verify (d) the mid-submission interleave recovers.** Re-run steps 1-2 with a fresh gate (new GATE2, same SID). This time, answer the form IN the pane (pick option-a) and, while the pane is mid-turn processing it, immediately run the remote answer from the second terminal (`--answers '{"pick":"option-b"}' --by console`), then `herdr pane send-keys <PANE> escape`. The Escape lands mid-turn and interrupts; the queued doorbell must still deliver and the pane must converge on whichever answer won CAS (the registry row is the check: `rt gate wait <GATE2> --timeout 2s`). Record what happened.

- [ ] **Step 7: Verify (e) a late Escape is harmless.** With no form pending and the pane idle at its prompt, run `herdr pane send-keys <PANE> escape` once. Nothing should break (an idle Escape is inert). Record PASS/FAIL.

- [ ] **Step 8: Report.** Write the five PASS/FAIL results plus observed nuances into the task report and state the verdict: GO (proceed to Task 2) or NO-GO (stop the plan and report). Clean up: `rt gate close <GATE> --reason abandoned` for any gate still open (answered ones need nothing).

---

### Task 2: rt registry schema: labeled options, context, origin, event payload [rt lane]

**Files:**
- Modify: `packages/rt-client/src/commands.ts:95-110` (types), `:577` (gate:open payload)
- Modify: `packages/rt-client/src/client.ts:449-456` (gateOpen whitelist)
- Modify: `packages/rt-client/src/index.ts` (export the two option helpers)
- Modify: `lib/daemon/gates-store.ts` (columns, migration, row mapping, open input)
- Modify: `lib/daemon/handlers/gate.ts` (validation, value-only membership, event payload)
- Test: `lib/daemon/__tests__/gates-handlers.test.ts`, `lib/daemon/__tests__/gates-store.test.ts`

**Interfaces:**
- Consumes: existing `GateRow`/`GateQuestion` shapes (`packages/rt-client/src/commands.ts:98-109`), `createGatesStore` (`lib/daemon/gates-store.ts:161`), `createGateHandlers` (`lib/daemon/handlers/gate.ts:98`).
- Produces (later tasks rely on these exact names):
  - `type GateOption = string | { value: string; label: string }` (commands.ts)
  - `interface GateOrigin { paneId?: string; tabId?: string; runId?: string; worktree?: string; presentation?: "form" | "wait" }` (commands.ts)
  - `GateQuestion.options: GateOption[]`
  - `GateRow.context?: string | null` and `GateRow.origin?: GateOrigin | null` (OPTIONAL on the wire type, see Step 4)
  - `Commands["gate:open"]["payload"]` gains `context?: string; origin?: GateOrigin`
  - `gateOptionValue(o: GateOption): string` and `gateOptionLabel(o: GateOption): string`, exported from `@mattstack/rt-client`
  - `gate/opened` event payload gains `context` and `origin`
  - open-time rejections: `option label exceeds 200 bytes (question "<id>")`, `context exceeds 8192 bytes`, `origin must be an object of string fields with presentation form|wait`

- [ ] **Step 1: Write the failing handler tests.** Append to `lib/daemon/__tests__/gates-handlers.test.ts` (harness and `qs()` already exist in the file):

```ts
describe("gate:open W4 fields", () => {
  test("accepts {value,label} options; membership validates against value only", async () => {
    const { handlers } = harness();
    const r = await handlers["gate:open"]({
      subject: "run:r1", kind: "clarify",
      questions: [{ id: "q", label: "Pick", multi: false, options: [{ value: "a", label: "Option A (2)" }, "b"] }],
    });
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    const byLabel = await handlers["gate:answer"]({ id, answers: { q: "Option A (2)" }, by: "console" });
    expect(byLabel.ok).toBe(false);
    const byValue = await handlers["gate:answer"]({ id, answers: { q: "a" }, by: "console" });
    expect(byValue.ok).toBe(true);
  });

  test("rejects an option label over 200 bytes, naming the cap", async () => {
    const { handlers } = harness();
    const r = await handlers["gate:open"]({
      subject: "run:r1", kind: "clarify",
      questions: [{ id: "q", label: "Pick", multi: false, options: [{ value: "a", label: "x".repeat(201) }] }],
    });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("200 bytes");
  });

  test("rejects context over 8192 bytes, naming the cap; accepts one at the cap", async () => {
    const { handlers } = harness();
    const over = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: qs(), context: "x".repeat(8193) });
    expect(over.ok).toBe(false);
    expect((over as { error: string }).error).toContain("8192 bytes");
    const at = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", context: "x".repeat(8192), questions: qs() });
    expect(at.ok).toBe(true);
  });

  test("stores context and origin, serves them on the row AND the opened event payload", async () => {
    const { handlers, store, emitted } = harness();
    const origin = { paneId: "p1", worktree: "/tmp/wt", presentation: "form" as const };
    const r = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: qs(), context: "the material", origin });
    const id = (r as { data: { id: string } }).data.id;
    const row = store.get(id)!;
    expect(row.context).toBe("the material");
    expect(row.origin).toEqual(origin);
    const opened = emitted.find((e) => e.topic === `gate/opened/${id}`)!;
    expect((opened.payload as { context: string }).context).toBe("the material");
    expect((opened.payload as { origin: unknown }).origin).toEqual(origin);
  });

  test("rejects a malformed origin: unknown key, non-string value, bad presentation", async () => {
    const { handlers } = harness();
    for (const origin of [{ bogus: "x" }, { paneId: 7 }, { presentation: "maybe" }]) {
      const r = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: qs(), origin: origin as never });
      expect(r.ok).toBe(false);
    }
  });

  test("old-style rows: no context/origin round-trips as null", async () => {
    const { handlers, store } = harness();
    const r = await handlers["gate:open"]({ subject: "run:r1", kind: "clarify", questions: qs() });
    const row = store.get((r as { data: { id: string } }).data.id)!;
    expect(row.context).toBeNull();
    expect(row.origin).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing store migration test.** Append to `lib/daemon/__tests__/gates-store.test.ts` (add `import { Database } from "bun:sqlite";` to its imports; `dirs`, `log`, `qs()` idioms already exist there, mirror them):

```ts
test("an existing gates.db without the W4 columns gains them on open (ALTER migration)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-gates-migrate-"));
  dirs.push(dir);
  const path = join(dir, "gates.db");
  const raw = new Database(path, { create: true });
  raw.exec(`
    CREATE TABLE gates (
      id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL,
      questions TEXT NOT NULL, meta TEXT, status TEXT NOT NULL, answer TEXT,
      openedAt INTEGER NOT NULL, parkedAt INTEGER, closedAt INTEGER,
      closedReason TEXT, agent TEXT, pane TEXT, nudge TEXT, delivery TEXT,
      released INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE gate_subscriptions (
      id TEXT PRIMARY KEY, subjectPrefix TEXT NOT NULL, session TEXT NOT NULL,
      createdAt INTEGER NOT NULL, lastDelivery TEXT, dead INTEGER NOT NULL DEFAULT 0
    );
  `);
  raw.close();
  const store = createGatesStore({ dbPath: path, log });
  const row = store.open({
    subject: "run:r1", kind: "k", questions: qs(),
    context: "why", origin: { presentation: "form", paneId: "p1" },
  }).row;
  expect(row.context).toBe("why");
  expect(row.origin).toEqual({ presentation: "form", paneId: "p1" });
  store.close_();
});
```

- [ ] **Step 3: Run both suites to verify they fail.**

Run: `bun test lib/daemon/__tests__/gates-handlers.test.ts lib/daemon/__tests__/gates-store.test.ts`
Expected: FAIL (type errors on `context`/`origin`/object options; the migration test fails on missing columns).

- [ ] **Step 4: Add the types.** In `packages/rt-client/src/commands.ts`, replace line 98 (`export interface GateQuestion ...`) with:

```ts
export type GateOption = string | { value: string; label: string };
export interface GateOrigin {
  paneId?: string;
  tabId?: string;
  runId?: string;
  worktree?: string;
  presentation?: "form" | "wait";
}
export interface GateQuestion { id: string; label: string; multi: boolean; options: GateOption[] }
export function gateOptionValue(o: GateOption): string {
  return typeof o === "string" ? o : o.value;
}
export function gateOptionLabel(o: GateOption): string {
  return typeof o === "string" ? o : (o.label || o.value);
}
```

In `GateRow` (line 100-110) add, after the `meta` field:

```ts
  context?: string | null;
  origin?: GateOrigin | null;
```

The fields are OPTIONAL on the wire type deliberately: every full `GateRow` fixture literal across rt, board, and console stays type-valid with zero churn, while `rowToGate` (Step 5) still always sets both, so runtime consumers can rely on their presence on daemon-served rows.

In `Commands["gate:open"]` (line 577) extend the payload type with `context?: string; origin?: GateOrigin;`. In `packages/rt-client/src/client.ts:454`, extend the whitelist loop to `["meta", "agent", "pane", "nudge", "context", "origin"] as const`. In `packages/rt-client/src/index.ts`, add `gateOptionValue` and `gateOptionLabel` to the exports from `./commands.ts` (types like `GateOption`/`GateOrigin` flow through the existing type re-export the same way `GateRow` does).

- [ ] **Step 5: Store columns + migration.** In `lib/daemon/gates-store.ts`:
  - `GateColumns` (line 74-91): add `context: string | null;` and `origin: string | null;`.
  - CREATE TABLE (line 190-208): add `context TEXT,` and `origin TEXT,` after the `delivery TEXT,` line.
  - Immediately after the `db.exec` CREATE block, add the idempotent migration:

```ts
  const gateCols = new Set(
    (db.query("PRAGMA table_info(gates)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const col of ["context", "origin"]) {
    if (!gateCols.has(col)) db.exec(`ALTER TABLE gates ADD COLUMN ${col} TEXT;`);
  }
```

  - `insertStmt` (line 222-227): add the two columns and two `?` slots (keep `status`/`answer`/`released` literals as they are):

```ts
  const insertStmt = db.prepare(`
    INSERT INTO gates (
      id, subject, kind, questions, meta, status, answer,
      openedAt, parkedAt, closedAt, closedReason, agent, pane, nudge, delivery, released,
      context, origin
    ) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, NULL, NULL, NULL, ?, ?, ?, NULL, 0, ?, ?)
  `);
```

  - `openTxn` input (line 278-288): add `context: string | null; origin: string | null;` and pass both to `insertStmt.run` (after `nudge`).
  - `rowToGate` (line 113-132): add `context: row.context ?? null,` and `origin: row.origin == null ? null : JSON.parse(row.origin),`.
  - `GatesStore.open` input (line 43-51): add `context?: string; origin?: GateOrigin;` (import `GateOrigin` alongside the other type imports from `../../packages/rt-client/src/commands.ts` and re-export it with the others at line 23-24).
  - `open()` (line 353-373): pass `context: input.context ?? null, origin: input.origin ? JSON.stringify(input.origin) : null` into `openTxn`.

- [ ] **Step 6: Handler validation + event payload.** In `lib/daemon/handlers/gate.ts`:
  - The existing rt-client import (line 8) is `import type` and the repo compiles under `verbatimModuleSyntax`, so the VALUE import gets its own statement: add `import { gateOptionValue } from "../../../packages/rt-client/src/commands.ts";` and extend the existing `import type` line with `GateOrigin`.
  - Add near the existing validators (below `isPlainObject`, line 51):

```ts
const LABEL_CAP_BYTES = 200;
const CONTEXT_CAP_BYTES = 8192;

function isValidOption(o: unknown): boolean {
  if (typeof o === "string") return true;
  if (!isPlainObject(o)) return false;
  return typeof o.value === "string" && o.value.length > 0 && typeof o.label === "string";
}

function oversizedLabel(questions: GateQuestion[]): string | null {
  for (const q of questions) {
    for (const o of q.options) {
      if (typeof o !== "string" && Buffer.byteLength(o.label, "utf8") > LABEL_CAP_BYTES) {
        return `option label exceeds ${LABEL_CAP_BYTES} bytes (question "${q.id}")`;
      }
    }
  }
  return null;
}

const ORIGIN_STRING_KEYS: ReadonlySet<string> = new Set(["paneId", "tabId", "runId", "worktree"]);

function isValidOrigin(v: unknown): v is GateOrigin {
  if (!isPlainObject(v)) return false;
  for (const [key, val] of Object.entries(v)) {
    if (key === "presentation") {
      if (val !== "form" && val !== "wait") return false;
      continue;
    }
    if (!ORIGIN_STRING_KEYS.has(key) || typeof val !== "string") return false;
  }
  return true;
}
```

  - In `isValidQuestion` (line 38-47), replace the options check with `Array.isArray(cand.options) && cand.options.every(isValidOption)`.
  - In `validateAnswers` (line 87-90), replace the membership block with value-only comparison:

```ts
    if (question.options.length > 0) {
      const members = question.options.map(gateOptionValue);
      for (const v of values as string[]) {
        if (!members.includes(v)) return `answer for "${qid}" is not one of its options: "${v}"`;
      }
    }
```

  - In `gate:open` (after the nudge validation, line 158-160), add:

```ts
      const labelError = oversizedLabel(questions);
      if (labelError) return { ok: false as const, error: labelError };
      if (payload?.context !== undefined) {
        if (typeof payload.context !== "string") return { ok: false as const, error: "context must be a string" };
        if (Buffer.byteLength(payload.context, "utf8") > CONTEXT_CAP_BYTES) {
          return { ok: false as const, error: `context exceeds ${CONTEXT_CAP_BYTES} bytes` };
        }
      }
      if (payload?.origin !== undefined && !isValidOrigin(payload.origin)) {
        return { ok: false as const, error: "origin must be an object of string fields with presentation form|wait" };
      }
```

  - Pass both through `store.open` (line 162-165): add `context: payload?.context, origin: payload?.origin,`.
  - Extend the opened `eventPayload` (line 170-173) with `context: row.context, origin: row.origin,`.

- [ ] **Step 7: Run green.**

Run: `bun test lib/daemon/__tests__/ commands/__tests__/gate.test.ts packages/rt-client && bunx tsc --noEmit`
Expected: PASS on both (the pre-existing suites must stay green; string options are unchanged behavior; `bun test` alone does not typecheck, and rt CI runs `bunx tsc --noEmit`, so the lane gates it here).

- [ ] **Step 8: Commit.**

```bash
git add packages/rt-client/src lib/daemon
git commit -m "gates: labeled options, context, and origin on the row and the opened event"
```

---

### Task 3: rt delivery: doorbell-then-Escape via herdr send_keys [rt lane]

**Files:**
- Create: `lib/daemon/gate-escape.ts`
- Modify: `lib/daemon/gate-push.ts:41-146`
- Modify: `lib/daemon.ts:558-564` (wiring)
- Test: `lib/daemon/__tests__/gate-push.test.ts`

**Interfaces:**
- Consumes: Task 2's `GateRow.origin`; `GATE_BY_PANE` (`packages/rt-client/src/commands.ts:95`, re-exported by `lib/daemon/gates-store.ts:24`); `herdrRequest` (`lib/herdr/client.ts:28`); herdr's existing `pane.send_keys` verb (accepts the key name `escape`; no herdr changes).
- Produces:
  - `type EscapeInjector = (paneId: string) => Promise<{ ok: true } | { ok: false; error: string }>` and `createEscapeInjector(herdr?)` in `lib/daemon/gate-escape.ts`
  - `createGatePush` accepts optional `injectEscape: EscapeInjector`
  - Delivery contract: the Escape fires ONLY when the doorbell was accepted (`delivered`), `row.origin.presentation === "form"`, `row.origin.paneId` is set, and `row.answer.by !== "pane"`. Injection failure is logged, never thrown; delivery outcomes stay `delivered`/`dead-pane`.

Do NOT route through `injectIntoPane` (`lib/daemon/inject.ts:27`): it refuses panes whose agent status is blocked, and a pane with a pending form is exactly that state.

- [ ] **Step 1: Write the failing tests.** Append to `lib/daemon/__tests__/gate-push.test.ts` (reuse its `freshStore`, `qs`, `log`):

```ts
function w4Harness(opts: { deliverOk?: boolean; injectOk?: boolean; withInjector?: boolean } = {}) {
  const store = freshStore();
  const events: string[] = [];
  const deliver = async (_socketPath: string, _body: string) => {
    events.push("deliver");
    return opts.deliverOk === false ? { ok: false as const, error: "boom" } : { ok: true as const };
  };
  const injectEscape = async (paneId: string) => {
    events.push(`inject:${paneId}`);
    return opts.injectOk === false
      ? { ok: false as const, error: "pane_not_found: gone" }
      : { ok: true as const };
  };
  const push = createGatePush({
    store,
    deliver,
    resolveSession: (sessionId) => ({ socketPath: sessionId }),
    log,
    ...(opts.withInjector === false ? {} : { injectEscape }),
  });
  return { push, store, events };
}

function answeredFormGate(store: GatesStore, by: string, origin?: Record<string, unknown>) {
  const row = store.open({
    subject: "mr:https://gitlab.example.com/x/1", kind: "review-post", questions: qs(),
    nudge: { session: "sess-1" }, pane: "pane-7",
    origin: (origin ?? { presentation: "form", paneId: "pane-7" }) as never,
  }).row;
  store.answer(row.id, { q: "a" }, by);
  return store.get(row.id)!;
}

describe("gate-push escape injection (W4)", () => {
  test("injects Escape to origin.paneId strictly AFTER the doorbell accept, remote answer", async () => {
    const { push, store, events } = w4Harness();
    const row = answeredFormGate(store, "console");
    await push.onAnswered(row);
    expect(events).toEqual(["deliver", "inject:pane-7"]);
    expect(store.get(row.id)!.delivery!.outcome).toBe("delivered");
  });

  test("no injection when the pane answered its own gate", async () => {
    const { push, store, events } = w4Harness();
    await push.onAnswered(answeredFormGate(store, "pane"));
    expect(events).toEqual(["deliver"]);
  });

  test("no injection for wait presentation, missing paneId, or missing origin", async () => {
    for (const origin of [{ presentation: "wait", paneId: "pane-7" }, { presentation: "form" }, undefined]) {
      const { push, store, events } = w4Harness();
      await push.onAnswered(answeredFormGate(store, "console", origin as never));
      expect(events).toEqual(["deliver"]);
    }
  });

  test("no injection when the doorbell failed (dead-pane degrades to reconcile-at-next-touch)", async () => {
    const { push, store, events } = w4Harness({ deliverOk: false });
    const row = answeredFormGate(store, "console");
    await push.onAnswered(row);
    expect(events).toEqual(["deliver"]);
    expect(store.get(row.id)!.delivery!.outcome).toBe("dead-pane");
  });

  test("injection failure is non-fatal and leaves the delivery outcome delivered", async () => {
    const { push, store, events } = w4Harness({ injectOk: false });
    const row = answeredFormGate(store, "console");
    await push.onAnswered(row);
    expect(events).toEqual(["deliver", "inject:pane-7"]);
    expect(store.get(row.id)!.delivery!.outcome).toBe("delivered");
  });

  test("no injector wired means today's doorbell-only behavior", async () => {
    const { push, store, events } = w4Harness({ withInjector: false });
    await push.onAnswered(answeredFormGate(store, "console"));
    expect(events).toEqual(["deliver"]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `bun test lib/daemon/__tests__/gate-push.test.ts`
Expected: FAIL (`injectEscape` is not an accepted option; events arrays miss the inject entries).

- [ ] **Step 3: Implement the injector.** Create `lib/daemon/gate-escape.ts`:

```ts
import { herdrRequest } from "../herdr/client.ts";

export type EscapeInjector = (paneId: string) => Promise<{ ok: true } | { ok: false; error: string }>;

/** Drives herdr's existing pane.send_keys verb; deliberately NOT
    injectIntoPane, which refuses blocked panes, and a pane holding a
    pending form is exactly that state. Escape-only by construction: this
    is the sole key the gate delivery layer is allowed to send. */
export function createEscapeInjector(herdr: typeof herdrRequest = herdrRequest): EscapeInjector {
  return async (paneId) => {
    const res = await herdr("pane.send_keys", { pane_id: paneId, keys: ["escape"] });
    return res.ok ? { ok: true as const } : { ok: false as const, error: `${res.code}: ${res.message}` };
  };
}
```

- [ ] **Step 4: Sequence it in gate-push.** In `lib/daemon/gate-push.ts`:
  - Import: `import { GATE_BY_PANE } from "./gates-store.ts";` and `import type { EscapeInjector } from "./gate-escape.ts";`
  - `createGatePush` opts gain `injectEscape?: EscapeInjector;`; the implementation reads `opts.injectEscape` directly (no destructuring), as the replacement code below does.
  - Replace `pushToPane` (line 74-85) with:

```ts
  async function pushToPane(row: GateRow): Promise<void> {
    const sessionId = row.nudge?.session;
    if (!sessionId) return;
    const binding = resolveSession(sessionId);
    if (!binding) {
      store.markDelivery(row.id, "dead-pane");
      return;
    }
    const body = wrapCrossSession("gate-facility", GATE_ANSWERED_PHRASE(row.id));
    const ok = await safeDeliver(binding.socketPath, body, { gateId: row.id, sessionId });
    store.markDelivery(row.id, ok ? "delivered" : "dead-pane");
    // Escape only ever follows an ACCEPTED doorbell: the dismissed form's
    // next input must be the queued frame, and a dead pane has nothing
    // queued to find.
    if (!ok || !opts.injectEscape) return;
    if (row.origin?.presentation !== "form" || !row.origin.paneId) return;
    if (row.answer?.by === GATE_BY_PANE) return;
    const injected = await opts.injectEscape(row.origin.paneId);
    if (!injected.ok) {
      log.warn({ gateId: row.id, paneId: row.origin.paneId, error: injected.error }, "gate-push: escape injection failed; doorbell-only");
    }
  }
```

- [ ] **Step 5: Wire the daemon.** In `lib/daemon.ts`, add `import { createEscapeInjector } from "./daemon/gate-escape.ts";` beside the gate-push import (line 93) and extend the `createGatePush` call (line 558-564) with `injectEscape: createEscapeInjector(),`.

- [ ] **Step 6: Run green.**

Run: `bun test lib/daemon/__tests__/gate-push.test.ts lib/daemon/__tests__/gates-e2e.test.ts && bunx tsc --noEmit`
Expected: PASS on both (existing doorbell tests unchanged; new suite green).

- [ ] **Step 7: Commit.**

```bash
git add lib/daemon/gate-escape.ts lib/daemon/gate-push.ts lib/daemon.ts lib/daemon/__tests__/gate-push.test.ts
git commit -m "gates: escape injection after doorbell accept for remotely answered form gates"
```

---

### Task 4: rt CLI open flags + notify-bridge subjectPrefix [rt lane]

**Files:**
- Modify: `commands/gate.ts:39-43,78-108`
- Modify: `lib/notify-bridge.ts:17-22,96-106`
- Modify: `lib/daemon.ts:791-801` (rule parsing carries the new field)
- Test: `commands/__tests__/gate.test.ts`, `lib/__tests__/notify-bridge.test.ts`

**Interfaces:**
- Consumes: Task 2's `Commands["gate:open"]["payload"].context/origin`.
- Produces:
  - `rt gate open ... [--context <text>] [--origin <json>]` (`--context` is raw text, `--origin` is JSON)
  - `EventBridgeRule.subjectPrefix?: string`: a rule with it set matches only events whose payload `subject` is a string starting with the prefix.

- [ ] **Step 1: Write the failing tests.** Append to `commands/__tests__/gate.test.ts`, inside `describe("buildOpenPayload")`:

```ts
  test("--context is raw text and --origin is JSON, both carried through", () => {
    const payload = buildOpenPayload([
      "--subject", "run:abc123", "--kind", "approval", "--questions", "[]",
      "--context", "the failing check output",
      "--origin", '{"paneId":"p1","worktree":"/tmp/wt","presentation":"form"}',
    ]);
    expect(payload.context).toBe("the failing check output");
    expect(payload.origin).toEqual({ paneId: "p1", worktree: "/tmp/wt", presentation: "form" });
  });
```

Append to `lib/__tests__/notify-bridge.test.ts` (reuse its `fakeBus` and rule idiom):

```ts
describe("subjectPrefix rule filter", () => {
  const RUN_RULE: EventBridgeRule = {
    pattern: "gate/opened/*", category: "gate", title: "gate", message: "{subject}", subjectPrefix: "mr:",
  };

  test("a rule with subjectPrefix fires only for matching subjects", async () => {
    const bus = fakeBus();
    const enqueued: NotificationEvent[] = [];
    startNotifyBridge({ onBroadcast: bus.onBroadcast, rules: () => [RUN_RULE], enqueue: (e) => enqueued.push(e), paneFocused: async () => false });
    await bus.emit("event", { id: 1, topic: "gate/opened/g1", payload: { subject: "run:r1" }, emittedAt: 0 });
    expect(enqueued.length).toBe(0);
    await bus.emit("event", { id: 2, topic: "gate/opened/g2", payload: { subject: "mr:https://gitlab.example.com/x/1" }, emittedAt: 0 });
    expect(enqueued.length).toBe(1);
  });

  test("a subjectPrefix rule skips events with no string subject", async () => {
    const bus = fakeBus();
    const enqueued: NotificationEvent[] = [];
    startNotifyBridge({ onBroadcast: bus.onBroadcast, rules: () => [RUN_RULE], enqueue: (e) => enqueued.push(e), paneFocused: async () => false });
    await bus.emit("event", { id: 3, topic: "gate/opened/g3", payload: {}, emittedAt: 0 });
    expect(enqueued.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `bun test commands/__tests__/gate.test.ts lib/__tests__/notify-bridge.test.ts`
Expected: FAIL (payload lacks context/origin; subjectPrefix is not filtered, so the run: event enqueues).

- [ ] **Step 3: Implement.** In `commands/gate.ts`: add `"--context", "--origin"` to `FLAGS_WITH_VALUES` (line 39-43); update `OPEN_USAGE` to `"usage: rt gate open --subject <s> --kind <k> --questions <json> [--meta <json>] [--agent <id>] [--pane <id>] [--nudge <json>] [--context <text>] [--origin <json>]"`; in `buildOpenPayload` (before `return payload`):

```ts
  const context = flagValue(args, "--context");
  if (context !== undefined) payload.context = context;
  const origin = parseJsonFlag(args, "--origin");
  if (origin !== undefined) payload.origin = origin as Commands["gate:open"]["payload"]["origin"];
```

In `lib/notify-bridge.ts`: add `subjectPrefix?: string;` to `EventBridgeRule` (line 17-22); in `onEvent` (line 96-106), after `if (!matched) continue;` insert:

```ts
      if (rule.subjectPrefix !== undefined) {
        const payload = (data.payload && typeof data.payload === "object" ? data.payload : {}) as Record<string, unknown>;
        const subject = payload.subject;
        if (typeof subject !== "string" || !subject.startsWith(rule.subjectPrefix)) continue;
      }
```

In `lib/daemon.ts` (rule parsing, line 793-800), carry the field through:

```ts
                rules.push({
                  pattern: e.pattern, category: e.category, title: e.title, message: e.message,
                  ...(typeof (e as { subjectPrefix?: unknown }).subjectPrefix === "string"
                    ? { subjectPrefix: (e as { subjectPrefix: string }).subjectPrefix }
                    : {}),
                });
```

- [ ] **Step 4: Run green.**

Run: `bun test commands/__tests__/gate.test.ts lib/__tests__/notify-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Full rt suite.**

Run: `bun test lib commands packages && bunx tsc --noEmit`
Expected: PASS on both.

- [ ] **Step 6: Commit.**

```bash
git add commands/gate.ts commands/__tests__/gate.test.ts lib/notify-bridge.ts lib/daemon.ts lib/__tests__/notify-bridge.test.ts
git commit -m "gate open --context/--origin flags; notify bridge rules gain subjectPrefix"
```

---

### Task 5: MATT GATE: rt merge + rt-client publish [rt lane checkpoint]

**MATT GATE: do not proceed without explicit approval at EACH step below.**

**Files:**
- Modify: `packages/rt-client/package.json` (minor version bump, currently 0.15.1)

**Interfaces:**
- Produces: rt main carries Tasks 2-4; `@mattstack/rt-client` published at the new minor (0.16.0). Record the exact published version in the task report; Tasks 6 and 10 re-pin to it.

- [ ] **Step 1:** Bump `packages/rt-client/package.json` version 0.15.1 to 0.16.0. Commit: `git add packages/rt-client/package.json && git commit -m "rt-client 0.16.0: gate labels, context, origin"`.
- [ ] **Step 2:** Push the branch and open the rt PR (repo: rt, base main) titled `gates: W4 schema and delivery (labels, context, origin, escape injection)`. Wait for CodeRabbit review and CI green; address actionable findings.
- [ ] **Step 3: MATT GATE.** Present the PR for approval. Only after explicit approval: merge.
- [ ] **Step 4:** Restart the local rt daemon so the new schema and delivery are live (`rt daemon restart`, or the operator's preferred restart path). Verify: `rt gate open --subject spike:sanity --kind sanity --questions '[{"id":"q","label":"q","multi":false,"options":[{"value":"a","label":"A"}]}]' --origin '{"presentation":"wait"}'` succeeds; then `rt gate close <id> --reason abandoned`.
- [ ] **Step 5: MATT GATE.** npm publish of `@mattstack/rt-client@0.16.0` (OTP required; the operator unlocks the vault). Only after explicit approval: `cd packages/rt-client && npm publish`.
- [ ] **Step 6:** Record the published version in the task report.

---

### Task 6: Board surface: re-pin, wire shape, labels, context [board surface lane]

**Files:**
- Modify: `package.json` (re-pin `@mattstack/rt-client` to Task 5's version)
- Modify: `src/gates/store.ts:4-9,48-56`
- Modify: `src/gates/cache.ts:81-108` (applyOpened), `:186-219` (attachGates)
- Modify: `src/client/board/gate-format.ts:101-133`
- Modify: `src/client/board/GateCard.tsx`
- Modify: `src/style.css` (one rule)
- Test: `src/__tests__/gate-format.test.ts`, `src/__tests__/gates-cache.test.ts`

**Interfaces:**
- Consumes: rt-client 0.16.0 (`GateOption`, `GateOrigin`, `GateRow.context/origin`, `gateOptionValue`).
- Produces (board-local, used by Tasks 7-8):
  - `src/gates/store.ts`: `type GateOption = string | { value: string; label: string }`; `interface GateOrigin { paneId?: string; tabId?: string; runId?: string; worktree?: string; presentation?: "form" | "wait" }`; `GateQuestion.options: GateOption[]`; client `GateRow` gains `context?: string; origin?: GateOrigin; domain?: "review" | "respond" | "doctor"`.
  - `src/client/board/gate-format.ts`: `optionValue(o: GateOption): string`, `optionDisplayFor(o: GateOption): GateOptionDisplay`, `displayForValue(value: string, options: GateOption[]): GateOptionDisplay`.
  - `attachGates` rows carry `context`, `origin`, `domain` (domain via the server-side `domainForKind`).

- [ ] **Step 1: Re-pin.** `bun add @mattstack/rt-client@<the version Task 5 recorded>` then `bun run typecheck` as the breakage probe (`bun test` does not typecheck; Bun strips types). Expected: CLEAN. The new wire fields are optional by design (Task 2), so existing full-`GateRow` fixtures stay valid, and the `options` widening to `GateOption[]` only loosens assignability.

- [ ] **Step 2: Write the failing format tests.** Append to `src/__tests__/gate-format.test.ts`:

```ts
describe("labeled options (W4)", () => {
  test("optionValue returns the string or the object's value", () => {
    expect(optionValue("approve")).toBe("approve");
    expect(optionValue({ value: "Major", label: "Major (2)" })).toBe("Major");
  });

  test("optionDisplayFor renders label with the value as hover title", () => {
    expect(optionDisplayFor({ value: "fix:7080da2fcf93c1a2", label: "fix · api.ts:42" }))
      .toEqual({ text: "fix · api.ts:42", title: "fix:7080da2fcf93c1a2" });
  });

  test("optionDisplayFor keeps the verb-token transform for bare strings", () => {
    expect(optionDisplayFor("fix:7080da2fcf93c1a2")).toEqual({ text: "fix · 7080da2f", title: "fix:7080da2fcf93c1a2" });
    expect(optionDisplayFor("approve")).toEqual({ text: "approve" });
  });

  test("displayForValue maps an answered value back to its option's label", () => {
    const options = [{ value: "Major", label: "Major (2)" }, "approve"];
    expect(displayForValue("Major", options)).toEqual({ text: "Major (2)", title: "Major" });
    expect(displayForValue("gone", options)).toEqual({ text: "gone" });
  });
});
```

Append to `src/__tests__/gates-cache.test.ts` (mirror its existing opened-frame fixtures):

```ts
test("applyEvent(opened) carries context and origin onto the cached row", () => {
  const cache = new GateCache();
  cache.applyEvent({
    topic: "gate/opened/g9",
    payload: {
      id: "g9", subject: "mr:https://gitlab.example.com/x/9", kind: "review-post",
      questions: [], meta: null,
      context: "finding titles", origin: { paneId: "p9", presentation: "form" },
    },
  });
  const row = cache.rowsFor("mr:https://gitlab.example.com/x/9")[0]!;
  expect(row.context).toBe("finding titles");
  expect(row.origin).toEqual({ paneId: "p9", presentation: "form" });
});

test("attachGates carries context, origin, and the kind's domain onto the board row", () => {
  const cache = new GateCache();
  cache.applyRow({
    id: "g1", subject: "mr:https://gitlab.example.com/x/1", kind: "review-post",
    questions: [], meta: null, status: "open", answer: null, openedAt: 1,
    parkedAt: null, closedAt: null, closedReason: null, agent: null, pane: null,
    nudge: null, delivery: null, released: false,
    context: "ctx", origin: { worktree: "/tmp/wt" },
  });
  const [mr] = attachGates([{ webUrl: "https://gitlab.example.com/x/1" } as never], cache);
  expect(mr!.gates[0]!.context).toBe("ctx");
  expect(mr!.gates[0]!.origin).toEqual({ worktree: "/tmp/wt" });
  expect(mr!.gates[0]!.domain).toBe("review");
});
```

- [ ] **Step 3: Run to verify failure.**

Run: `bun test src/__tests__/gate-format.test.ts src/__tests__/gates-cache.test.ts`
Expected: FAIL (helpers missing; rows drop the new fields).

- [ ] **Step 4: Implement the shared types.** In `src/gates/store.ts` replace the `GateQuestion` block (line 4-9) with:

```ts
export type GateOption = string | { value: string; label: string };

export interface GateOrigin {
  paneId?: string;
  tabId?: string;
  runId?: string;
  worktree?: string;
  presentation?: "form" | "wait";
}

export interface GateQuestion {
  id: string;
  label: string;
  multi: boolean;
  options: GateOption[];
}
```

Extend the client `GateRow` (line 48-56) with:

```ts
  context?: string;
  origin?: GateOrigin;
  domain?: "review" | "respond" | "doctor";
```

- [ ] **Step 5: Implement the format helpers.** In `src/client/board/gate-format.ts` (import `GateOption` from `../../gates/store.ts`), add below `formatGateOption`:

```ts
export function optionValue(o: GateOption): string {
  return typeof o === "string" ? o : o.value;
}

/** Labeled options render their label with the raw value as the hover
    title; bare strings keep the verb-token transform unchanged. */
export function optionDisplayFor(o: GateOption): GateOptionDisplay {
  if (typeof o !== "string") {
    const text = o.label || o.value;
    return text === o.value ? { text } : { text, title: o.value };
  }
  return formatGateOption(o);
}

export function displayForValue(value: string, options: GateOption[]): GateOptionDisplay {
  const match = options.find((o) => optionValue(o) === value);
  return match !== undefined ? optionDisplayFor(match) : formatGateOption(value);
}
```

In `gateAnswerPayload` nothing changes (`q.options.length` still gates requiredness; selections already carry values).

- [ ] **Step 6: Map the fields through the server.** In `src/gates/cache.ts`:
  - `applyOpened` (line 81-108): after the `nudge: null,` line add

```ts
      context: typeof payload.context === "string" ? payload.context : null,
      origin: isRecord(payload.origin) ? (payload.origin as FacilityGateRow["origin"]) : null,
```

  - Add `import { domainForKind } from "./sweep.ts";` and extend BOTH `gates.push` objects in `attachGates` (line 197-204 and 206-214) with:

```ts
          context: row.context ?? undefined,
          origin: row.origin ?? undefined,
          domain: domainForKind(row.kind),
```

- [ ] **Step 7: Render labels and context in GateCard.** In `src/client/board/GateCard.tsx`:
  - Change `GateOptionText` to take `option: GateOption` and use `optionDisplayFor(option)`.
  - In `GateQuestionField`, options map with `optionValue` for keys, toggles, and submissions: `const value = optionValue(opt);` then `key={value}`, `picked.has(value)`, `toggle(value)`, `aria-label={value}`, and for the RadioGroup `options={question.options.map((opt) => ({ value: optionValue(opt), label: <GateOptionText option={opt} /> }))}`.
  - In `GateAnswerSummary`, render answered values through the label lookup: replace both `<GateOptionText option={v} />` / `<GateOptionText option={value} />` renders with a small local component `Answered({ value, options })` that returns `<span title={displayForValue(value, options).title}>{displayForValue(value, options).text}</span>`; pass `q.options` down.
  - Add the context section inside the card, after the head and before the questions branch (import `Disclosure`, `DisclosureHead` from `./Disclosure.tsx`, add `const [ctxOpen, setCtxOpen] = useState(false);`):

```tsx
      {gate.context && (
        <div className="tui-gate-context">
          <DisclosureHead open={ctxOpen} label="context" onToggle={() => setCtxOpen((o) => !o)}>
            <></>
          </DisclosureHead>
          <Disclosure open={ctxOpen}>
            <pre className="tui-gate-context-body">{gate.context}</pre>
          </Disclosure>
        </div>
      )}
```

  - In `src/style.css` add: `.tui-gate-context-body { white-space: pre-wrap; margin: 0; font: inherit; }`

- [ ] **Step 8: Run green.**

Run: `bun test && bun run typecheck`
Expected: PASS on both (whole board suite plus the three-tsconfig typecheck; board PR CI runs only the purity gate, so the lane gates types here).

- [ ] **Step 9: Commit.**

```bash
git add package.json bun.lock src/gates src/client/board src/style.css src/__tests__
git commit -m "gates: labeled options, context section, and origin on the board wire shape"
```

---

### Task 7: Board origin-based focus; retire gateFocusDomain [board surface lane]

**Files:**
- Create: `src/gates/focus.ts`
- Modify: `src/server.ts` (new `/gate/focus` route beside the `/gate/answer` case at line 1271)
- Modify: `src/client/board/gate-format.ts:1-18,135-157` (delete `gateFocusDomain` and the client-side `domainForKind`; keep the `GateDomain` type)
- Modify: `src/client/board/GateCard.tsx:130-232`
- Test: Create `src/__tests__/gates-focus.test.ts`; modify `src/__tests__/gate-format.test.ts`

**Interfaces:**
- Consumes: Task 6's `GateRow.origin/domain`; `focusPane` (`src/focus-pane.ts:10`); `paneList` from `@mattstack/rt-client` (no payload; returns `{ panes: Array<{ paneId: string; cwd?: string; ... }> }`).
- Produces:
  - `resolveOriginFocus(origin: GateOrigin | undefined, panes: Array<{ paneId: string; cwd?: string }>): { ok: true; paneId: string; tabId?: string } | { ok: false; reason: string }` in `src/gates/focus.ts`
  - Board route `POST /gate/focus` body `{ gateId: string }`; 200 `{ok:true}`, 400 `{ok:false,error:<reason>}`, 404 unknown gate, 502 only when the focus call throws (`focusPane` swallows a failed `paneFocus` into its tab fallback, so most focus failures resolve 200)
  - Client: open gates focus via the route; parked gates keep the resume flow via `onFocusPane(mr, gate.domain)`; `gateFocusDomain` no longer exists.

- [ ] **Step 1: Write the failing resolution tests.** Create `src/__tests__/gates-focus.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { resolveOriginFocus } from "../gates/focus.ts";

describe("resolveOriginFocus", () => {
  test("paneId wins directly and carries tabId for the fallback", () => {
    expect(resolveOriginFocus({ paneId: "p1", tabId: "t1", worktree: "/w" }, []))
      .toEqual({ ok: true, paneId: "p1", tabId: "t1" });
  });

  test("worktree matches a live pane's cwd when no paneId is on the origin", () => {
    const panes = [{ paneId: "a", cwd: "/other" }, { paneId: "b", cwd: "/w" }];
    expect(resolveOriginFocus({ worktree: "/w" }, panes)).toEqual({ ok: true, paneId: "b" });
  });

  test("worktree with no live match resolves to a reason, not a dead target", () => {
    expect(resolveOriginFocus({ worktree: "/gone" }, [{ paneId: "a", cwd: "/other" }]))
      .toEqual({ ok: false, reason: "no live pane matches the origin worktree" });
  });

  test("no origin resolves to a reason", () => {
    expect(resolveOriginFocus(undefined, [])).toEqual({ ok: false, reason: "no origin on this gate" });
    expect(resolveOriginFocus({}, [])).toEqual({ ok: false, reason: "no origin on this gate" });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `bun test src/__tests__/gates-focus.test.ts`
Expected: FAIL (`src/gates/focus.ts` does not exist).

- [ ] **Step 3: Implement the resolver.** Create `src/gates/focus.ts`:

```ts
import type { GateOrigin } from "./store.ts";

export type FocusResolution =
  | { ok: true; paneId: string; tabId?: string }
  | { ok: false; reason: string };

/** Shared focus rule: direct by origin.paneId, else worktree match against
    live pane cwds, else a human-readable reason for a disabled affordance. */
export function resolveOriginFocus(
  origin: GateOrigin | undefined,
  panes: Array<{ paneId: string; cwd?: string }>,
): FocusResolution {
  if (origin?.paneId) {
    return origin.tabId !== undefined
      ? { ok: true, paneId: origin.paneId, tabId: origin.tabId }
      : { ok: true, paneId: origin.paneId };
  }
  if (origin?.worktree) {
    const match = panes.find((p) => p.cwd === origin.worktree);
    return match
      ? { ok: true, paneId: match.paneId }
      : { ok: false, reason: "no live pane matches the origin worktree" };
  }
  return { ok: false, reason: "no origin on this gate" };
}
```

- [ ] **Step 4: Add the server route.** In `src/server.ts`, import `paneList` (extend the existing `@mattstack/rt-client` import) and `resolveOriginFocus` from `./gates/focus.ts`, and add a case beside `/gate/answer` (line 1271):

```ts
      case "/gate/focus": {
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const gateId = (body as { gateId?: unknown })?.gateId;
        if (typeof gateId !== "string" || !gateId) return new Response("expected { gateId: string }", { status: 400 });
        const row = gateCache.rows().find((r) => r.id === gateId);
        if (!row) return new Response(`unknown gate "${gateId}"`, { status: 404 });
        let panes: Array<{ paneId: string; cwd?: string }> = [];
        if (!row.origin?.paneId && row.origin?.worktree) {
          const panesRes = await paneList();
          panes = panesRes.ok && panesRes.data ? panesRes.data.panes : [];
        }
        const resolved = resolveOriginFocus(row.origin ?? undefined, panes);
        if (!resolved.ok) {
          return new Response(JSON.stringify({ ok: false, error: resolved.reason }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }
        try {
          await focusPane({ paneId: resolved.paneId, tabId: resolved.tabId });
        } catch (err) {
          return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), {
            status: 502, headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
```

- [ ] **Step 5: Rewire the client button and retire the duplicate.** In `src/client/board/gate-format.ts`: delete `domainForKind` (line 13-18), `DomainPaneRef` (line 138-140), and `gateFocusDomain` (line 150-157); keep `export type GateDomain`. In `src/client/board/GateCard.tsx`:
  - Drop the `gateFocusDomain` import; add `useState` for `focusBusy` and `focusError`.
  - Replace the `focusDomain` computation (line 151) and the focus button block (line 212-221) with (a non-2xx response surfaces its reason in the card's existing error styling, per the spec's never-a-dead-button rule):

```tsx
  const originFocusable = Boolean(gate.origin?.paneId || gate.origin?.worktree);
  const focusGate = async () => {
    setFocusBusy(true);
    setFocusError(null);
    try {
      const res = await fetch("/gate/focus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gateId: gate.gateId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFocusError(body?.error ?? `focus failed (${res.status})`);
      }
    } catch {
      setFocusError("focus failed");
    } finally {
      setFocusBusy(false);
    }
  };
```

  with the state declared beside the others: `const [focusError, setFocusError] = useState<string | null>(null);` and rendered in the actions row: `{focusError && <span className="tui-gate-error">{focusError}</span>}`.

  and in the actions row:

```tsx
            {gate.status === "parked" ? (
              gate.domain && (
                <button
                  type="button"
                  className="tui-gate-focus"
                  title="resume this gate's flow in a fresh pane"
                  onClick={() => onFocusPane(mr, gate.domain!)}
                >
                  focus pane
                </button>
              )
            ) : (
              <button
                type="button"
                className="tui-gate-focus"
                disabled={!originFocusable || focusBusy}
                title={originFocusable ? "jump into the pane behind this gate" : "no origin on this gate"}
                onClick={() => void focusGate()}
              >
                focus pane
              </button>
            )}
```

  - `onFocusPane`'s `domain` argument type stays `GateDomain`; `gate.domain` narrows to it (both are the same union).

- [ ] **Step 6: Update the old tests.** In `src/__tests__/gate-format.test.ts`, delete the `gateFocusDomain`/`domainForKind` client tests (the ones asserting tabId joins); the kind strings stay covered by `src/__tests__/gates-sweep.test.ts`.

- [ ] **Step 7: Run green.**

Run: `bun test && bun run typecheck`
Expected: PASS on both.

- [ ] **Step 8: Commit.**

```bash
git add src/gates/focus.ts src/server.ts src/client/board src/__tests__
git commit -m "gates: origin-based focus route and button; retire client gateFocusDomain"
```

---

### Task 8: Board respond-collapse rendering (sentinel) [board surface lane]

**Files:**
- Modify: `src/client/board/gate-format.ts` (collapse rule), `src/client/board/GateCard.tsx` (conditional show + sentinel submit)
- Test: `src/__tests__/gate-format.test.ts`

**Interfaces:**
- Consumes: Task 6's `optionValue`, `GateQuestion`, `GateSelections`.
- Produces (the console mirrors these EXACT values in Task 10; the opener emits them in Task 14):
  - `RESPOND_PLAN_KIND = "respond-plan"`, `CODE_CHANGES_QUESTION_ID = "code-changes"`, `CODE_CHANGES_SENTINEL = "skip"`
  - `codeChangesHidden(kind: string, questions: GateQuestion[], selections: GateSelections): boolean`
  - Behavior: on a respond-plan gate whose `code-changes` question carries a `skip` option, the question is hidden until any OTHER question's selection includes a value starting with `fix:`; while hidden, the submitted payload carries `code-changes: "skip"`.

- [ ] **Step 1: Write the failing tests.** Append to `src/__tests__/gate-format.test.ts`:

```ts
describe("respond collapse (W4)", () => {
  const questions = [
    { id: "threads-1", label: "Threads", multi: true, options: ["reply:t1", "fix:t1", "skip:t1"] },
    { id: "code-changes", label: "Approve the proposed code changes?", multi: false, options: ["approve", "revise", "skip"] },
  ];

  test("hidden until a fix: value is selected", () => {
    expect(codeChangesHidden("respond-plan", questions, {})).toBe(true);
    expect(codeChangesHidden("respond-plan", questions, { "threads-1": ["reply:t1"] })).toBe(true);
    expect(codeChangesHidden("respond-plan", questions, { "threads-1": ["fix:t1"] })).toBe(false);
  });

  test("never hidden off respond-plan, without the question, or without the sentinel option", () => {
    expect(codeChangesHidden("review-post", questions, {})).toBe(false);
    expect(codeChangesHidden("respond-plan", [questions[0]!], {})).toBe(false);
    const noSentinel = [questions[0]!, { ...questions[1]!, options: ["approve", "revise"] }];
    expect(codeChangesHidden("respond-plan", noSentinel, {})).toBe(false);
  });

  test("a hidden question submits the sentinel through gateAnswerPayload", () => {
    const selections = { "threads-1": ["reply:t1"] };
    const effective = { ...selections, "code-changes": "skip" };
    const payload = gateAnswerPayload({ gateId: "g1", questions }, effective);
    expect(payload).toEqual({ gateId: "g1", answers: { "threads-1": ["reply:t1"], "code-changes": "skip" } });
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `bun test src/__tests__/gate-format.test.ts`
Expected: FAIL (`codeChangesHidden` not exported).

- [ ] **Step 3: Implement the rule.** In `src/client/board/gate-format.ts`:

```ts
export const RESPOND_PLAN_KIND = "respond-plan";
export const CODE_CHANGES_QUESTION_ID = "code-changes";
export const CODE_CHANGES_SENTINEL = "skip";

/** The respond collapse keys off the gate's own option set: only a
    respond-plan gate whose code-changes question carries the sentinel
    participates, so old gates render exactly as before. */
export function codeChangesHidden(
  kind: string,
  questions: GateQuestion[],
  selections: GateSelections,
): boolean {
  if (kind !== RESPOND_PLAN_KIND) return false;
  const q = questions.find((x) => x.id === CODE_CHANGES_QUESTION_ID);
  if (!q || !q.options.some((o) => optionValue(o) === CODE_CHANGES_SENTINEL)) return false;
  for (const [qid, sel] of Object.entries(selections)) {
    if (qid === CODE_CHANGES_QUESTION_ID) continue;
    const values = Array.isArray(sel) ? sel : [sel];
    if (values.some((v) => typeof v === "string" && v.startsWith("fix:"))) return false;
  }
  return true;
}
```

- [ ] **Step 4: Wire GateCard.** In `src/client/board/GateCard.tsx`, in the `GateCard` body replace the `payload` computation with:

```tsx
  const hidden = actionable && codeChangesHidden(gate.kind, gate.questions, selections);
  const effective = hidden ? { ...selections, [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL } : selections;
  const payload = actionable
    ? gateAnswerPayload({ gateId: gate.gateId, questions: gate.questions }, effective)
    : null;
```

and filter the question render:

```tsx
          {gate.questions
            .filter((q) => !(hidden && q.id === CODE_CHANGES_QUESTION_ID))
            .map((q) => (
              <GateQuestionField key={q.id} question={q} value={selections[q.id]} onChange={setAnswer} />
            ))}
```

- [ ] **Step 5: Run green.**

Run: `bun test && bun run typecheck`
Expected: PASS on both.

- [ ] **Step 6: Commit.**

```bash
git add src/client/board/gate-format.ts src/client/board/GateCard.tsx src/__tests__/gate-format.test.ts
git commit -m "gates: respond-plan collapse hides code-changes until a fix and submits the skip sentinel"
```

---

### Task 9: Board smalls: unknown-kind logging + manual doctor fix-classes [board surface lane]

**Files:**
- Modify: `src/gates/sweep.ts:74-97` (planSweep callback), `src/gates/resume.ts:180-190` (resume walk logging)
- Modify: `src/triage/run.ts` (two helpers), `bin/triage.ts:74-86` (reuse the identity helper)
- Modify: `src/server.ts:987-1048` (`/doctor` endpoint), `:1878` (sweep call site)
- Test: `src/__tests__/gates-sweep.test.ts`, create `src/__tests__/triage-manual-doctor.test.ts`

**Interfaces:**
- Consumes: `domainForKind`/`GATE_KINDS` (`src/gates/sweep.ts:31-44`), `composeFixClasses` (`src/triage/run.ts:47`), `loadTriageConfig` (`src/triage/config.ts:154`), `readMemory`/`writeMemory` (`src/triage/memory.ts:41,50`), the server-local ASYNC `gitlab(): Promise<GitLabProvider>` helper (`src/server.ts:107-113`; `validateToken()` resolves the token user), `launchDoctor` (`src/herdr.ts`, already accepts `tier`/`fixClasses`).
- Produces:
  - `planSweep(rows, states, now, graceMs, onUnknownKind?: (row: GateRow) => void)`
  - resume walk: an unknown kind logs `gate resume: unknown gate kind "<kind>" on <subject>; skipping` instead of throwing; a KNOWN kind with missing wiring still throws
  - `IDENTITY_TTL_MS`, `resolveDispatchIdentity(memory, validateToken, now?)`, `manualDoctorFields(triage, author, identity): { tier?: string; fixClasses: string[] }` in `src/triage/run.ts`
  - `/doctor` writes `tier`/`fixClasses` onto the initial state and passes both to `launchDoctor`.

- [ ] **Step 1: Write the failing tests.** Append to `src/__tests__/gates-sweep.test.ts` (mirror its row fixtures):

```ts
test("planSweep reports an unknown kind through the callback instead of pure silence", () => {
  const rows = [baseRow({ kind: "mystery-kind", status: "open", openedAt: 0 })];
  const states = { reviews: new Map(), responds: new Map(), doctors: new Map() };
  const unknown: string[] = [];
  planSweep(rows, states, 10_000_000, 1, (r) => unknown.push(r.kind));
  expect(unknown).toEqual(["mystery-kind"]);
});
```

(`baseRow` is the file's existing fixture helper at `src/__tests__/gates-sweep.test.ts:13`; states are built inline per test in that file, so no shared helper exists or is needed.) Create `src/__tests__/triage-manual-doctor.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { IDENTITY_TTL_MS, manualDoctorFields, resolveDispatchIdentity } from "../triage/run.ts";
import type { DispatchMemory } from "../triage/memory.ts";
import type { TriageConfig } from "../triage/config.ts";

function memoryWith(identity: DispatchMemory["identity"]): DispatchMemory {
  return { identity, mrs: {} };
}

const TRIAGE = {
  tier: "api",
  fixClasses: { retryFlake: true, inheritedNoteDraft: true, cleanApiRebase: false, mechanicalLint: true, codeFix: false },
} as TriageConfig;

describe("resolveDispatchIdentity", () => {
  test("fresh cache wins without a token round-trip", async () => {
    const mem = memoryWith({ username: "octo-cat", fetchedAt: 1000 });
    const identity = await resolveDispatchIdentity(mem, async () => { throw new Error("must not be called"); }, () => 1000 + IDENTITY_TTL_MS - 1);
    expect(identity).toBe("octo-cat");
  });

  test("stale cache re-validates and writes back", async () => {
    const mem = memoryWith({ username: "old", fetchedAt: 0 });
    const identity = await resolveDispatchIdentity(mem, async () => ({ username: "fresh" }), () => IDENTITY_TTL_MS + 1);
    expect(identity).toBe("fresh");
    expect(mem.identity).toEqual({ username: "fresh", fetchedAt: IDENTITY_TTL_MS + 1 });
  });

  test("a failed validation resolves null (branch-writing classes stay off)", async () => {
    const identity = await resolveDispatchIdentity(memoryWith(null), async () => { throw new Error("no token"); });
    expect(identity).toBeNull();
  });
});

describe("manualDoctorFields", () => {
  test("composes exactly as the auto path: tier mapping plus author-gated classes", () => {
    const own = manualDoctorFields(TRIAGE, "octo-cat", "octo-cat");
    expect(own.tier).toBe("api");
    expect(own.fixClasses).toEqual(["retry-flake", "inherited-note-draft", "mechanical-lint"]);
    const foreign = manualDoctorFields(TRIAGE, "someone-else", "octo-cat");
    expect(foreign.fixClasses).toEqual(["retry-flake", "inherited-note-draft"]);
    const checkout = manualDoctorFields({ ...TRIAGE, tier: "checkout" } as TriageConfig, "a", null);
    expect(checkout.tier).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `bun test src/__tests__/gates-sweep.test.ts src/__tests__/triage-manual-doctor.test.ts`
Expected: FAIL (extra planSweep argument ignored has no effect; helpers not exported).

- [ ] **Step 3: Implement.**
  - `src/gates/sweep.ts` `planSweep` signature gains `onUnknownKind?: (row: GateRow) => void`; at line 89-90 replace `if (!domain) continue;` with `if (!domain) { onUnknownKind?.(row); continue; }`.
  - `src/server.ts:1878` call site: `planSweep(gateCache.rows(), states, Date.now(), config.gateGraceMinutes * 60_000, (row) => console.error(`gate sweep: unknown gate kind "${row.kind}" on ${row.subject}; skipping`))`.
  - `src/gates/resume.ts` in `resumeIfMissed` (the `if (!kindIo) throw ...` at the `io.resumers[row.kind]` lookup), replace with:

```ts
  const kindIo = io.resumers[row.kind];
  if (!kindIo) {
    if ((GATE_KINDS as readonly string[]).includes(row.kind)) throw new Error(`${row.kind} resume not wired`);
    console.error(`gate resume: unknown gate kind "${row.kind}" on ${row.subject}; skipping`);
    return;
  }
```

  (`GATE_KINDS` is already imported at `src/gates/resume.ts:7`.) Apply the same known/unknown split to `resumeParkedGate`'s own `if (!kindIo) throw` (line 108-109), keyed on `gate.kind` and `gate.mrUrl` in the message.
  - `src/triage/run.ts`, below `composeFixClasses`:

```ts
export const IDENTITY_TTL_MS = 24 * 60 * 60_000;

export async function resolveDispatchIdentity(
  memory: DispatchMemory,
  validateToken: () => Promise<{ username: string }>,
  now: () => number = Date.now,
): Promise<string | null> {
  const cached = memory.identity && now() - memory.identity.fetchedAt < IDENTITY_TTL_MS
    ? memory.identity.username
    : null;
  if (cached) return cached;
  try {
    const user = await validateToken();
    memory.identity = { username: user.username, fetchedAt: now() };
    return user.username;
  } catch {
    return null;
  }
}

export function manualDoctorFields(
  triage: TriageConfig,
  author: string,
  identity: string | null,
): { tier?: string; fixClasses: string[] } {
  return {
    tier: triage.tier === "checkout" ? undefined : "api",
    fixClasses: composeFixClasses(triage.fixClasses, author, identity),
  };
}
```

  (Import `TriageConfig` from `./config.ts` and `DispatchMemory` from `./memory.ts` if not already imported.) In `bin/triage.ts:74-86`, replace the inline TTL/validate logic with `const username = await resolveDispatchIdentity(memory, async () => { const token = await loadGitLabToken(); if (!token) throw new Error("triage: no gitlab token available for identity"); return new GitLabProvider(boardConfig.gitlabHost, token).validateToken(); });` and keep the existing throw-on-null behavior by following it with `if (!username) throw new Error("triage: no gitlab token available for identity");`. Delete the now-dead local `IDENTITY_TTL_MS`.
  - `src/server.ts` `/doctor` case: import `loadTriageConfig` from `./triage/config.ts`, `readMemory, writeMemory` from `./triage/memory.ts`, `manualDoctorFields, resolveDispatchIdentity` from `./triage/run.ts`. Before the `writeDoctorState` at the launch (line 1023), add:

```ts
        const triage = loadTriageConfig();
        const memory = readMemory();
        const identity = await resolveDispatchIdentity(memory, async () => (await gitlab()).validateToken());
        writeMemory(memory);
        const { tier, fixClasses } = manualDoctorFields(triage, mr.author.username, identity);
```

  then extend the state write to `{ mrUrl: parsed.mrUrl, iid: parsed.iid, status: "queued", origin: "manual", tier, fixClasses }` and the `launchDoctor({ ... })` call with `tier, fixClasses,`. The composer takes `mr.author.username` and NEVER the endpoint's `author` variable: that variable is `mrAuthorLabel(mr)`, the display name, and `composeFixClasses` licenses the branch-writing classes only on an exact USERNAME match against the token identity, so feeding the label silently disables `mechanical-lint`/`code-fix` on the operator's own MRs. Keep `author` only for the launch's tab-label opt.

- [ ] **Step 4: Run green.**

Run: `bun test && bun run typecheck`
Expected: PASS on both.

- [ ] **Step 5: Commit.**

```bash
git add src/gates/sweep.ts src/gates/resume.ts src/triage/run.ts bin/triage.ts src/server.ts src/__tests__
git commit -m "sweep/resume log unknown gate kinds; manual doctor launch composes tier and fix classes"
```

---

### Task 10: Console rendering: labels, context, collapse sentinel [console surface lane]

**Files:**
- Modify: `package.json` (re-pin `@mattstack/rt-client` to Task 5's version)
- Modify: `src/app/runs/gate-format.ts`
- Modify: `src/app/runs/GateCard.tsx`
- Test: `src/app/runs/GateCard.test.tsx`

**Interfaces:**
- Consumes: rt-client 0.16.0 (`GateOption`, `gateOptionValue`, `GateRow.context/kind`).
- Produces (console-local, mirrors the board's Task 8 values EXACTLY):
  - `optionValue(o)`, `optionLabel(o)`, `displayValueLabel(value, options)` in `src/app/runs/gate-format.ts`
  - `RESPOND_PLAN_KIND = 'respond-plan'`, `CODE_CHANGES_QUESTION_ID = 'code-changes'`, `CODE_CHANGES_SENTINEL = 'skip'`, `codeChangesHidden(kind, questions, selections)`
  - GateCard renders labels, an expandable context block (`data-testid="gate-context-toggle"` / `"gate-context-body"`), and submits values (sentinel included when hidden).

- [ ] **Step 1: Re-pin.** `bun add @mattstack/rt-client@<the version Task 5 recorded>`.

- [ ] **Step 2: Write the failing component tests.** Append to `src/app/runs/GateCard.test.tsx` (its `gateRow`/`renderCard` helpers and mocked `answerPost` already exist):

```tsx
describe('W4 rendering', () => {
  it('renders option labels but submits values', async () => {
    const user = userEvent.setup();
    renderCard(gateRow({
      questions: [{ id: 'outcome', label: 'What happened?', multi: false, options: [{ value: 'pass', label: 'Pass (all green)' }, 'fail'] }],
    }));
    await user.click(screen.getByLabelText('Pass (all green)'));
    await user.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(answerPost).toHaveBeenCalled());
    expect(answerPost.mock.calls[0]![0]).toMatchObject({ json: { answers: { outcome: 'pass' } } });
  });

  it('shows a context toggle and reveals the context text', async () => {
    const user = userEvent.setup();
    renderCard(gateRow({ context: 'the failing check output' }));
    expect(screen.queryByTestId('gate-context-body')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('gate-context-toggle'));
    expect(screen.getByTestId('gate-context-body')).toHaveTextContent('the failing check output');
  });

  it('hides code-changes until a fix is picked and submits the sentinel while hidden', async () => {
    const user = userEvent.setup();
    renderCard(gateRow({
      kind: 'respond-plan',
      questions: [
        { id: 'threads-1', label: 'Threads', multi: true, options: ['reply:t1', 'fix:t1', 'skip:t1'] },
        { id: 'code-changes', label: 'Approve the proposed code changes?', multi: false, options: ['approve', 'revise', 'skip'] },
      ],
    }));
    expect(screen.queryByText('Approve the proposed code changes?')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('reply:t1'));
    await user.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(answerPost).toHaveBeenCalled());
    expect(answerPost.mock.calls[0]![0]).toMatchObject({
      json: { answers: { 'threads-1': ['reply:t1'], 'code-changes': 'skip' } },
    });
    answerPost.mockClear();
    await user.click(screen.getByLabelText('fix:t1'));
    expect(screen.getByText('Approve the proposed code changes?')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure.**

Run: `bunx vitest run src/app/runs/GateCard.test.tsx`
Expected: FAIL (labels render as objects or not at all; no context toggle; code-changes always shown).

- [ ] **Step 4: Implement the format helpers.** In `src/app/runs/gate-format.ts`: the file already imports `GateQuestion` (type) from `@mattstack/rt-client` on line 1; MERGE into that existing import rather than adding a second one (a duplicate `GateQuestion` identifier is a compile error), so it reads `import { gateOptionValue, type GateOption, type GateQuestion } from '@mattstack/rt-client';`. Then add:

```ts
export const optionValue = gateOptionValue;

export function optionLabel(o: GateOption): string {
  return typeof o === 'string' ? o : o.label || o.value;
}

export function displayValueLabel(value: string, options: GateOption[]): string {
  const match = options.find(o => optionValue(o) === value);
  return match !== undefined ? optionLabel(match) : value;
}

export const RESPOND_PLAN_KIND = 'respond-plan';
export const CODE_CHANGES_QUESTION_ID = 'code-changes';
export const CODE_CHANGES_SENTINEL = 'skip';

export function codeChangesHidden(
  kind: string,
  questions: GateQuestion[],
  selections: GateSelections
): boolean {
  if (kind !== RESPOND_PLAN_KIND) return false;
  const q = questions.find(x => x.id === CODE_CHANGES_QUESTION_ID);
  if (!q || !q.options.some(o => optionValue(o) === CODE_CHANGES_SENTINEL)) return false;
  for (const [qid, sel] of Object.entries(selections)) {
    if (qid === CODE_CHANGES_QUESTION_ID) continue;
    const values = Array.isArray(sel) ? sel : [sel];
    if (values.some(v => typeof v === 'string' && v.startsWith('fix:'))) return false;
  }
  return true;
}
```

- [ ] **Step 5: Wire GateCard.** In `src/app/runs/GateCard.tsx`:
  - `GateQuestionField`: checkbox `key={optionValue(opt)}`, `label={optionLabel(opt)}`, `checked={picked.has(optionValue(opt))}`, `onChange={() => toggle(optionValue(opt))}`; radio `key={optionValue(opt)} value={optionValue(opt)} label={optionLabel(opt)}`.
  - `GateAnswerSummary`: map values through `displayValueLabel(v, q.options)` (array join and single value both).
  - `GateCard` body: add `const [contextOpen, setContextOpen] = useState(false);` and, above the questions branch:

```tsx
        {typeof gate.context === 'string' && gate.context.length > 0 && (
          <Stack gap={4}>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setContextOpen(o => !o)}
              data-testid="gate-context-toggle"
              style={{ alignSelf: 'flex-start' }}
            >
              {contextOpen ? 'hide context' : 'show context'}
            </Button>
            {contextOpen && (
              <Text fz={12} style={{ whiteSpace: 'pre-wrap' }} data-testid="gate-context-body">
                {gate.context}
              </Text>
            )}
          </Stack>
        )}
```

  - Collapse wiring, mirroring the board exactly:

```tsx
  const hidden = actionable && codeChangesHidden(gate.kind, gate.questions, selections);
  const effective = hidden
    ? { ...selections, [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL }
    : selections;
  const payload = actionable ? gateAnswerPayload(gate.questions, effective) : null;
```

  and filter the question render on `!(hidden && q.id === CODE_CHANGES_QUESTION_ID)`.

- [ ] **Step 6: Run green.**

Run: `bunx vitest run src/app/runs/GateCard.test.tsx && bunx vitest run src/server && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add package.json bun.lock src/app/runs/gate-format.ts src/app/runs/GateCard.tsx src/app/runs/GateCard.test.tsx
git commit -m "gates ui: option labels, context block, respond collapse sentinel"
```

---

### Task 11: Console focus endpoint + button [console surface lane]

**Files:**
- Modify: `src/server/gates.ts` (focus route + resolver)
- Modify: `src/app/runs/GateCard.tsx` (focus button)
- Test: `src/server/gates.test.ts`, `src/app/runs/GateCard.test.tsx`

**Interfaces:**
- Consumes: rt-client `paneList` (no payload arg; options `{ sockPath }`; data `{ panes: Array<{ paneId: string; cwd?: string }> }`), `paneFocus({ paneId })`, `GateRow.origin` (Task 5).
- Produces:
  - `resolveOriginFocus(origin, panes)` exported from `src/server/gates.ts` (same rule as the board's Task 7 resolver)
  - Route `POST /api/gates/:id/focus`: 200 `{focused:true}`, 400 `{error:<reason>}` (unresolvable origin), 404 `{error:'not-found'}`, 502 upstream failures
  - GateCard focus button `data-testid="gate-focus"`: disabled with a reason title on parked gates and origin-less gates; parked gates stay fully ANSWERABLE (no change to the submit path).

- [ ] **Step 1: Write the failing server tests.** In `src/server/gates.test.ts`, extend the rt-client mock and add a suite:

```ts
vi.mock('@mattstack/rt-client', () => ({
  gateList: vi.fn(),
  gateAnswer: vi.fn(),
  paneList: vi.fn(),
  paneFocus: vi.fn(),
}));
```

```ts
function focus(id: string) {
  return gates.fetch(new Request(`http://localhost/api/gates/${id}/focus`, { method: 'POST' }));
}

describe('POST /api/gates/:id/focus', () => {
  it('focuses directly by origin.paneId', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({ ok: true, data: { gates: [row({ origin: { paneId: 'p1', presentation: 'form' } })], cursor: 1 } });
    vi.mocked(rt.paneFocus).mockResolvedValueOnce({ ok: true, data: { paneId: 'p1', focused: true } });
    const res = await focus('g1');
    expect(res.status).toBe(200);
    expect(rt.paneFocus).toHaveBeenCalledWith({ paneId: 'p1' }, expect.anything());
    expect(rt.paneList).not.toHaveBeenCalled();
  });

  it('falls back to a worktree match against live pane cwds', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({ ok: true, data: { gates: [row({ origin: { worktree: '/w' } })], cursor: 1 } });
    vi.mocked(rt.paneList).mockResolvedValueOnce({ ok: true, data: { panes: [{ paneId: 'a', cwd: '/other' }, { paneId: 'b', cwd: '/w' }] } } as never);
    vi.mocked(rt.paneFocus).mockResolvedValueOnce({ ok: true, data: { paneId: 'b', focused: true } });
    const res = await focus('g1');
    expect(res.status).toBe(200);
    expect(rt.paneFocus).toHaveBeenCalledWith({ paneId: 'b' }, expect.anything());
  });

  it('an unresolvable origin is a 400 with the reason, never a dead focus', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({ ok: true, data: { gates: [row({})], cursor: 1 } });
    const res = await focus('g1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no origin on this gate' });
    expect(rt.paneFocus).not.toHaveBeenCalled();
  });

  it('unknown gate is 404', async () => {
    vi.mocked(rt.gateList).mockResolvedValueOnce({ ok: true, data: { gates: [], cursor: 0 } });
    const res = await focus('missing');
    expect(res.status).toBe(404);
  });
});
```

(The base `row()` fixture needs no changes: the wire fields are optional by design, Task 2.)

- [ ] **Step 2: Write the failing button test.** Append to `src/app/runs/GateCard.test.tsx`:

```tsx
describe('focus button', () => {
  it('is enabled when the origin can resolve and disabled with a reason otherwise', () => {
    renderCard(gateRow({ origin: { paneId: 'p1', presentation: 'form' } }));
    expect(screen.getByTestId('gate-focus')).toBeEnabled();
  });

  it('is disabled with reasons for origin-less and parked gates', () => {
    renderCard(gateRow({}));
    expect(screen.getByTestId('gate-focus')).toBeDisabled();
    expect(screen.getByTestId('gate-focus')).toHaveAttribute('title', 'no origin on this gate');
  });

  it('parked gates disable focus but keep the submit path', () => {
    renderCard(gateRow({ status: 'parked', origin: { paneId: 'p1' } }));
    expect(screen.getByTestId('gate-focus')).toBeDisabled();
    expect(screen.getByTestId('gate-focus')).toHaveAttribute('title', 'parked; resume is board-owned');
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();
  });
});
```

(The base `gateRow` fixture needs no changes: the wire fields are optional by design, Task 2.)

- [ ] **Step 3: Run to verify failure.**

Run: `bunx vitest run src/server/gates.test.ts src/app/runs/GateCard.test.tsx`
Expected: FAIL (no focus route; no focus button).

- [ ] **Step 4: Implement the route.** In `src/server/gates.ts`, extend the rt-client import with `paneFocus, paneList` and add:

```ts
export function resolveOriginFocus(
  origin: GateRow['origin'] | undefined,
  panes: Array<{ paneId: string; cwd?: string }>
): { ok: true; paneId: string } | { ok: false; reason: string } {
  if (origin?.paneId) return { ok: true, paneId: origin.paneId };
  if (origin?.worktree) {
    const match = panes.find(p => p.cwd === origin.worktree);
    return match
      ? { ok: true, paneId: match.paneId }
      : { ok: false, reason: 'no live pane matches the origin worktree' };
  }
  return { ok: false, reason: 'no origin on this gate' };
}
```

and chain onto the `gates` Hono app:

```ts
  .post('/api/gates/:id/focus', async c => {
    const { id } = c.req.param();
    const all = await listAllRunGates();
    if (!all.ok) return c.json({ error: all.error }, 502);
    const row = all.gates.find(g => g.id === id);
    if (!row) return c.json({ error: 'not-found' }, 404);
    let panes: Array<{ paneId: string; cwd?: string }> = [];
    if (!row.origin?.paneId && row.origin?.worktree) {
      const panesRes = await paneList({ sockPath: process.env.RT_SOCK_PATH });
      panes = panesRes.ok && panesRes.data ? panesRes.data.panes : [];
    }
    const resolved = resolveOriginFocus(row.origin ?? undefined, panes);
    if (!resolved.ok) return c.json({ error: resolved.reason }, 400);
    const focusRes = await paneFocus(
      { paneId: resolved.paneId },
      { sockPath: process.env.RT_SOCK_PATH }
    );
    if (!focusRes.ok) return c.json({ error: focusRes.error }, 502);
    return c.json({ focused: true }, 200);
  });
```

- [ ] **Step 5: Implement the button.** In `src/app/runs/GateCard.tsx`, add `const [focusBusy, setFocusBusy] = useState(false);` and `const [focusError, setFocusError] = useState<string | null>(null);` and (a non-2xx response surfaces its reason in the card's existing error styling, per the spec's never-a-dead-button rule; the dead-worktree 400 is the case that matters):

```tsx
  const focusReason =
    gate.status === 'parked'
      ? 'parked; resume is board-owned'
      : gate.origin?.paneId || gate.origin?.worktree
        ? null
        : 'no origin on this gate';

  const focusPaneAction = async () => {
    setFocusBusy(true);
    setFocusError(null);
    try {
      const res = await client.api.gates[':id'].focus.$post({ param: { id: gate.id } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFocusError(body?.error ?? `focus failed (${res.status})`);
      }
    } catch {
      setFocusError('focus failed');
    } finally {
      setFocusBusy(false);
    }
  };
```

Render the error beside the button in the actions `Group`:

```tsx
              {focusError && (
                <Text c="bad" fz={12} data-testid="gate-focus-error">
                  {focusError}
                </Text>
              )}
```

Render it in the actions `Group` next to submit (and in the answered/conflict branches leave the card as is; the button lives only on the actionable branch):

```tsx
              <Button
                size="xs"
                variant="default"
                data-testid="gate-focus"
                disabled={focusReason !== null || focusBusy}
                title={focusReason ?? 'jump into the pane behind this gate'}
                onClick={() => void focusPaneAction()}
              >
                focus pane
              </Button>
```

- [ ] **Step 6: Run green.**

Run: `bunx vitest run src/server/gates.test.ts src/app/runs/GateCard.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/server/gates.ts src/server/gates.test.ts src/app/runs/GateCard.tsx src/app/runs/GateCard.test.tsx
git commit -m "gates ui: origin-resolved focus endpoint and button"
```

---

### Task 12: MATT GATE: surface deploys (board + console) [surface checkpoint]

**MATT GATE: do not proceed without explicit approval at EACH step below.** After this task both surfaces tolerate and render labeled options; ONLY then may any opener emit them.

- [ ] **Step 1:** board repo: push the branch with Tasks 6-9; open the PR titled `gates: W4 surface (labels, context, origin focus, collapse, smalls)`. Wait for CodeRabbit + CI green; address actionable findings.
- [ ] **Step 2:** console repo: push the branch with Tasks 10-11; open the PR titled `gates ui: W4 surface (labels, context, focus, collapse)`. Wait for CodeRabbit + CI green; address actionable findings.
- [ ] **Step 3: MATT GATE.** Present both PRs. Only after explicit approval: merge both.
- [ ] **Step 4: MATT GATE.** Deck restarts for board and console (deploys the merged surfaces). Only after explicit approval. Verify each loads and renders an existing (old-style) gate exactly as before.

---

### Task 13: Board status-bin gate verbs: origin, nudge, presentation, context [board opener lane]

**Files:**
- Modify: `src/gates/verbs.ts:10-15,48-94`
- Modify: `bin/gate.ts:26-31`
- Test: `src/__tests__/gates-verbs.test.ts`

**Interfaces:**
- Consumes: rt-client 0.16.0 payload fields (Task 2); state files carrying `paneId`/`tabId` (`src/review-state.ts:13,26`, `src/respond-state.ts:22,32`, `src/doctor-state.ts:20,28`); `$CLAUDE_CODE_SESSION_ID` in the pane's env.
- Produces (Task 14's wrapper prose depends on these):
  - `FORM_OPTION_CAP = 4` and `presentationFor(questions): "form" | "wait"` (any question with more than 4 options forces wait)
  - `gateOpen(statePath, kind, questionsJson, io, extras?: { context?: string; sessionId?: string; worktree?: string })` returns `{ gateId: string; presentation: "form" | "wait" }`
  - `bin/gate.ts open` accepts `--context <text>`, sources `sessionId` from `process.env.CLAUDE_CODE_SESSION_ID` and `worktree` from `process.cwd()`, and prints ONE JSON line `{"gateId":"...","presentation":"form"|"wait"}`. This deliberately breaks `gate open`'s stdout contract (a bare id becomes a JSON line): its only consumers are the wrapper skills rewritten in Task 14 within this same lane, and the parked-resume path reads `gate wait <state>`, never open output.
  - Open payload rules: origin always stamped (`paneId`/`tabId` from state when present, `worktree`, `presentation`); `pane` set from state `paneId`; nudge `{session}` ONLY when presentation is form and a session id exists; oversize context (over 8192 UTF-8 bytes) is dropped with a stderr note, never truncated.

- [ ] **Step 1: Write the failing tests.** In `src/__tests__/gates-verbs.test.ts`, the existing `gateOpen` tests destructure a string return; update them to `(await gateOpen(...)).gateId` where they assert the id. Then append:

```ts
describe("gateOpen W4 (origin, nudge, presentation, context)", () => {
  const FORM_QUESTIONS = JSON.stringify([
    { id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] },
  ]);
  const OVER_CAP_QUESTIONS = JSON.stringify([
    { id: "threads-1", label: "Threads", multi: true, options: ["a", "b", "c", "d", "e"] },
  ]);

  function stateWithPane(dir: string): string {
    const statePath = join(dir, "state.json");
    writeFileSync(statePath, JSON.stringify({
      mrUrl: MR_URL, iid: IID, status: "reviewing", paneId: "pane-3", tabId: "tab-3",
    }));
    return statePath;
  }

  test("form presentation: origin stamped, pane set, nudge carries the session id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-verbs-w4-"));
    const { io, calls } = fakeIo({ openResult: { ok: true, data: { id: "g1", supersededId: null } } });
    const result = await gateOpen(stateWithPane(dir), "review-post", FORM_QUESTIONS, io, {
      sessionId: "sess-9", worktree: "/tmp/wt", context: "tier counts",
    });
    expect(result).toEqual({ gateId: "g1", presentation: "form" });
    const payload = calls.gateOpen[0]!;
    expect(payload.origin).toEqual({ presentation: "form", paneId: "pane-3", tabId: "tab-3", worktree: "/tmp/wt" });
    expect(payload.pane).toBe("pane-3");
    expect(payload.nudge).toEqual({ session: "sess-9" });
    expect(payload.context).toBe("tier counts");
    rmSync(dir, { recursive: true, force: true });
  });

  test("over the option cap: presentation wait and NO nudge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-verbs-w4-"));
    const { io, calls } = fakeIo({ openResult: { ok: true, data: { id: "g2", supersededId: null } } });
    const result = await gateOpen(stateWithPane(dir), "respond-plan", OVER_CAP_QUESTIONS, io, {
      sessionId: "sess-9", worktree: "/tmp/wt",
    });
    expect(result.presentation).toBe("wait");
    expect(calls.gateOpen[0]!.nudge).toBeUndefined();
    expect(calls.gateOpen[0]!.origin!.presentation).toBe("wait");
    rmSync(dir, { recursive: true, force: true });
  });

  test("oversize context is dropped, not truncated, and the open still succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-verbs-w4-"));
    const { io, calls } = fakeIo({ openResult: { ok: true, data: { id: "g3", supersededId: null } } });
    await gateOpen(stateWithPane(dir), "review-post", FORM_QUESTIONS, io, { context: "x".repeat(8193) });
    expect(calls.gateOpen[0]!.context).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test("presentationFor: 4 options is a form, 5 is a wait", () => {
    const q4 = [{ id: "q", label: "q", multi: false, options: ["a", "b", "c", "d"] }];
    const q5 = [{ id: "q", label: "q", multi: false, options: ["a", "b", "c", "d", "e"] }];
    expect(presentationFor(q4)).toBe("form");
    expect(presentationFor(q5)).toBe("wait");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `bun test src/__tests__/gates-verbs.test.ts`
Expected: FAIL (`presentationFor` missing; `gateOpen` returns a string and passes no origin).

- [ ] **Step 3: Implement.** In `src/gates/verbs.ts`:
  - `GateQuestion.options` type becomes `Array<string | { value: string; label: string }>`.
  - `GateVerbState` gains `paneId?: string; tabId?: string;`.
  - Add:

```ts
export const FORM_OPTION_CAP = 4;
const CONTEXT_CAP_BYTES = 8192;
export type GatePresentation = "form" | "wait";
export interface GateOpenResult { gateId: string; presentation: GatePresentation }

/** The opener picks presentation: the native form tool caps options per
    question, so any question over the cap cannot render as a form and the
    gate takes the idle-wait path instead. */
export function presentationFor(questions: GateQuestion[]): GatePresentation {
  return questions.some((q) => q.options.length > FORM_OPTION_CAP) ? "wait" : "form";
}
```

  - Replace `gateOpen` with:

```ts
export async function gateOpen(
  statePath: string,
  kind: string,
  questionsJson: string,
  io: GateVerbIo,
  extras: { context?: string; sessionId?: string; worktree?: string } = {},
): Promise<GateOpenResult> {
  const questions = JSON.parse(questionsJson) as GateQuestion[];
  const state = readGateVerbState(statePath);
  const domain = domainForKind(kind);
  if (!domain) throw new Error(`gate open: unrecognized kind "${kind}"`);

  let context = extras.context;
  if (context !== undefined && Buffer.byteLength(context, "utf8") > CONTEXT_CAP_BYTES) {
    console.error(`gate open: context exceeds ${CONTEXT_CAP_BYTES} bytes; opening without context`);
    context = undefined;
  }

  const presentation = presentationFor(questions);
  const origin: NonNullable<Commands["gate:open"]["payload"]["origin"]> = { presentation };
  if (state.paneId) origin.paneId = state.paneId;
  if (state.tabId) origin.tabId = state.tabId;
  if (extras.worktree) origin.worktree = extras.worktree;

  const payload: Commands["gate:open"]["payload"] = {
    subject: `mr:${state.mrUrl}`,
    kind,
    questions,
    meta: { label: `${domain} gate !${state.iid}` },
    origin,
  };
  if (state.paneId) payload.pane = state.paneId;
  if (context !== undefined) payload.context = context;
  if (presentation === "form" && extras.sessionId) payload.nudge = { session: extras.sessionId };

  const res = await io.gateOpen(payload);
  if (!res.ok || !res.data) throw new Error(`gate:open failed: ${res.error ?? "unknown error"}`);

  if (domain === "review") {
    writeReviewState(statePath, { status: state.status as ReviewStatus, gateId: res.data.id, gateKind: kind });
  } else if (domain === "respond") {
    writeRespondState(statePath, { status: state.status as RespondStatus, gateId: res.data.id, gateKind: kind });
  } else {
    writeDoctorState(statePath, { status: state.status as DoctorStatus, gateId: res.data.id, gateKind: kind });
  }

  return { gateId: res.data.id, presentation };
}
```

  - In `bin/gate.ts` (open branch, line 26-31):

```ts
  if (verb === "open") {
    const kind = flag(rest, "--kind");
    const questions = flag(rest, "--questions");
    if (!statePath || !kind || !questions) throw new Error("usage: gate open <state> --kind <k> --questions <json> [--context <text>]");
    const result = await gateOpen(statePath, kind, questions, io, {
      context: flag(rest, "--context"),
      sessionId: process.env.CLAUDE_CODE_SESSION_ID,
      worktree: process.cwd(),
    });
    console.log(JSON.stringify(result));
  }
```

- [ ] **Step 4: Run green.**

Run: `bun test && bun run typecheck`
Expected: PASS on both (including the updated pre-existing gateOpen tests).

- [ ] **Step 5: Commit.**

```bash
git add src/gates/verbs.ts bin/gate.ts src/__tests__/gates-verbs.test.ts
git commit -m "status-bin gate open: origin, presentation-keyed nudge, context pre-check"
```

---

### Task 14: Board wrapper skills: fills, form-first, wait fallback, respond collapse [board opener lane]

**Files:**
- Modify: `skills/review/SKILL.md`, `skills/respond/SKILL.md`, `skills/doctor/SKILL.md`

**Interfaces:**
- Consumes: Task 13's status-bin surface (`gate open ... [--context <text>]` printing `{"gateId","presentation"}`; `gate wait <state> --max-ms <n>`; `gate answer <state> --answers <json> --by pane`); the collapse vocabulary (`respond-plan`, `code-changes`, `skip`); the 200-byte label cap and 8KB context cap.
- Produces: wrapper prose that assembles labeled options and context, branches on the printed `presentation`, and replaces the bounded foreground wait loop with the form or the idle background wait.

These are skill files: **load `superpowers:writing-skills` before editing** and follow it for voice and structure. House rule for this repo's prose: no em or en dashes.

- [ ] **Step 1: Load the writing-skills skill** (`superpowers:writing-skills`) and read all three SKILL.md files end to end.

- [ ] **Step 2: Insert the shared gate protocol block.** In EACH of the three files, replace the current open-then-bounded-wait instructions (review: the `Open the gate` / `Wait for the answer` bullets and their re-run loop text; respond: the same pattern at both Gate 1 and Gate 2; doctor: its escalation-gate open/wait section) with this block, substituting each site's own `--kind` and keeping each file's surrounding numbering intact:

```markdown
- **Open the gate:**
  `<status-bin> gate open <state> --kind <the kind for this site> --questions <json> --context <context text>`
  The output is one JSON line: `{"gateId": "...", "presentation": "form"}` or `"wait"`.
  The context text is assembled from strings you already hold (see the fill
  rules for this wrapper below); if it would exceed 8192 UTF-8 bytes, omit
  `--context` entirely rather than trimming it.
- **presentation "form":** present the SAME questions as the native
  structured-question form. Render each option's `label` when it has one
  and submit the chosen option's `value` verbatim; never an index, never a
  paraphrase. Submit exactly one
  `<status-bin> gate answer <state> --answers <json> --by pane` after the
  form. A printed conflict answer means another surface won: say so in one
  line and proceed on the printed winning answer. If the form is dismissed
  under you and a message arrives saying the gate was answered elsewhere,
  that message is a verify-only signal and never carries the answer: run
  `<status-bin> gate wait <state> --max-ms 1000`, read the recorded
  answer, and proceed on it.
- **presentation "wait":** do NOT present a form. Launch ONE background
  shell command (the shell tool's run-in-background mode) that loops
  `<status-bin> gate wait <state> --max-ms 90000`, re-running while it
  prints `{"status":"pending"}`, and exits printing the answered JSON as
  its last stdout. Then END YOUR TURN in one line: `holding at gate
  <gateId>`. The pane is idle but armed: typed input lands instantly, and
  the loop's completion re-invokes this pane with the answer as the tool
  result. On re-invoke, proceed on the answer exactly as the form branch
  does. A wait that fails with a closed or not-found message is terminal:
  follow this wrapper's existing closed-gate rules.
```

- [ ] **Step 3: Review fill rules.** In `skills/review/SKILL.md`, where the gate's questions are built, add:

```markdown
Options carry display labels: the `tiers` question's options are
`{"value": "<Tier>", "label": "<Tier> (<count>)"}` objects, the count being
that tier's finding count from the report (e.g. value `Major`, label
`Major (2)`); the `outcome` options stay bare strings. The `--context`
text is the tier counts line followed by one line per finding title from
the report, verbatim from the report file, never re-summarized.
```

- [ ] **Step 4: Respond fill rules + collapse.** In `skills/respond/SKILL.md`, amend the Gate 1 question shape (the JSON block near line 158-171):
  - Thread options become labeled objects: `{"value": "fix:<threadId>", "label": "fix · <file>:<line>"}` (same for `reply:`/`skip:` with their verb labels). Add the clamp rule:

```markdown
Labels are display text with a 200 UTF-8 byte cap. Compose them from the
thread's file and line; when a path would push a label past the cap,
middle-truncate the path portion (keep the filename and line). Never let
a label's length fail the open; the value string is never altered.
```

  - The `code-changes` question's options become `["approve", "revise", "skip"]` with one sentence:

```markdown
`skip` is the no-code-changes sentinel: surfaces hide the code-changes
question until a `fix:` option is selected and submit `skip` for it while
hidden, so it must always be present in the options.
```

  - Single-thread collapse, added where the questions are built:

```markdown
When exactly ONE unresolved thread exists, build ONE merged single-select
question instead of the group-plus-code-changes pair: id `threads-1`,
options the thread's `reply:<id>`/`fix:<id>`/`skip:<id>` triple (labeled
as above). The verb choice implies the disposition; do not add a
code-changes question to a single-thread gate.
```

  - Context rule: `--context` is the reviewer thread quoted verbatim plus the drafted reply or fix summary for each thread, within the 8KB cap.
  - Append to the pasted form branch IN THIS FILE (the pane is the third implementation of the collapse, alongside the board and console cards):

```markdown
On a respond-plan gate, hide the code-changes question until a `fix:`
value is chosen and submit `skip` for it while hidden, exactly as the
board and console cards do (ask the thread questions first, then either
ask code-changes or fill `skip`, still ONE gate answer at the end).
```

  Note for the implementer: this branch is structurally unreachable today (a multi-thread gate's threads question exceeds the option cap and opens as wait; a single-thread gate carries no code-changes question), but the rule is pinned so a future shape change cannot silently diverge the pane form from the cards.

- [ ] **Step 5: Doctor fill rules.** In `skills/doctor/SKILL.md`, where the escalation gate's options are built, add: options keep their short verb values and gain fuller labels (`{"value": "retry", "label": "retry the failed job"}` shape, each site's own wording); `--context` is the situation line the escalation already composes.

- [ ] **Step 6: Consistency pass.** Re-read each edited file whole: the old bounded-foreground-wait loop text must be GONE (no instruction anywhere to run `gate wait` in the foreground and re-run it in the turn), the `--resumed-gate` re-entry sections stay untouched, and no em or en dashes were introduced. Run `bun test` (board suite; prose changes must not break the wrapper-adjacent tests).

- [ ] **Step 7: Commit.**

```bash
git add skills/review/SKILL.md skills/respond/SKILL.md skills/doctor/SKILL.md
git commit -m "wrappers: labeled fills with context, form-first protocol, idle wait, respond collapse"
```

---

### Task 15: MATT GATE: board opener deploy [board opener checkpoint]

**MATT GATE: do not proceed without explicit approval at EACH step below.** Both surfaces are already live (Task 12), so labeled options from board wrappers are safe to emit after this deploy.

- [ ] **Step 1:** board repo: push the branch with Tasks 13-14; open the PR titled `gates: W4 opener (status-bin origin/presentation, wrapper fills, form-first)`. Wait for CodeRabbit + CI green; address actionable findings.
- [ ] **Step 2: MATT GATE.** Present the PR. Only after explicit approval: merge.
- [ ] **Step 3: MATT GATE.** Deck restart for the board. Only after explicit approval. Sanity: launch a review on a scratch MR; the gate row (inspect `rt gate list --subject-prefix mr: --open`) must carry `origin` with `presentation` and the board card must render labels.

---

### Task 16: Engine gate-protocol part: origin, presentation, nudge keying, idle wait, priming [engine lane]

**Files:**
- Modify: `attachments/gate-protocol/SKILL.md`
- Modify: `CERTIFICATION.md` (ledger row)

**Interfaces:**
- Consumes: `rt gate open ... --context <text> --origin <json>` (Task 4), `rt gate wait <id> [--timeout <duration>]` (existing), `rt runs field set KEY VALUE --stage NAME` (existing), herdr pane env (`HERDR_ENV=1`, `HERDR_PANE_ID`), the option cap (4).
- Produces: the ONE shared-part edit every pipeline/forge/review gate site inherits at recompile; the `waiting-gate` marker write/clear contract Task 17's hook reads (`rt runs field set waiting-gate <gateId> --stage <stage>` to set, value `-` to clear).

This is a skill file: **load `superpowers:writing-skills` before editing.** Engine prose uses `--`, never em dashes.

- [ ] **Step 1: Load writing-skills and read `attachments/gate-protocol/SKILL.md` whole.**

- [ ] **Step 2: Add a Presentation section.** After the `## Attendance` section, insert:

```markdown
## Presentation

Herdr panes are form-first: when `HERDR_ENV=1` and every question fits the
native form tool's per-question option cap (4 options), the gate opens
with `presentation: "form"` and the pane presents the form regardless of
attendance -- a human can focus in from any surface and answer it, and an
unattended pane blocks on its form harmlessly until some surface answers.
Any question over the cap, or a spawned non-herdr pane, means
`presentation: "wait"` (the idle wait below). A human-run non-herdr pane
keeps the plain attended form path unchanged.

The nudge follows PRESENTATION, not attendance: every form open passes
`--nudge` with this pane's own session id; wait opens never do (there, the
wait is the delivery). The daemon completes a remotely answered form by
queueing the doorbell and then injecting a single Escape into the pane
named by `origin.paneId`.
```

- [ ] **Step 3: Rewrite Runs integration step 2.** Replace the current step 2 (`**Bracket and publish.**` through its code block) with:

```markdown
2. **Bracket and publish.** Keep the run-record bracket, then open the
   gate. Guard first: an empty `$RUN_ID` must never reach `gate open` (an
   empty id mints a junk `run:` subject the daemon accepts) -- treat it as
   the daemon-down fallback in step 6. Pick presentation per the
   Presentation section, then stamp origin and context. Context is a
   VERBATIM QUOTE of the material the decision is about (the task summary
   from the brief, the plan section under decision, the failing check
   output), never a freshly composed summary; measure it with
   `LC_ALL=C wc -c` and omit `--context` when over 8192 bytes. Emit
   labeled options (`{"value": "...", "label": "..."}`) whenever a
   site's option values are not already human-readable; labels cap at 200
   UTF-8 bytes -- middle-truncate a long path, never alter the value.

   The open runs ONLY inside the non-empty branch; the empty branch stops
   this recipe and takes step 6's fallback.

   ```bash
   rt runs field set gate <scope> --stage <stage>
   if [ -z "$RUN_ID" ]; then
     echo "gate site: no run id; not opening a run: gate. STOP: take step 6's fallback." >&2
   else
     ORIGIN=$(python3 - "$RUN_ID" <<'EOF'
   import json, os, sys
   o = {"runId": sys.argv[1], "worktree": os.getcwd(),
        "presentation": os.environ.get("GATE_PRESENTATION", "wait")}
   pane = os.environ.get("HERDR_PANE_ID")
   if pane:
       o["paneId"] = pane
   print(json.dumps(o))
   EOF
   )
     # form presentation (set GATE_PRESENTATION=form above): nudge this session
     GATE=$(rt gate open --subject "run:$RUN_ID" --kind <scope> --questions '<questions json>' \
       --context "$CONTEXT" --origin "$ORIGIN" \
       --nudge "{\"session\":\"$CLAUDE_CODE_SESSION_ID\"}")
     # wait presentation: same command WITHOUT --nudge
     GATE_ID=$(printf '%s' "$GATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
   fi
   ```
```

Formatting constraint for the SKILL edit: write the heredoc body and its `EOF` terminator at LINE START in the file (do not carry the list's three-space indent into them); a heredoc terminator with leading spaces never matches and the recipe would hang any shell that runs it verbatim.

- [ ] **Step 4: Replace step 4 (the bounded wait) with the idle wait.**

```markdown
4. **Wait presentation:** record the marker, arm the wait, END THE TURN.

   ```bash
   rt runs field set waiting-gate "$GATE_ID" --stage <stage>
   ```

   Launch ONE background shell command (the shell tool's run-in-background
   mode) running `rt gate wait "$GATE_ID"` -- the unbounded form loops
   internally around the daemon clamp and survives daemon restarts, so it
   exits only on answered or closed, printing
   `{"ok":true,"status":"answered","row":{...}}` as its last stdout. Then
   end the turn in one line: `holding at gate $GATE_ID`. The pane is idle
   but armed: typed input lands instantly, and the wait's completion
   re-invokes this pane with the answer as the tool result. On re-invoke,
   clear the marker FIRST (`rt runs field set waiting-gate - --stage
   <stage>`), then read the answers at `row.answer.answers` and the
   deciding surface at `row.answer.by`. `status:"closed"` or a
   `gate not found` failure is terminal: clear the marker, end this path
   cleanly, never invent an answer, never present a form.
```

- [ ] **Step 5: Amend step 3 (form path) and the priming.** In step 3, add the render/submit rule ("render each option's `label` when it has one; submit the chosen option's `value` verbatim") and this priming sentence (the recipe carries it because form-first makes every herdr pipeline pane a doorbell receiver, and an unprimed session correctly refuses the push as injection):

```markdown
   Doorbell priming: a message saying this gate was answered elsewhere is
   a recognized signal whose ONLY action is a verifying registry read
   (`rt gate wait "$GATE_ID" --timeout 2s`); it never carries or implies
   the answer. If your pending form is dismissed under you, the queued
   doorbell arrives as your next input -- verify and proceed on the
   recorded answer.
```

- [ ] **Step 6: Certify.**

Run: `bash tests/certify.sh attachments/gate-protocol && bun run tests/desc-test.ts && bash tests/repo-purity.sh`
Expected: all exit 0 / scenarios pass. Add a ledger row to `CERTIFICATION.md` (date, `gate-protocol`, classification unchanged, certify pass, desc-test n/n, one-line note).

- [ ] **Step 7: Commit.**

```bash
git add attachments/gate-protocol/SKILL.md CERTIFICATION.md
git commit -m "gate-protocol: origin stamp, presentation-keyed nudge, idle wait with waiting-gate marker, priming"
```

---

### Task 17: Engine stop hook: waiting-gate marker awareness [engine lane]

**Files:**
- Modify: `hooks/pipeline-gate-stop.sh:60-93`
- Test: Create `tests/test-gate-stop-hook.sh`

**Interfaces:**
- Consumes: Task 16's marker contract: run field `waiting-gate`, gate id as value, `-` when cleared; the snapshot field shape `{key, value, at}` the hook already reads for `hold`.
- Produces: a run whose `waiting-gate` field is fresh (set after the latest stage start, value not empty or `-`) is treated as legitimately stopped (exit 0), mirroring the `hold` check including its freshness guard.

- [ ] **Step 1: Write the failing test.** Create `tests/test-gate-stop-hook.sh` (mode 755):

```sh
#!/bin/sh
# Exercises hooks/pipeline-gate-stop.sh with a PATH-stubbed rt: a running
# run with a fresh waiting-gate marker must not block the stop (exit 0);
# the same run without it must block (exit 2).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/hooks/pipeline-gate-stop.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/runs/repo/run1"
touch "$TMP/runs/repo/run1/state.db"

cat > "$TMP/bin/rt" <<'FAKE'
#!/bin/sh
case "$1 $2" in
  "runs find") cat "$FAKE_FIND" ;;
  "runs snapshot") cat "$FAKE_SNAP" ;;
  *) exit 1 ;;
esac
FAKE
chmod +x "$TMP/bin/rt"

cat > "$TMP/find.json" <<EOF
{"ok":true,"runs":[{"runDb":"$TMP/runs/repo/run1/state.db"}]}
EOF

snapshot() {
  # $1 = extra fields JSON rows (may be empty)
  cat > "$TMP/snap.json" <<EOF
{"run":{"id":"run1","status":"running","current_stage":"implement","started_at":100},
 "stages":[{"stage":"implement","started_at":100}],
 "fields":[{"key":"claude-session","value":"sess-1","at":150}$1]}
EOF
}

run_hook() {
  printf '%s' '{"session_id":"sess-1"}' | \
    PATH="$TMP/bin:$PATH" RT_RUNS_ROOT="$TMP/runs" \
    FAKE_FIND="$TMP/find.json" FAKE_SNAP="$TMP/snap.json" \
    sh "$HOOK" >/dev/null 2>&1
}

snapshot ""
if run_hook; then echo "FAIL: open run did not block the stop"; exit 1; fi

snapshot ',{"key":"waiting-gate","value":"g1","at":150}'
if ! run_hook; then echo "FAIL: fresh waiting-gate marker still blocked the stop"; exit 1; fi

snapshot ',{"key":"waiting-gate","value":"g1","at":50}'
if run_hook; then echo "FAIL: STALE waiting-gate marker (before stage start) did not block"; exit 1; fi

snapshot ',{"key":"waiting-gate","value":"-","at":150}'
if run_hook; then echo "FAIL: cleared waiting-gate marker did not block"; exit 1; fi

echo "ok"
```

Note the stub `rt` reads `$FAKE_FIND`/`$FAKE_SNAP` from the environment; `run_hook` passes them explicitly, so no state leaks between cases.

- [ ] **Step 2: Run to verify failure.**

Run: `sh tests/test-gate-stop-hook.sh`
Expected: `FAIL: fresh waiting-gate marker still blocked the stop` (the first case passes already; the marker cases fail).

- [ ] **Step 3: Implement.** In `hooks/pipeline-gate-stop.sh`, inside the python block (line 70-76), after the `held` line add the parallel check and fold it into the state:

```python
wg = fields.get("waiting-gate") or {}
waiting = wg.get("value") not in (None, "", "-") and int(wg.get("at") or 0) > last_start
print("%d|%s|%s|%s" % (int(run.get("started_at") or 0), run.get("id") or "?", run.get("current_stage") or "unknown", "held" if (held or waiting) else "open"))
```

(The existing `print` line is replaced; `hold`/`held` stay as they are.) In the blocking heredoc (line 90-92), extend the exits list with: `` or arm a gate wait (`rt runs field set waiting-gate <gateId> --stage $STAGE`, fire the background wait per gate-protocol, end the turn)``.

- [ ] **Step 4: Run green.**

Run: `sh tests/test-gate-stop-hook.sh && bash tests/repo-purity.sh`
Expected: `ok`; purity clean.

- [ ] **Step 5: Commit.**

```bash
git add hooks/pipeline-gate-stop.sh tests/test-gate-stop-hook.sh
git commit -m "stop hook: a fresh waiting-gate marker is a legitimate stop"
```

---

### Task 18: Engine forge parts: no-run spawned-context guard [engine lane]

**Files:**
- Modify: `attachments/forge/checkout/SKILL.md:33-41`, `attachments/forge/rebase-worktree/SKILL.md:90-96,111-122`
- Modify: `CERTIFICATION.md` (ledger rows)

**Interfaces:**
- Consumes: the launch-instruction spawned convention (the same signal `run-start --spawned-by` is taken from; a board wrapper invocation counts as spawned per se).
- Produces: no forge gate site can strand a spawned pane on an unwatched in-pane form.

This edits skill files: **load `superpowers:writing-skills` before editing.**

- [ ] **Step 1: Load writing-skills and read both files whole.**

- [ ] **Step 2: Replace every occurrence** of the sentence `With no run, present the same form in-pane only.` (one in checkout, two in rebase-worktree). The sentence is LINE-WRAPPED in all three occurrences, so an exact one-line string replace will not match: `attachments/forge/checkout/SKILL.md:40-41` wraps as `...in-pane` / `only.` and is followed by `Never a guess.`, which STAYS; `attachments/forge/rebase-worktree/SKILL.md:95-96` and `:118-119` wrap similarly. Replace with:

```markdown
With no run: a human invocation presents the same form in-pane only. A
SPAWNED pane (the launch instruction said a surface spawned this pane --
the same signal `run-start --spawned-by` is taken from; a board wrapper
invocation counts as spawned per se) never presents a form here: nobody
is watching the pane and no gate row reaches any surface. End this path
instead with one error line the spawning surface can read (its own
status or report channel when it has one, stderr otherwise) and stop.
```

- [ ] **Step 3: Certify.**

Run: `bash tests/certify.sh attachments/forge/checkout && bash tests/certify.sh attachments/forge/rebase-worktree && bash tests/repo-purity.sh && bun run tests/desc-test.ts`
Expected: all clean. Add ledger rows for both parts to `CERTIFICATION.md`.

- [ ] **Step 4: Commit.**

```bash
git add attachments/forge/checkout/SKILL.md attachments/forge/rebase-worktree/SKILL.md CERTIFICATION.md
git commit -m "forge parts: spawned no-run contexts error out instead of presenting unwatched forms"
```

---

### Task 19: MATT GATE: engine release + team pack recompile + plugin updates [engine checkpoint]

**MATT GATE: do not proceed without explicit approval at EACH step below.** Engine goes LAST among openers: pipeline gates render on the console, which Task 12 already deployed.

- [ ] **Step 1:** engine repo: run the full check battery (`bun test`, `bash tests/repo-purity.sh`, `bash tests/certify.sh` on each edited part, `sh tests/test-gate-stop-hook.sh`). All green.
- [ ] **Step 2:** Version bump per the same-commit convention: `.claude-plugin/plugin.json` (currently `"version": "0.15.0"` at line 3) to 0.16.0 (or the next minor from whatever main holds), commit message suffix `; bump to <version>`.
- [ ] **Step 3: MATT GATE.** Present the engine branch. Only after explicit approval: push/merge to engine main.
- [ ] **Step 4: MATT GATE.** Team pack recompile: in the team pack's repo, recompile against the new engine (`rt skills compile`; if the installed rt predates the RT-110 release, use the documented `--pack-dir` escape hatch). Then the plugin update for every consuming surface. Each push/update individually approved.
- [ ] **Step 5:** Sanity: start a scratch pipeline run to a `clarify` gate in a herdr pane; `rt gate list --subject-prefix run: --open` must show the gate carrying `origin` (with `runId`, `worktree`, `paneId`, `presentation`) and, for a labeled site, `{value,label}` options; the console must render it with labels and context.

---

### Task 20: Live verification pass [wave close]

**MATT GATE: this whole task runs live with Matt; schedule it, do not improvise it unattended.** Items map 1:1 to spec section 8.

- [ ] **1. Remote completion:** answer an in-pane form from the console; the pane's form dismisses via the injected Escape and the wrapper proceeds with the winner (transcript shows the doorbell as the next input).
- [ ] **2. In-pane win:** answer the same wrapper's next form in-pane; the console shows the conflict plus winning row (409 path).
- [ ] **3. Focus:** focus a pane from a console run-gate card (origin.paneId direct) and from a board card (origin-based, not a state join); both raise the right pane.
- [ ] **4. Labels + context:** a pipeline gate renders `{value,label}` options and its verbatim quoted context on the console.
- [ ] **5. Respond collapse:** a single-thread respond run produces the merged one-question form; a multi-thread run with no fix selected submits the hidden `skip` sentinel (check the recorded answer on the row).
- [ ] **6. Idle wait + stop hook:** a wait-presentation gate goes idle (background wait armed, turn ended with `holding at gate <id>`), typed input lands instantly, a remote answer re-invokes the pane with the row, and the stop hook does not block the idle turn.
- [ ] **Close:** record outcomes in the task report; any FAIL becomes a follow-up task before the wave closes.
