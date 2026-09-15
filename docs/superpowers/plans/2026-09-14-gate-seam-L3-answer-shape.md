# L3: Canonical gate answer-shape in rt-client (RT-144)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One canonical implementation of gate answer validation and the presentation cap, in rt-client, consumed by the daemon.

**Architecture:** Two new rt-client modules (`gate-answers.ts`, `gate-presentation.ts`) whose logic is lifted verbatim from `lib/daemon/handlers/gate.ts`; the daemon then imports them. Behavior change: none (pure extraction).

**Tech Stack:** Bun, TypeScript, bun test.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 1)

## Global Constraints

- Contracts C1, C2, C10 in `docs/superpowers/plans/2026-09-14-gate-seam-00-contracts.md` are binding; signatures verbatim.
- This lane merges BEFORE L2 (RT-143). Announce the merge in #rt (touches packages/rt-client and handlers/gate.ts).
- After every rt-client source change: `bun run build` in `packages/rt-client` (dist-freshness test guards this).
- `bun run test:all` before calling the lane verified; `bun run test` alone is not the CI gate.
- No SCHEMA_VERSION, no db schema changes. No UI imports in CLI code.
- rt-client publish (version bump to npm) is release-class: from main only, after merge, announced; the lane prepares the bump commit but does NOT publish from the branch.

---

### Task 1: gate-presentation module

**Files:**
- Create: `packages/rt-client/src/gate-presentation.ts`
- Test: `packages/rt-client/test/gate-presentation.test.ts`
- Modify: `packages/rt-client/src/index.ts` (add exports)

**Interfaces:**
- Consumes: `GateQuestion` from `./commands.ts`.
- Produces: `GATE_FORM_OPTION_CAP` (4), `gatePresentation({paneId?, sessionId?, questions}): "form" | "wait"` exactly as contract C1.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rt-client/test/gate-presentation.test.ts
import { describe, expect, test } from "bun:test";
import { GATE_FORM_OPTION_CAP, gatePresentation } from "../src/gate-presentation.ts";
import type { GateQuestion } from "../src/commands.ts";

const q = (n: number): GateQuestion => ({
  id: "q1", label: "pick", multi: false,
  options: Array.from({ length: n }, (_, i) => `opt${i}`),
});

describe("gatePresentation", () => {
  test("cap is 4", () => expect(GATE_FORM_OPTION_CAP).toBe(4));
  test("form when pane + session + all questions at or under cap", () => {
    expect(gatePresentation({ paneId: "w1:p1", sessionId: "s", questions: [q(4), q(2)] })).toBe("form");
  });
  test("wait when any question exceeds the cap", () => {
    expect(gatePresentation({ paneId: "w1:p1", sessionId: "s", questions: [q(5)] })).toBe("wait");
  });
  test("wait without a pane", () => {
    expect(gatePresentation({ sessionId: "s", questions: [q(2)] })).toBe("wait");
  });
  test("wait without a session", () => {
    expect(gatePresentation({ paneId: "w1:p1", questions: [q(2)] })).toBe("wait");
  });
  test("zero-option questions never force wait", () => {
    expect(gatePresentation({ paneId: "w1:p1", sessionId: "s", questions: [q(0)] })).toBe("form");
  });
});
```

- [ ] **Step 2: Run it, expect module-not-found failure**

Run: `cd packages/rt-client && bun test test/gate-presentation.test.ts`
Expected: FAIL (cannot resolve ../src/gate-presentation.ts)

- [ ] **Step 3: Implement**

```ts
// packages/rt-client/src/gate-presentation.ts
import type { GateQuestion } from "./commands.ts";

export const GATE_FORM_OPTION_CAP = 4;

/** The ONE presentation rule (spec Phase 1): form iff an injectable pane
    exists, a nudge target exists, and every question fits the native form's
    per-question option cap. */
export function gatePresentation(args: {
  paneId?: string | undefined;
  sessionId?: string | undefined;
  questions: GateQuestion[];
}): "form" | "wait" {
  if (!args.paneId || !args.sessionId) return "wait";
  return args.questions.every((q) => q.options.length <= GATE_FORM_OPTION_CAP)
    ? "form"
    : "wait";
}
```

Add to `packages/rt-client/src/index.ts`, beside the existing gate exports:

```ts
export { GATE_FORM_OPTION_CAP, gatePresentation } from "./gate-presentation.ts";
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd packages/rt-client && bun test test/gate-presentation.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/gate-presentation.ts packages/rt-client/test/gate-presentation.test.ts packages/rt-client/src/index.ts
git commit -m "rt-client: gate-presentation module (GATE_FORM_OPTION_CAP, gatePresentation)"
```

### Task 2: gate-answers module

**Files:**
- Create: `packages/rt-client/src/gate-answers.ts`
- Test: `packages/rt-client/test/gate-answers.test.ts`
- Modify: `packages/rt-client/src/index.ts`
- Read first: `lib/daemon/handlers/gate.ts:146-184` (the source logic, lifted verbatim)

**Interfaces:**
- Consumes: `GateQuestion`, `gateOptionValue` from `./commands.ts`.
- Produces: `unwrapGateAnswerValue(raw: unknown): unknown`, `validateGateAnswers(questions: GateQuestion[], answers: Record<string, unknown>): string | null` exactly as contract C2. Error strings BYTE-IDENTICAL to today's daemon strings (e2e tests assert them verbatim).

- [ ] **Step 1: Write the failing test**

```ts
// packages/rt-client/test/gate-answers.test.ts
import { describe, expect, test } from "bun:test";
import { unwrapGateAnswerValue, validateGateAnswers } from "../src/gate-answers.ts";
import type { GateQuestion } from "../src/commands.ts";

const single: GateQuestion = { id: "verdict", label: "v", multi: false, options: ["yes", { value: "no", label: "No" }] };
const multi: GateQuestion = { id: "tiers", label: "t", multi: true, options: ["a", "b"] };
const freeform: GateQuestion = { id: "note", label: "n", multi: false, options: [] };

describe("unwrapGateAnswerValue", () => {
  test("bare values pass through", () => expect(unwrapGateAnswerValue("yes")).toBe("yes"));
  test("note form unwraps", () => expect(unwrapGateAnswerValue({ value: "yes", note: "x" })).toBe("yes"));
  test("arrays pass through", () => expect(unwrapGateAnswerValue(["a"])).toEqual(["a"]));
});

describe("validateGateAnswers", () => {
  test("valid single + multi + freeform", () => {
    expect(validateGateAnswers([single, multi, freeform], { verdict: "no", tiers: ["a"], note: "anything" })).toBeNull();
  });
  test("unknown question id", () => {
    expect(validateGateAnswers([single], { verdict: "yes", extra: "x" })).toBe("unknown question id: extra");
  });
  test("multi expects array", () => {
    expect(validateGateAnswers([multi], { tiers: "a" })).toBe("question tiers expects an array (multi)");
  });
  test("single rejects array", () => {
    expect(validateGateAnswers([single], { verdict: ["yes"] })).toBe("question verdict expects a single value");
  });
  test("non-string element", () => {
    expect(validateGateAnswers([multi], { tiers: [1] })).toBe("question tiers value must be a string");
  });
  test("membership by value, labels never match", () => {
    expect(validateGateAnswers([single], { verdict: "No" })).toBe('answer for "verdict" is not one of its options: "No"');
  });
  test("empty options = free-form", () => {
    expect(validateGateAnswers([freeform], { note: "whatever" })).toBeNull();
  });
  test("missing answers named", () => {
    expect(validateGateAnswers([single, multi], { verdict: "yes" })).toBe("missing answer(s) for: tiers");
  });
  test("explicit empty multi array is valid", () => {
    expect(validateGateAnswers([multi], { tiers: [] })).toBeNull();
  });
  test("note-form values validate by inner value", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: "hold on" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect module-not-found failure**

Run: `cd packages/rt-client && bun test test/gate-answers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement by lifting gate.ts logic verbatim**

```ts
// packages/rt-client/src/gate-answers.ts
import type { GateQuestion } from "./commands.ts";
import { gateOptionValue } from "./commands.ts";

/** Both wire shapes carry the same value underneath: bare, or {value, note?}
    when a panel attaches free text. Validation reads only the value. */
export function unwrapGateAnswerValue(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

/** Option membership is required whenever a question declares options,
    checked against the unwrapped value (every element, for multi); an
    empty options array stays free-form. Every question id must appear as
    an answers key. Error strings are a wire contract: e2e asserts them. */
export function validateGateAnswers(
  questions: GateQuestion[],
  answers: Record<string, unknown>,
): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [qid, raw] of Object.entries(answers)) {
    const question = byId.get(qid);
    if (!question) return `unknown question id: ${qid}`;
    const value = unwrapGateAnswerValue(raw);
    const isArray = Array.isArray(value);
    if (question.multi && !isArray) return `question ${qid} expects an array (multi)`;
    if (!question.multi && isArray) return `question ${qid} expects a single value`;
    const values = isArray ? (value as unknown[]) : [value];
    if (!values.every((v) => typeof v === "string")) return `question ${qid} value must be a string`;
    if (question.options.length > 0) {
      const members = question.options.map(gateOptionValue);
      for (const v of values as string[]) {
        if (!members.includes(v)) return `answer for "${qid}" is not one of its options: "${v}"`;
      }
    }
  }
  const missing = questions.map((q) => q.id).filter((id) => !(id in answers));
  if (missing.length > 0) return `missing answer(s) for: ${missing.join(", ")}`;
  return null;
}
```

Index exports:

```ts
export { unwrapGateAnswerValue, validateGateAnswers } from "./gate-answers.ts";
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd packages/rt-client && bun test test/gate-answers.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/gate-answers.ts packages/rt-client/test/gate-answers.test.ts packages/rt-client/src/index.ts
git commit -m "rt-client: canonical gate answer-shape module"
```

### Task 3: daemon consumes the module

**Files:**
- Modify: `lib/daemon/handlers/gate.ts` (delete `unwrapAnswerValue` at 146-153 and `validateAnswers` at 163-184; import from rt-client)
- Test: existing suites are the guard; no new test file

**Interfaces:**
- Consumes: Task 2's exports via `../../../packages/rt-client/src/gate-answers.ts` (the handler already imports commands.ts by that path pattern, gate.ts:8-9).
- Produces: unchanged handler behavior; `runAttentionRouting` keeps using the unwrap (rename call sites from `unwrapAnswerValue` to `unwrapGateAnswerValue`).

- [ ] **Step 1: Replace the local functions with imports**

In `lib/daemon/handlers/gate.ts`: remove the two local functions; add to the imports:

```ts
import { unwrapGateAnswerValue, validateGateAnswers } from "../../../packages/rt-client/src/gate-answers.ts";
```

Rename the three call sites (`validateAnswers(gate.questions, ...)` in gate:answer; `unwrapAnswerValue` in runAttentionRouting and deepEqual-adjacent retry path) accordingly.

- [ ] **Step 2: Run the gate handler suites**

Run: `bun test lib/daemon --test-name-pattern gate 2>&1 | tail -5` then the full `bun run test`
Expected: PASS, zero behavior change

- [ ] **Step 3: Run e2e**

Run: `bun run test:all`
Expected: PASS (the verbatim error-string assertions in e2e/tests prove the extraction preserved the wire contract)

- [ ] **Step 4: Build rt-client dist + bump version (no publish)**

```bash
cd packages/rt-client && bun run build && cd ../..
```

Bump `packages/rt-client/package.json` version by a minor (new exports). Do NOT `npm publish` from the branch (release-class, main only).

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/gate.ts packages/rt-client/package.json
git commit -m "daemon: consume rt-client gate-answers module; bump rt-client"
```

### Task 4: lane wrap

- [ ] **Step 1:** `bun run test:all` green; `bun run picker:check` green (no tree changes expected, run anyway).
- [ ] **Step 2:** Announce in #rt: "L3 merging: rt-client gains gate-answers + gate-presentation; handlers/gate.ts now imports them. L2 rebases on this."
- [ ] **Step 3:** Push branch, open PR titled "RT-144: canonical gate answer-shape + presentation modules in rt-client", body per repo conventions.
