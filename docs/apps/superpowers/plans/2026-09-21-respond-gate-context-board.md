# Respond Gate Structured Context (board side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The decision-queue modal renders respond gates that carry gate-ctx@1 JSON as a header card, per-thread cards, and a replies card, while every prose gate keeps rendering exactly as today.

**Architecture:** One pure parser (`gate-ctx.ts`) turns a context string into a typed discriminated union or `null`. `GateForm` branches on the parse of each question's `context` (thread card, replies card, else today's prose block); `DecisionQueueModal` branches on the parse of the gate-level `context` (header card in place of the MR strip and the context pane, else today's strip and pane). Three declared CSS fixes apply to every gate.

**Tech Stack:** React 19, `@mattstack/tui-kit` (Markdown, Chip, Modal, ScrollPane), `@mattstack/gate-kit/react` (Questionnaire), `invadrs/react` (avatar), bun:test + happy-dom for DOM tests, Playwright for the layout test and the capture harness.

**Spec:** `docs/superpowers/specs/2026-09-21-respond-gate-context-design.md` (read it before starting any task; where this plan and the spec disagree, the spec wins).

## Global Constraints

- Everything lives under `apps/board/**`. No rt daemon, rt-client, gate registry, board server, or gate-kit change.
- Review gates and the prose parser `apps/board/src/client/board/gate-context.ts` are untouched.
- A gate or question whose context does not parse as gate-ctx renders exactly as today, apart from the three declared CSS changes (question-context colour, the context floor, the choice-subtitle colour).
- `parseGateCtx` returns `null` for anything non-conforming: prose, malformed JSON, non-object JSON, unknown or missing `"gate-ctx"` tag, a missing required field, or any present field of the wrong type. Unknown extra keys are accepted and dropped. No partial parses.
- This repo is PUBLIC. Every name, file path, ticket id, MR title and comment body in tests and fixtures is invented. `./scripts/repo-purity.sh` must pass.
- Comments follow the clean-code rule: a comment states a constraint the code cannot show. No narration, no ticket ids, no task numbers, no review history in source.
- No em dashes or en dashes anywhere (code, comments, commit messages). Use "..." or rephrase.
- Contract amendment (settled emitter-side after the spec was written; authoritative until the spec is amended at integration): `thread@1` `verdict.call` is `"valid" | "valid-low-value" | "pushback" | "needs-clarification" | "no-ask"`. `"invalid"` is dropped and must fail the parse. `pushback` renders with the bad hue; `needs-clarification` is a hold state with the accent hue, and its question for the reviewer rides `verdict.note`.
- `bun run tui-kit:build` must run once before any board gate (board consumes tui-kit's `dist/`).
- Gates, run from the repo root: `bun run board:typecheck && bun run board:test && bun run lint && bun run board:build && bun run format:check && ./scripts/repo-purity.sh`. (The brief names `board:lint`; no such script exists. Root `bun run lint` is what CI runs, and it covers `apps/board/src/**/*.css`.)
- Run `bunx prettier --write <files you touched>` before each commit; the root has an import-sorting prettier plugin.
- Commit at the end of every task. Never push.

## Derived decisions (the spec leaves these open)

1. **Prose context pane after the floor.** Deleting only `min-height` would let the pane shrink to nothing at laptop heights (the kit ScrollPane's own `min-height: 0` takes over, and that collapse is why the floor was added). So the pane also becomes `flex: 0 0 auto`: as tall as its text up to the existing 46vh cap, never shrunk, with the body scrolling to the form when pane plus form outgrow the modal. The Playwright layout test is rewritten to guard that law.
2. **Strictness.** Required strings must be non-empty. Counts (`threads.total`, `threads.blocking`, `replies`) are non-negative integers; `round` is an integer of at least 1. A present optional field of the wrong type (including `null`) fails the parse.
3. **`adjudication` on post@1.** The spec lists `adjudication` as optional without scoping it to plan@1, and the approved respond-post frame shows it. It renders as a green chip for both shapes, before the round chip.
4. **Thread card placement.** The thread card is the existing question card: its head band carries `file:line`, the severity pill and "thread N of M"; its body carries claim, points, verdict and reply box; the option cards follow unchanged.
5. **Thread `author` is parsed but not rendered.** The spec's thread-card sketch has no slot for it; the header card names the reviewer.
6. **Avatar.** The board's person avatar is the Invadr identicon (as the review sheet's MR card uses), 32px, keyed by the reviewer handle.
7. **Colours not fixed by the spec.** Verdict call: `valid` green, `valid-low-value` amber, `pushback` red (per the amendment), `needs-clarification` accent (per the amendment), `no-ask` grey. Reply box: green wash for `verbatim`, neutral wash for `direction` (it is intent, not the posted text).
8. **Content renders through Markdown** (claim summary, points, reply texts), as the prose path does, so backticked symbols and links keep rendering.
9. **`.tui-gate-question-context` becomes `--text-1`** (it is the decision material itself).
10. **Fixture placement.** Both structured gates join `!1235` (the MR the fixture peer `pat` is reviewing), appended after its existing review-post gate, so that row's lead line and the existing queue captures keep their order.
11. **GateForm's bare-host fallback** (`showContextFallback`) never pours a structured gate-level context out as raw JSON.

## File map

| File                                                                    | Change | Responsibility                                                                          |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `apps/board/src/client/board/gate-ctx.ts`                               | Create | gate-ctx@1 types and `parseGateCtx`                                                     |
| `apps/board/src/client/board/__tests__/gate-ctx.test.ts`                | Create | parser unit tests                                                                       |
| `apps/board/src/client/board/RespondCards.tsx`                          | Create | `SeverityPill`, `ThreadCard`, `ReplyChoiceBody`                                         |
| `apps/board/src/client/board/RespondGateHeader.tsx`                     | Create | `RespondGateHeader`, `headerChips`                                                      |
| `apps/board/src/client/board/GateForm.tsx`                              | Modify | branch per question on `parseGateCtx(q.context)`; fallback guard                        |
| `apps/board/src/client/board/DecisionQueueModal.tsx`                    | Modify | header card in place of strip and pane; state chips move; stale comment                 |
| `apps/board/src/style.css`                                              | Modify | three declared fixes; new respond classes                                               |
| `apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx` | Create | thread card renderer tests                                                              |
| `apps/board/src/client/board/__tests__/respond-replies-dom.test.tsx`    | Create | replies card renderer tests                                                             |
| `apps/board/src/client/board/__tests__/respond-header-dom.test.tsx`     | Create | header card and chip tests                                                              |
| `apps/board/tests/decision-queue-context-layout.test.ts`                | Modify | new pane law; robust skip to the prose gate                                             |
| `apps/board/tests/fixture/data.json`                                    | Modify | two structured respond gates on `!1235`                                                 |
| `apps/board/tests/fixture/README.md`                                    | Modify | document them                                                                           |
| `apps/board/tests/capture.ts`                                           | Modify | `queueplan-*` and `queuepost-*` shots                                                   |
| `apps/board/tests/baselines/*.png`                                      | Modify | new shots plus whatever the new gates legitimately change                              |

---

### Task 0: Baseline

- [ ] **Step 1: Install and build the kit**

Run from the repo root:

```bash
bun install
bun run tui-kit:build
```

Expected: both succeed.

- [ ] **Step 2: Record the starting gates**

```bash
bun run board:typecheck && bun run board:test
```

Expected: PASS. If anything fails before any change, stop and report it; do not fix unrelated failures.

No commit.

---

### Task 1: The gate-ctx@1 parser

**Files:**

- Create: `apps/board/src/client/board/gate-ctx.ts`
- Test: `apps/board/src/client/board/__tests__/gate-ctx.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (later tasks import exactly these names):
  - `type Severity = 'blocking' | 'non-blocking' | 'question' | 'none'`
  - `type VerdictCall = 'valid' | 'valid-low-value' | 'pushback' | 'needs-clarification' | 'no-ask'`
  - `interface PlanCtx { shape: 'plan@1'; reviewer: string; round?: number; adjudication?: string; threads: { total: number; blocking: number } }`
  - `interface PostCtx { shape: 'post@1'; reviewer: string; round?: number; adjudication?: string; replies: number; fixes: { sha: string }[] }`
  - `type ThreadReply = { kind: 'verbatim' | 'direction'; text: string } | { kind: 'none' }`
  - `interface ThreadCtx { shape: 'thread@1'; author: string; severity: Severity; claim: { summary: string; points: string[] }; verdict: { call: VerdictCall; note?: string }; reply: ThreadReply }`
  - `interface ReplyEntry { thread: string; file: string; verb: 'reply' | 'fix'; sha?: string; text: string }`
  - `interface RepliesCtx { shape: 'replies@1'; replies: ReplyEntry[] }`
  - `type GateCtx = PlanCtx | PostCtx | ThreadCtx | RepliesCtx`
  - `function parseGateCtx(context: string | undefined): GateCtx | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/board/src/client/board/__tests__/gate-ctx.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { parseGateCtx } from '../gate-ctx.ts';

const PLAN = {
  'gate-ctx': 'plan@1',
  reviewer: 'renee',
  round: 1,
  threads: { total: 2, blocking: 1 },
  adjudication: 'both valid · fresh-context adjudicated',
};

const POST = {
  'gate-ctx': 'post@1',
  reviewer: 'renee',
  round: 1,
  replies: 2,
  fixes: [{ sha: 'ab12cd3' }],
};

const THREAD = {
  'gate-ctx': 'thread@1',
  author: 'renee',
  severity: 'blocking',
  claim: {
    summary:
      'the retry queue re-enqueues a job that already failed permanently.',
    points: [
      'permanent failures carry retryable: false, but enqueue() never reads it',
      'the other three callers all check it',
    ],
  },
  verdict: { call: 'valid', note: 'confirmed against the checkout' },
  reply: {
    kind: 'verbatim',
    text: 'fixed. enqueue() now drops non-retryable jobs; added a test.',
  },
};

const REPLIES = {
  'gate-ctx': 'replies@1',
  replies: [
    {
      thread: 't-1',
      file: 'queue/enqueue.ts:88',
      verb: 'fix',
      sha: 'ab12cd3',
      text: 'good call. enqueue() now drops non-retryable jobs.',
    },
    {
      thread: 't-2',
      file: 'queue/README.md:12',
      verb: 'reply',
      text: 'agreed on the wording; noted the contract in the doc.',
    },
  ],
};

const j = (v: unknown) => JSON.stringify(v);

describe('valid shapes', () => {
  test('plan@1', () => {
    expect(parseGateCtx(j(PLAN))).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      round: 1,
      adjudication: 'both valid · fresh-context adjudicated',
      threads: { total: 2, blocking: 1 },
    });
  });

  test('plan@1 minimal: blocking reads as 0, round and adjudication absent', () => {
    expect(
      parseGateCtx(
        j({ 'gate-ctx': 'plan@1', reviewer: 'renee', threads: { total: 3 } })
      )
    ).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      threads: { total: 3, blocking: 0 },
    });
  });

  test('post@1', () => {
    expect(parseGateCtx(j(POST))).toEqual({
      shape: 'post@1',
      reviewer: 'renee',
      round: 1,
      replies: 2,
      fixes: [{ sha: 'ab12cd3' }],
    });
  });

  test('post@1 minimal: fixes reads as empty', () => {
    expect(
      parseGateCtx(j({ 'gate-ctx': 'post@1', reviewer: 'renee', replies: 1 }))
    ).toEqual({ shape: 'post@1', reviewer: 'renee', replies: 1, fixes: [] });
  });

  test('post@1 may carry an adjudication', () => {
    expect(
      parseGateCtx(j({ ...POST, adjudication: 'both conceded' }))
    ).toMatchObject({ shape: 'post@1', adjudication: 'both conceded' });
  });

  test('thread@1', () => {
    expect(parseGateCtx(j(THREAD))).toEqual({
      shape: 'thread@1',
      author: 'renee',
      severity: 'blocking',
      claim: THREAD.claim,
      verdict: { call: 'valid', note: 'confirmed against the checkout' },
      reply: THREAD.reply,
    });
  });

  test('thread@1 minimal: points read as empty, no note, reply none without text', () => {
    expect(
      parseGateCtx(
        j({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'none',
          claim: { summary: 'a summary thread with no ask.' },
          verdict: { call: 'no-ask' },
          reply: { kind: 'none' },
        })
      )
    ).toEqual({
      shape: 'thread@1',
      author: 'renee',
      severity: 'none',
      claim: { summary: 'a summary thread with no ask.', points: [] },
      verdict: { call: 'no-ask' },
      reply: { kind: 'none' },
    });
  });

  test('thread@1 reply none may still carry a string text, which is dropped', () => {
    expect(
      parseGateCtx(j({ ...THREAD, reply: { kind: 'none', text: 'later' } }))
    ).toMatchObject({ reply: { kind: 'none' } });
  });

  test('thread@1 accepts every verdict call in the vocabulary', () => {
    for (const call of [
      'valid',
      'valid-low-value',
      'pushback',
      'needs-clarification',
      'no-ask',
    ])
      expect(
        parseGateCtx(j({ ...THREAD, verdict: { call } }))
      ).toMatchObject({ verdict: { call } });
  });

  test('replies@1', () => {
    expect(parseGateCtx(j(REPLIES))).toEqual({
      shape: 'replies@1',
      replies: REPLIES.replies,
    });
  });

  test('replies@1 with an empty list', () => {
    expect(parseGateCtx(j({ 'gate-ctx': 'replies@1', replies: [] }))).toEqual(
      { shape: 'replies@1', replies: [] }
    );
  });

  test('leading whitespace before the object is fine', () => {
    expect(parseGateCtx(`\n  ${j(PLAN)}`)?.shape).toBe('plan@1');
  });
});

describe('unknown extra keys are accepted and dropped', () => {
  test('top level and nested', () => {
    const parsed = parseGateCtx(
      j({
        ...THREAD,
        extra: 1,
        claim: { ...THREAD.claim, extra: true },
        verdict: { ...THREAD.verdict, extra: 'x' },
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('extra');
    expect((parsed as { claim: object }).claim).not.toHaveProperty('extra');
  });

  test('inside a reply entry and a fix', () => {
    const parsed = parseGateCtx(
      j({
        ...REPLIES,
        replies: [{ ...REPLIES.replies[0], extra: 1 }],
      })
    );
    expect(parsed).not.toBeNull();
    expect(
      (parsed as { replies: object[] }).replies[0]
    ).not.toHaveProperty('extra');
    expect(
      parseGateCtx(j({ ...POST, fixes: [{ sha: 'ab12cd3', note: 'x' }] }))
    ).toMatchObject({ fixes: [{ sha: 'ab12cd3' }] });
  });
});

describe('everything non-conforming returns null', () => {
  const cases: [string, string | undefined][] = [
    ['undefined', undefined],
    ['empty string', ''],
    ['prose', 'MR 87 has 2 unresolved threads. Recommendation below.'],
    ['a review-gate marker blob', '=== thread-1 a.ts:1 -- verdict valid ==='],
    ['malformed JSON', '{"gate-ctx": "plan@1", "reviewer":'],
    ['a JSON array', j([PLAN])],
    ['a JSON string', j('plan@1')],
    ['a JSON number', '42'],
    ['no tag', j({ reviewer: 'renee', threads: { total: 1 } })],
    ['unknown tag', j({ ...PLAN, 'gate-ctx': 'plan@2' })],
    ['non-string tag', j({ ...PLAN, 'gate-ctx': 1 })],
    ['prototype-named tag', j({ ...PLAN, 'gate-ctx': 'toString' })],
    // plan@1
    ['plan: missing reviewer', j({ ...PLAN, reviewer: undefined })],
    ['plan: empty reviewer', j({ ...PLAN, reviewer: '  ' })],
    ['plan: reviewer not a string', j({ ...PLAN, reviewer: 7 })],
    ['plan: missing threads', j({ ...PLAN, threads: undefined })],
    ['plan: threads not an object', j({ ...PLAN, threads: 2 })],
    ['plan: missing threads.total', j({ ...PLAN, threads: { blocking: 1 } })],
    ['plan: threads.total a string', j({ ...PLAN, threads: { total: '2' } })],
    ['plan: threads.total negative', j({ ...PLAN, threads: { total: -1 } })],
    ['plan: threads.total fractional', j({ ...PLAN, threads: { total: 1.5 } })],
    [
      'plan: threads.blocking wrong type',
      j({ ...PLAN, threads: { total: 2, blocking: 'one' } }),
    ],
    ['plan: round zero', j({ ...PLAN, round: 0 })],
    ['plan: round a string', j({ ...PLAN, round: '1' })],
    ['plan: round null', j({ ...PLAN, round: null })],
    ['plan: adjudication not a string', j({ ...PLAN, adjudication: 5 })],
    // post@1
    ['post: missing replies', j({ ...POST, replies: undefined })],
    ['post: replies a string', j({ ...POST, replies: '2' })],
    ['post: fixes not an array', j({ ...POST, fixes: { sha: 'ab12cd3' } })],
    ['post: fix sha not a string', j({ ...POST, fixes: [{ sha: 1 }] })],
    ['post: fix not an object', j({ ...POST, fixes: ['ab12cd3'] })],
    // thread@1
    ['thread: missing author', j({ ...THREAD, author: undefined })],
    ['thread: unknown severity', j({ ...THREAD, severity: 'urgent' })],
    ['thread: missing claim', j({ ...THREAD, claim: undefined })],
    [
      'thread: missing claim.summary',
      j({ ...THREAD, claim: { points: ['a'] } }),
    ],
    [
      'thread: claim.points not an array',
      j({ ...THREAD, claim: { summary: 's', points: 'a' } }),
    ],
    [
      'thread: claim.points with a non-string',
      j({ ...THREAD, claim: { summary: 's', points: [1] } }),
    ],
    ['thread: missing verdict', j({ ...THREAD, verdict: undefined })],
    ['thread: unknown verdict.call', j({ ...THREAD, verdict: { call: 'maybe' } })],
    [
      'thread: "invalid" is not in the verdict vocabulary',
      j({ ...THREAD, verdict: { call: 'invalid' } }),
    ],
    [
      'thread: verdict.note not a string',
      j({ ...THREAD, verdict: { call: 'valid', note: 5 } }),
    ],
    ['thread: missing reply', j({ ...THREAD, reply: undefined })],
    ['thread: unknown reply.kind', j({ ...THREAD, reply: { kind: 'draft' } })],
    [
      'thread: verbatim reply without text',
      j({ ...THREAD, reply: { kind: 'verbatim' } }),
    ],
    [
      'thread: direction reply with empty text',
      j({ ...THREAD, reply: { kind: 'direction', text: '' } }),
    ],
    [
      'thread: none reply with a non-string text',
      j({ ...THREAD, reply: { kind: 'none', text: 5 } }),
    ],
    // replies@1
    ['replies: missing list', j({ 'gate-ctx': 'replies@1' })],
    ['replies: list not an array', j({ 'gate-ctx': 'replies@1', replies: {} })],
    [
      'replies: entry missing file',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[1], file: undefined }] }),
    ],
    [
      'replies: entry missing text',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[1], text: undefined }] }),
    ],
    [
      'replies: entry unknown verb',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[1], verb: 'merge' }] }),
    ],
    [
      'replies: entry sha not a string',
      j({ ...REPLIES, replies: [{ ...REPLIES.replies[0], sha: 7 }] }),
    ],
    ['replies: entry not an object', j({ ...REPLIES, replies: ['t-1'] })],
  ];
  for (const [name, input] of cases)
    test(name, () => {
      expect(parseGateCtx(input)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/gate-ctx.test.ts`
Expected: FAIL, cannot resolve `../gate-ctx.ts`.

- [ ] **Step 3: Write the parser**

Create `apps/board/src/client/board/gate-ctx.ts`:

```ts
/** gate-ctx@1: structured context riding a gate's or a question's existing
    `context` string as a JSON object whose `"gate-ctx"` key names both the
    shape and its version. Anything that is not a conforming object of a
    known shape parses as null, and the caller renders the string as prose:
    there are no partial parses, and unknown keys are ignored so additive
    fields never need a version bump. */

export type Severity = 'blocking' | 'non-blocking' | 'question' | 'none';
export type VerdictCall =
  | 'valid'
  | 'valid-low-value'
  | 'pushback'
  | 'needs-clarification'
  | 'no-ask';

export interface PlanCtx {
  shape: 'plan@1';
  reviewer: string;
  round?: number;
  adjudication?: string;
  threads: { total: number; blocking: number };
}

export interface PostCtx {
  shape: 'post@1';
  reviewer: string;
  round?: number;
  adjudication?: string;
  replies: number;
  fixes: { sha: string }[];
}

export type ThreadReply =
  | { kind: 'verbatim' | 'direction'; text: string }
  | { kind: 'none' };

export interface ThreadCtx {
  shape: 'thread@1';
  author: string;
  severity: Severity;
  claim: { summary: string; points: string[] };
  verdict: { call: VerdictCall; note?: string };
  reply: ThreadReply;
}

export interface ReplyEntry {
  thread: string;
  file: string;
  verb: 'reply' | 'fix';
  sha?: string;
  text: string;
}

export interface RepliesCtx {
  shape: 'replies@1';
  replies: ReplyEntry[];
}

export type GateCtx = PlanCtx | PostCtx | ThreadCtx | RepliesCtx;

type Obj = Record<string, unknown>;

const SEVERITIES = ['blocking', 'non-blocking', 'question', 'none'] as const;
const VERDICT_CALLS = [
  'valid',
  'valid-low-value',
  'pushback',
  'needs-clarification',
  'no-ask',
] as const;
const REPLY_KINDS = ['verbatim', 'direction', 'none'] as const;
const VERBS = ['reply', 'fix'] as const;

class Reject extends Error {}

function reject(): never {
  throw new Reject();
}

function obj(v: unknown): Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Obj)
    : reject();
}

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() !== '' ? v : reject();
}

function optStr(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : reject();
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : reject();
}

function optRound(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : reject();
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : reject();
}

function optList<T>(v: unknown, item: (x: unknown) => T): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v.map(item) : reject();
}

function header(o: Obj): {
  reviewer: string;
  round?: number;
  adjudication?: string;
} {
  const round = optRound(o.round);
  const adjudication = optStr(o.adjudication);
  return {
    reviewer: str(o.reviewer),
    ...(round !== undefined ? { round } : {}),
    ...(adjudication !== undefined ? { adjudication } : {}),
  };
}

function readPlan(o: Obj): PlanCtx {
  const threads = obj(o.threads);
  return {
    shape: 'plan@1',
    ...header(o),
    threads: {
      total: count(threads.total),
      blocking: threads.blocking === undefined ? 0 : count(threads.blocking),
    },
  };
}

function readPost(o: Obj): PostCtx {
  return {
    shape: 'post@1',
    ...header(o),
    replies: count(o.replies),
    fixes: optList(o.fixes, f => ({ sha: str(obj(f).sha) })),
  };
}

function readReply(r: Obj): ThreadReply {
  const kind = oneOf(r.kind, REPLY_KINDS);
  if (kind !== 'none') return { kind, text: str(r.text) };
  optStr(r.text);
  return { kind };
}

function readThread(o: Obj): ThreadCtx {
  const claim = obj(o.claim);
  const verdict = obj(o.verdict);
  const note = optStr(verdict.note);
  return {
    shape: 'thread@1',
    author: str(o.author),
    severity: oneOf(o.severity, SEVERITIES),
    claim: { summary: str(claim.summary), points: optList(claim.points, str) },
    verdict: {
      call: oneOf(verdict.call, VERDICT_CALLS),
      ...(note !== undefined ? { note } : {}),
    },
    reply: readReply(obj(o.reply)),
  };
}

function readEntry(v: unknown): ReplyEntry {
  const e = obj(v);
  const sha = optStr(e.sha);
  return {
    thread: str(e.thread),
    file: str(e.file),
    verb: oneOf(e.verb, VERBS),
    ...(sha !== undefined ? { sha } : {}),
    text: str(e.text),
  };
}

function readReplies(o: Obj): RepliesCtx {
  const replies = o.replies;
  if (!Array.isArray(replies)) reject();
  return { shape: 'replies@1', replies: replies.map(readEntry) };
}

const READERS = new Map<string, (o: Obj) => GateCtx>([
  ['plan@1', readPlan],
  ['post@1', readPost],
  ['thread@1', readThread],
  ['replies@1', readReplies],
]);

export function parseGateCtx(context: string | undefined): GateCtx | null {
  if (!context || context.trimStart()[0] !== '{') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(context);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const tag = (raw as Obj)['gate-ctx'];
  const read = typeof tag === 'string' ? READERS.get(tag) : undefined;
  if (!read) return null;
  try {
    return read(raw as Obj);
  } catch (err) {
    if (err instanceof Reject) return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/gate-ctx.test.ts`
Expected: PASS, every case.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run board:typecheck
bunx prettier --write apps/board/src/client/board/gate-ctx.ts apps/board/src/client/board/__tests__/gate-ctx.test.ts
git add apps/board/src/client/board/gate-ctx.ts apps/board/src/client/board/__tests__/gate-ctx.test.ts
git commit -m "board: parseGateCtx, the gate-ctx@1 parser"
```

---

### Task 2: The three declared CSS fixes and the pane law

**Files:**

- Modify: `apps/board/src/style.css` (the `.tui-gate-choice-subtitle` rule near line 2160, the `.tui-gate-question-context` rule near line 2319, the `.tui-triage-body` block near lines 2570-2595)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx` (one stale comment)
- Test: `apps/board/tests/decision-queue-context-layout.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: no code interface. Later tasks rely on `.tui-gate-choice-subtitle` being `--text-2` and on the prose pane never shrinking.

- [ ] **Step 1: Rewrite the layout test to the new law (failing first)**

Replace the whole of `apps/board/tests/decision-queue-context-layout.test.ts` with:

```ts
/** Real-layout check for the decision queue's context pane, run in headless
    chromium against the fixture server: happy-dom does no layout, and the
    law this guards (the pane is as tall as its text up to its 46vh cap and
    never shrinks below that; the body, never the modal, scrolls when the
    pane plus the form outgrow the modal's cap) only exists once CSS flex
    sizing runs. Boots on a free port so a concurrent `capture` run on 7941
    is untouched. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '..');
const ROOMY = { width: 1000, height: 1100 };
/** A laptop-height window: the form alone nearly fills the modal's cap,
    which is where a shrinkable pane collapses to its header. */
const SHORT = { width: 1000, height: 812 };
/** The ScrollPane cap DecisionQueueModal passes, as a share of the
    viewport height. */
const PANE_CAP = 0.46;

/** The slice of the page's DOM the measurements touch; this tsconfig has no
    `dom` lib, so the evaluate callbacks reach it through a cast. */
type Measured = {
  clientHeight: number;
  scrollHeight: number;
  getBoundingClientRect(): { top: number; bottom: number; height: number };
};
type PageGlobals = {
  document: { querySelector(selector: string): Measured | null };
};

let server: ReturnType<typeof Bun.spawn>;
let browser: Browser;
let BASE = '';

function freePort(): number {
  const probe = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  probe.stop(true);
  if (!port) throw new Error('no free port');
  return port;
}

beforeAll(async () => {
  const port = freePort();
  BASE = `http://127.0.0.1:${port}`;
  server = Bun.spawn(['bun', 'run', join(ROOT, 'src/server.ts')], {
    env: {
      ...process.env,
      BOARD_FIXTURE: join(ROOT, 'tests/fixture'),
      BOARD_STATE_DB: join(
        mkdtempSync(join(tmpdir(), 'dq-layout-')),
        'state.db'
      ),
      PORT: String(port),
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    if (server.exitCode !== null)
      throw new Error(`fixture server exited with ${server.exitCode}`);
    try {
      up = (await fetch(`${BASE}/healthz`)).ok;
    } catch {}
    if (!up) await new Promise(r => setTimeout(r, 200));
  }
  if (!up) throw new Error('fixture server never answered /healthz');
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

/** Opens the queue and skips forward to the first gate whose context pane
    renders prose; the queue order is the fixture's row order, so this does
    not assume which position that gate holds. */
async function openDecisionQueue(viewport: {
  width: number;
  height: number;
}): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.abort()
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?member=all`);
  await page.waitForSelector('.tui-row');
  await page.click('.tui-dq-open');
  await page.waitForSelector('.tui-triage-body');
  const prose = page.locator(
    '.tui-triage-modal [data-part="scrollpane-body"] [data-part="markdown"] p'
  );
  for (let i = 0; i < 10 && !(await prose.count()); i++) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await prose.first().waitFor();
  return page;
}

type Layout = {
  modalScrolls: boolean;
  bodyScrolls: boolean;
  modalBottom: number;
  footerBottom: number;
  paneRootHeight: number;
  paneScrolls: boolean;
};

function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const modal = document.querySelector('.tui-triage-modal')!;
    const root = document.querySelector(
      '.tui-triage-modal [data-part="scrollpane"]'
    )!;
    const pane = document.querySelector(
      '.tui-triage-modal [data-part="scrollpane-body"]'
    )!;
    const footer = document.querySelector('.tui-triage-footer')!;
    const body = document.querySelector('.tui-triage-body')!;
    return {
      modalScrolls: modal.scrollHeight > modal.clientHeight,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      modalBottom: modal.getBoundingClientRect().bottom,
      footerBottom: footer.getBoundingClientRect().bottom,
      paneRootHeight: root.getBoundingClientRect().height,
      paneScrolls: pane.scrollHeight > pane.clientHeight,
    };
  });
}

function expectPaneLaw(m: Layout, viewportHeight: number): void {
  const cap = viewportHeight * PANE_CAP;
  expect(m.paneRootHeight).toBeLessThanOrEqual(cap + 1);
  // Never shrunk: either all of the text shows, or the pane stands at its cap.
  if (m.paneScrolls) expect(m.paneRootHeight).toBeGreaterThanOrEqual(cap - 1);
  expect(m.modalScrolls).toBe(false);
  expect(m.footerBottom).toBeLessThanOrEqual(m.modalBottom);
}

test('roomy: the pane is as tall as its text up to its cap, and the modal never scrolls', async () => {
  const page = await openDecisionQueue(ROOMY);
  expectPaneLaw(await measure(page), ROOMY.height);
  await page.context().close();
}, 30_000);

test('short: the pane keeps its height and the body scrolls to the form under the pinned footer', async () => {
  const page = await openDecisionQueue(SHORT);
  const m = await measure(page);
  expectPaneLaw(m, SHORT.height);
  expect(m.bodyScrolls).toBe(true);
  await page.context().close();
}, 30_000);
```

- [ ] **Step 2: Run it to verify it fails on the floor**

Run: `cd apps/board && bun test tests/decision-queue-context-layout.test.ts`
Expected: the `short` test FAILS on `paneRootHeight >= cap - 1` (the floored pane shrinks to about 13rem while its text still scrolls). If Playwright's chromium is missing, run `bunx playwright install chromium` first. If `roomy` also fails, note which assertion; it must pass after Step 4.

- [ ] **Step 3: Apply the three CSS fixes**

In `apps/board/src/style.css`:

(a) Replace the comment and rule for `.tui-gate-choice-subtitle`:

```css
/* An option's own `description`, one line under its label -- matching the
   pane's AskUserQuestion layout (label line, one-liner beneath). It reads
   in --text-2, not the muted step: on a respond gate's fix option it is the
   planned change, the thing being chosen. Absent on options with no
   description, so the row above stays the whole label. */
.tui-gate-choice-subtitle {
  font-size: var(--gate-font-meta);
  line-height: 1.4;
  color: var(--text-2);
}
```

(b) Replace the comment and first rule for `.tui-gate-question-context` (keep the two `[data-part='markdown']` rules after it unchanged):

```css
/* A question's own `context` field, rendered with its card above its
   choices. It is the material the choice is made on, so it reads in ink. */
.tui-gate-question-context {
  font-size: var(--gate-font-meta);
  line-height: 1.45;
  color: var(--text-1);
  overflow-wrap: anywhere;
}
```

(c) Replace the two comments above `.tui-triage-body`, the `.tui-triage-body` rule, and the `.tui-triage-body > [data-part='scrollpane']` rule with:

```css
/* Context sits ABOVE the form, the way a real pane reads: transcript on
   top, prompt below. The pane is as tall as its text up to the ScrollPane's
   46vh cap and scrolls on its own past that. It never shrinks: the kit
   pane's own `min-height: 0` would let a flexed pane collapse to its header
   at laptop heights, so when the pane plus the form outgrow the modal's cap
   the body scrolls to the form under the pinned head and footer instead.
   `min-height: 0` lets the body shrink to the cap; `overflow-y: auto` is
   what turns the overflow into that scroll instead of a clipped form. */
.tui-triage-body {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--gate-gap);
  min-height: 0;
  overflow-y: auto;
}
.tui-triage-body > [data-part='scrollpane'] {
  flex: 0 0 auto;
}
```

Confirm nothing else references the variable: `grep -rn "gate-context-floor" apps/board/src apps/board/tests` must print nothing.

- [ ] **Step 4: Fix the stale comment in DecisionQueueModal.tsx**

In `apps/board/src/client/board/DecisionQueueModal.tsx`, replace this comment (just before `return ( <div className="tui-triage-body">`):

```tsx
        // The modal exists to give context room: unlike the row card's
        // collapsed disclosure, context renders open, above the form. One
        // frame size regardless, so the modal never resizes as the queue
        // advances across gates with and without context. A context the
        // form has already split onto its questions (B7) collapses to a
        // one-line strip instead; the disclosure brings the pane back.
```

with:

```tsx
        // The modal exists to give context room: unlike the row card's
        // collapsed disclosure, context renders open, above the form. A
        // context the form has already split onto its questions (B7)
        // collapses to a one-line strip instead; the disclosure brings the
        // pane back.
```

- [ ] **Step 5: Run the layout test and the DOM suites**

Run: `cd apps/board && bun test tests/decision-queue-context-layout.test.ts src/client/board/__tests__`
Expected: PASS. If `roomy` or `short` still fails, measure with a temporary `console.log(m)` to see which side of the law breaks, fix the CSS (not the law), and remove the log.

- [ ] **Step 6: Commit**

```bash
bunx prettier --write apps/board/src/style.css apps/board/src/client/board/DecisionQueueModal.tsx apps/board/tests/decision-queue-context-layout.test.ts
git add apps/board/src/style.css apps/board/src/client/board/DecisionQueueModal.tsx apps/board/tests/decision-queue-context-layout.test.ts
git commit -m "board: retire the context floor; question context and option subtitles read in ink"
```

---

### Task 3: The thread card

**Files:**

- Create: `apps/board/src/client/board/RespondCards.tsx`
- Modify: `apps/board/src/client/board/GateForm.tsx`
- Modify: `apps/board/src/style.css`
- Test: `apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx`

**Interfaces:**

- Consumes: `parseGateCtx`, `GateCtx`, `ThreadCtx`, `Severity`, `VerdictCall`, `ReplyEntry` from `./gate-ctx.ts` (Task 1).
- Produces:
  - `SeverityPill({ severity }: { severity: Severity })` renders `<span class="tui-respond-pill" data-hue data-severity>`.
  - `ThreadCard({ ctx }: { ctx: ThreadCtx })` renders `.tui-thread-card`.
  - `ReplyChoiceBody({ entry, children }: { entry: ReplyEntry; children?: ReactNode })` (used by Task 4).
  - In `GateForm`: a `questionCtx: Map<string, GateCtx | null>` keyed by question id, and a `threadIds: string[]` list; Task 4 extends the same `display.map` body.
  - CSS class `.tui-respond-pill` with `data-hue` of `grey` (default) / `amber` / `green` / `accent`; Task 5 extends these hue rules to `.tui-respond-chip`.

- [ ] **Step 1: Write the failing DOM tests**

Create `apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx`:

```tsx
/** A respond-plan question whose context parses as thread@1 renders as a
    thread card: file:line, severity and "thread N of M" in the head; the
    claim, its points, the verdict and the reply box in the body; the plan
    on the fix option's subtitle. A thread context that fails the parse
    renders as prose, exactly as before. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { GateForm, useGateForm } from '../GateForm.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = { iid: 87 } as unknown as BoardMRWithReview;

type Question = GateRow['questions'][number];

function thread(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'gate-ctx': 'thread@1',
    author: 'renee',
    severity: 'blocking',
    claim: {
      summary:
        'The retry queue re-enqueues a job that already failed permanently.',
      points: [
        'permanent failures carry retryable: false, but enqueue() never reads it',
        'the other three callers all check it',
      ],
    },
    verdict: { call: 'valid', note: 'confirmed against the checkout' },
    reply: {
      kind: 'verbatim',
      text: 'Fixed. enqueue() now drops non-retryable jobs; added a test.',
    },
    ...overrides,
  });
}

function threadQuestion(n: number, context: string): Question {
  return {
    id: `thread-${n}`,
    label: `queue/enqueue.ts:${80 + n}`,
    multi: false,
    context,
    options: [
      {
        value: `reply:t${n}`,
        label: 'reply',
        description: 'post the drafted reply, no code change',
      },
      {
        value: `fix:t${n}`,
        label: 'fix',
        description: 'drop non-retryable jobs in enqueue() and add a test',
      },
      {
        value: `skip:t${n}`,
        label: 'skip',
        description: 'leave the thread for later',
      },
    ],
  };
}

const CODE_CHANGES: Question = {
  id: 'code-changes',
  label: 'Approve the proposed code changes?',
  multi: false,
  options: ['approve', 'revise', 'skip'],
};

function gate(overrides: Partial<GateRow>): GateRow {
  return {
    gateId: 'g-87',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-plan',
    label: 'respond gate !87',
    status: 'open',
    openedAt: 1,
    questions: [],
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function renderGate(row: GateRow) {
  function Host() {
    const form = useGateForm(row, () => {});
    return <GateForm gate={row} mr={MR} form={form} onFocusPane={() => {}} />;
  }
  await React.act(async () => {
    root.render(<Host />);
  });
}

test('a thread@1 question renders claim, points, verdict and reply, never the raw JSON', async () => {
  await renderGate(gate({ questions: [threadQuestion(1, thread())] }));
  const card = container.querySelector('.tui-thread-card')!;
  expect(card.textContent).toContain(
    're-enqueues a job that already failed permanently'
  );
  expect(card.querySelectorAll('.tui-thread-points li').length).toBe(2);
  const call = card.querySelector('.tui-thread-verdict-call')!;
  expect(call.getAttribute('data-call')).toBe('valid');
  expect(call.textContent).toBe('valid');
  expect(card.querySelector('.tui-thread-verdict-note')!.textContent).toBe(
    '· confirmed against the checkout'
  );
  expect(card.querySelector('.tui-thread-reply-k')!.textContent).toBe(
    'will post as reply'
  );
  expect(card.querySelector('.tui-thread-reply-text')!.textContent).toContain(
    'enqueue() now drops non-retryable jobs'
  );
  expect(container.querySelector('.tui-gate-question-context')).toBeNull();
  expect(container.textContent).not.toContain('gate-ctx');
});

test('the head carries file:line, the severity pill, and thread N of M by position', async () => {
  await renderGate(
    gate({
      questions: [
        threadQuestion(1, thread()),
        threadQuestion(2, thread({ severity: 'question' })),
        CODE_CHANGES,
      ],
    })
  );
  const ords = [
    ...container.querySelectorAll('.tui-gate-question-ord'),
  ].map(n => n.textContent);
  expect(ords).toEqual(['thread 1 of 2', 'thread 2 of 2']);
  const heads = [
    ...container.querySelectorAll(
      '.tui-gate-question[data-gate-ctx="thread"] .tui-gate-question-head'
    ),
  ];
  expect(heads[0]!.textContent).toContain('queue/enqueue.ts:81');
  expect(
    heads[0]!.querySelector('[data-severity]')!.getAttribute('data-severity')
  ).toBe('blocking');
  for (const progress of container.querySelectorAll('.tui-gate-progress'))
    expect(progress.textContent ?? '').not.toContain('Question');
});

test('each severity renders its own pill', async () => {
  const severities = [
    ['blocking', 'blocking', 'amber'],
    ['non-blocking', 'non-blocking', 'grey'],
    ['question', 'question', 'accent'],
    ['none', 'no ask', 'grey'],
  ] as const;
  await renderGate(
    gate({
      questions: severities.map(([severity], i) =>
        threadQuestion(i + 1, thread({ severity }))
      ),
    })
  );
  const pills = [
    ...container.querySelectorAll('.tui-gate-question-head [data-severity]'),
  ];
  expect(
    pills.map(p => [
      p.getAttribute('data-severity'),
      p.textContent,
      p.getAttribute('data-hue'),
    ])
  ).toEqual(severities.map(s => [...s]));
});

test('each verdict call renders its own word and data-call', async () => {
  const calls = [
    ['valid', 'valid'],
    ['valid-low-value', 'valid, low value'],
    ['pushback', 'pushback'],
    ['needs-clarification', 'needs clarification'],
    ['no-ask', 'no ask'],
  ] as const;
  await renderGate(
    gate({
      questions: calls.map(([call], i) =>
        threadQuestion(
          i + 1,
          thread({ verdict: { call, note: 'which cache path did you hit?' } })
        )
      ),
    })
  );
  expect(
    [...container.querySelectorAll('.tui-thread-verdict-call')].map(n => [
      n.getAttribute('data-call'),
      n.textContent,
    ])
  ).toEqual(calls.map(c => [...c]));
});

test('reply kinds: verbatim and direction label their box, none renders no box', async () => {
  await renderGate(
    gate({
      questions: [
        threadQuestion(1, thread()),
        threadQuestion(
          2,
          thread({
            reply: {
              kind: 'direction',
              text: 'Explain the retry contract and link the doc.',
            },
          })
        ),
        threadQuestion(3, thread({ reply: { kind: 'none' } })),
      ],
    })
  );
  const cards = [...container.querySelectorAll('.tui-thread-card')];
  expect(
    cards[0]!.querySelector('.tui-thread-reply')!.getAttribute('data-kind')
  ).toBe('verbatim');
  expect(cards[0]!.querySelector('.tui-thread-reply-k')!.textContent).toBe(
    'will post as reply'
  );
  expect(
    cards[1]!.querySelector('.tui-thread-reply')!.getAttribute('data-kind')
  ).toBe('direction');
  expect(cards[1]!.querySelector('.tui-thread-reply-k')!.textContent).toBe(
    'reply direction'
  );
  expect(cards[1]!.textContent).toContain('Explain the retry contract');
  expect(cards[2]!.querySelector('.tui-thread-reply')).toBeNull();
});

test("the fix option's description renders as its choice subtitle", async () => {
  await renderGate(gate({ questions: [threadQuestion(1, thread())] }));
  const subtitles = [
    ...container.querySelectorAll('.tui-gate-choice-subtitle'),
  ].map(n => n.textContent);
  expect(subtitles).toContain(
    'drop non-retryable jobs in enqueue() and add a test'
  );
});

test('a thread context missing a required field renders as prose', async () => {
  const broken = JSON.stringify({ 'gate-ctx': 'thread@1', author: 'renee' });
  await renderGate(gate({ questions: [threadQuestion(1, broken)] }));
  expect(container.querySelector('.tui-thread-card')).toBeNull();
  expect(container.querySelector('.tui-gate-question[data-gate-ctx]')).toBeNull();
  expect(container.querySelector('.tui-gate-question-context')).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/respond-thread-card-dom.test.tsx`
Expected: FAIL (no `.tui-thread-card`; the raw JSON renders through the prose block).

- [ ] **Step 3: Create RespondCards.tsx**

Create `apps/board/src/client/board/RespondCards.tsx`:

```tsx
import type { ReactNode } from 'react';

import { Markdown } from '@mattstack/tui-kit';
import type {
  ReplyEntry,
  Severity,
  ThreadCtx,
  VerdictCall,
} from './gate-ctx.ts';

const SEVERITY: Record<
  Severity,
  { text: string; hue: 'amber' | 'grey' | 'accent' }
> = {
  blocking: { text: 'blocking', hue: 'amber' },
  'non-blocking': { text: 'non-blocking', hue: 'grey' },
  question: { text: 'question', hue: 'accent' },
  none: { text: 'no ask', hue: 'grey' },
};

const CALL_TEXT: Record<VerdictCall, string> = {
  valid: 'valid',
  'valid-low-value': 'valid, low value',
  pushback: 'pushback',
  'needs-clarification': 'needs clarification',
  'no-ask': 'no ask',
};

function SeverityPill({ severity }: { severity: Severity }) {
  const { text, hue } = SEVERITY[severity];
  return (
    <span className="tui-respond-pill" data-hue={hue} data-severity={severity}>
      {text}
    </span>
  );
}

/** A respond-plan thread question's body: the reviewer's claim, the
    adjudicated verdict, and the reply that goes out in the developer's
    name. The file:line and the severity ride the question head; the plan
    rides the fix option's subtitle. */
function ThreadCard({ ctx }: { ctx: ThreadCtx }) {
  const { claim, verdict, reply } = ctx;
  return (
    <div className="tui-thread-card">
      <div className="tui-thread-claim">
        <Markdown unstyled linkTargetBlank>
          {claim.summary}
        </Markdown>
      </div>
      {claim.points.length > 0 && (
        <ul className="tui-thread-points">
          {claim.points.map((point, i) => (
            <li key={i}>
              <Markdown unstyled linkTargetBlank>
                {point}
              </Markdown>
            </li>
          ))}
        </ul>
      )}
      <div className="tui-thread-verdict">
        <span className="tui-thread-verdict-k">verdict</span>
        <span className="tui-thread-verdict-call" data-call={verdict.call}>
          {CALL_TEXT[verdict.call]}
        </span>
        {verdict.note && (
          <span className="tui-thread-verdict-note">· {verdict.note}</span>
        )}
      </div>
      {reply.kind !== 'none' && (
        <div className="tui-thread-reply" data-kind={reply.kind}>
          <span className="tui-thread-reply-k">
            {reply.kind === 'verbatim' ? 'will post as reply' : 'reply direction'}
          </span>
          <div className="tui-thread-reply-text">
            <Markdown unstyled linkTargetBlank>
              {reply.text}
            </Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

/** A respond-post reply option's label: where the reply lands, whether it
    rides a pushed fix, and the full text that will be posted. `children`
    joins the label row (the recommended chip). */
function ReplyChoiceBody({
  entry,
  children,
}: {
  entry: ReplyEntry;
  children?: ReactNode;
}) {
  return (
    <>
      <span className="tui-gate-choice-label-row">
        <span className="tui-reply-choice-file">{entry.file}</span>
        <span
          className="tui-respond-pill"
          data-hue={entry.verb === 'fix' ? 'green' : 'grey'}
          data-verb={entry.verb}
        >
          {entry.verb === 'fix' && entry.sha ? `fix · ${entry.sha}` : entry.verb}
        </span>
        {children}
      </span>
      <span className="tui-reply-choice-text">
        <Markdown unstyled linkTargetBlank>
          {entry.text}
        </Markdown>
      </span>
    </>
  );
}

export { ReplyChoiceBody, SeverityPill, ThreadCard };
```

- [ ] **Step 4: Branch GateForm on the question's parse**

In `apps/board/src/client/board/GateForm.tsx`:

(a) Add imports next to the existing `./gate-context.ts` import:

```tsx
import { parseGateCtx, type GateCtx } from './gate-ctx.ts';
import { SeverityPill, ThreadCard } from './RespondCards.tsx';
```

(b) After the existing `sectioned` useMemo inside `GateForm`, add:

```tsx
  const questionCtx = useMemo(
    () =>
      new Map<string, GateCtx | null>(
        gate.questions.map(q => [q.id, parseGateCtx(q.context)])
      ),
    [gate.questions]
  );
  // A thread's "N of M" counts the gate's thread-* questions, which the
  // gate contract keeps positional.
  const threadIds = useMemo(
    () => gate.questions.filter(q => /^thread-/.test(q.id)).map(q => q.id),
    [gate.questions]
  );
```

(c) At the top of the `display.map(q => { ... })` body, replace:

```tsx
        const section = sectionFor(context, { id: q.name, label: q.prompt });
        const threadAt = section ? threadKeys.indexOf(section.key) : -1;
```

with:

```tsx
        const qctx = questionCtx.get(q.name) ?? null;
        const threadCtx = qctx?.shape === 'thread@1' ? qctx : null;
        const threadOrd = threadCtx ? threadIds.indexOf(q.name) : -1;
        const section = threadCtx
          ? undefined
          : sectionFor(context, { id: q.name, label: q.prompt });
        const threadAt = section ? threadKeys.indexOf(section.key) : -1;
```

(d) On `<Questionnaire.Item ...>`, add one attribute after `data-sectioned`:

```tsx
            data-gate-ctx={threadCtx ? 'thread' : undefined}
```

(e) In the question head, add the pill and the ordinal right after `</Questionnaire.Title>`:

```tsx
              {threadCtx && <SeverityPill severity={threadCtx.severity} />}
              {threadOrd >= 0 && (
                <span className="tui-gate-question-ord">
                  thread {threadOrd + 1} of {threadIds.length}
                </span>
              )}
```

and change the progress text condition from:

```tsx
                      {!section &&
                        `Question ${state.current} of ${state.total}`}
```

to:

```tsx
                      {!section &&
                        !threadCtx &&
                        `Question ${state.current} of ${state.total}`}
```

(f) Replace the question-context block:

```tsx
            {q.context && (
              <div className="tui-gate-question-context">
                <Markdown unstyled linkTargetBlank>
                  {q.context}
                </Markdown>
              </div>
            )}
```

with:

```tsx
            {threadCtx ? (
              <ThreadCard ctx={threadCtx} />
            ) : (
              q.context && (
                <div className="tui-gate-question-context">
                  <Markdown unstyled linkTargetBlank>
                    {q.context}
                  </Markdown>
                </div>
              )
            )}
```

- [ ] **Step 5: Add the thread card CSS**

In `apps/board/src/style.css`, directly after the rule `.tui-gate-question-context [data-part='markdown'] > * + * { margin-top: 6px; }`, add:

```css
/* Respond gates' small uppercase tags: a thread's severity, a reply's verb.
   Grey unless a hue names what needs the eye. */
.tui-respond-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 6px;
  font: 700 9px / 1.2 var(--font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-2);
  background: color-mix(in srgb, var(--fg) 7%, transparent);
}
.tui-respond-pill[data-hue='amber'] {
  color: var(--text-warn-small);
  background: color-mix(in srgb, var(--fill-warn) 17%, transparent);
}
.tui-respond-pill[data-hue='green'] {
  color: var(--text-ok-small);
  background: color-mix(in srgb, var(--fill-ok) 17%, transparent);
}
.tui-respond-pill[data-hue='accent'] {
  color: var(--text-accent-small);
  background: color-mix(in srgb, var(--fill-accent) 17%, transparent);
}
/* A structured thread's head: file:line and its severity lead, the
   ordinal and the step dots hold the right edge. */
.tui-gate-question[data-gate-ctx='thread'] .tui-gate-question-head {
  justify-content: flex-start;
  align-items: center;
}
.tui-gate-question[data-gate-ctx='thread'] .tui-gate-question-ord {
  margin-left: auto;
  font: 400 var(--gate-font-meta) / 1.4 var(--font-sans);
  letter-spacing: normal;
  text-transform: none;
  color: var(--text-2);
}
.tui-thread-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-1);
  overflow-wrap: anywhere;
}
.tui-thread-card [data-part='markdown'] > * {
  margin: 0;
}
.tui-thread-card [data-part='markdown'] > * + * {
  margin-top: 6px;
}
.tui-thread-points {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tui-thread-points li::marker {
  color: var(--text-2);
}
.tui-thread-verdict {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}
.tui-thread-verdict-k {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.tui-thread-verdict-call {
  font-weight: 700;
  color: var(--text-2);
}
.tui-thread-verdict-call[data-call='valid'] {
  color: var(--text-ok-small);
}
.tui-thread-verdict-call[data-call='valid-low-value'] {
  color: var(--text-warn-small);
}
/* pushback: the claim is wrong and the reply says so. needs-clarification:
   a hold, with the question for the reviewer in the note. */
.tui-thread-verdict-call[data-call='pushback'] {
  color: var(--text-bad-small);
}
.tui-thread-verdict-call[data-call='needs-clarification'] {
  color: var(--text-accent-small);
}
.tui-thread-verdict-note {
  color: var(--text-2);
}
/* The reply box: green when it holds the exact text that will be posted,
   neutral when it only holds the intent of a reply. */
.tui-thread-reply {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--fill-ok) 12%, transparent);
}
.tui-thread-reply[data-kind='direction'] {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.tui-thread-reply-k {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-ok-small);
}
.tui-thread-reply[data-kind='direction'] .tui-thread-reply-k {
  color: var(--text-2);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/respond-thread-card-dom.test.tsx src/client/board/__tests__`
Expected: PASS, including the existing gate-form and decision-queue DOM suites (prose fixtures unchanged).

- [ ] **Step 7: Typecheck, lint and commit**

```bash
bun run board:typecheck && bun run lint
bunx prettier --write apps/board/src/client/board/RespondCards.tsx apps/board/src/client/board/GateForm.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx
git add apps/board/src/client/board/RespondCards.tsx apps/board/src/client/board/GateForm.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/respond-thread-card-dom.test.tsx
git commit -m "board: respond-plan questions with thread@1 context render as thread cards"
```

---

### Task 4: The replies card

**Files:**

- Modify: `apps/board/src/client/board/GateForm.tsx`
- Modify: `apps/board/src/style.css`
- Test: `apps/board/src/client/board/__tests__/respond-replies-dom.test.tsx`

**Interfaces:**

- Consumes: `questionCtx`, `threadCtx` locals inside `GateForm`'s `display.map` (Task 3); `ReplyChoiceBody` from `./RespondCards.tsx` (Task 3); `RepliesCtx` / `ReplyEntry` from `./gate-ctx.ts` (Task 1).
- Produces: `data-gate-ctx="replies"` on the replies question item; `.tui-reply-choice-file`, `.tui-reply-choice-text` classes.

- [ ] **Step 1: Write the failing DOM tests**

Create `apps/board/src/client/board/__tests__/respond-replies-dom.test.tsx`:

```tsx
/** A respond-post question whose context parses as replies@1 joins each
    entry to its checkbox option by thread id: a joined option shows the
    file, a verb tag and the full reply text; an entry with no option is
    not rendered; an option with no entry renders exactly as before. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { GateForm, useGateForm } from '../GateForm.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = { iid: 87 } as unknown as BoardMRWithReview;

const FIX_TEXT =
  'Good call. enqueue() now drops non-retryable jobs; added the check and a test that enqueues a permanent failure twice and asserts the second call is a no-op.';

const REPLIES = JSON.stringify({
  'gate-ctx': 'replies@1',
  replies: [
    {
      thread: 'th-aaa',
      file: 'queue/enqueue.ts:88',
      verb: 'fix',
      sha: 'ab12cd3',
      text: FIX_TEXT,
    },
    {
      thread: 'th-bbb',
      file: 'queue/README.md:12',
      verb: 'reply',
      text: 'Agreed on the wording; noted the contract in the doc.',
    },
    {
      thread: 'th-zzz',
      file: 'queue/orphan.ts:1',
      verb: 'reply',
      text: 'an entry no option answers',
    },
  ],
});

function postGate(context: string | undefined): GateRow {
  return {
    gateId: 'g-post-87',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-post',
    label: 'respond-post !87',
    status: 'open',
    openedAt: 1,
    questions: [
      {
        id: 'replies',
        label: 'Post which replies?',
        multi: true,
        ...(context !== undefined ? { context } : {}),
        options: [
          {
            value: 'th-aaa',
            label: 'queue/enqueue.ts:88',
            description: 'Good call. enqueue() now drops…',
          },
          {
            value: 'th-bbb',
            label: 'queue/README.md:12',
            description: 'Agreed on the wording…',
          },
          {
            value: 'th-ccc',
            label: 'queue/retry.ts:40',
            description: 'a plain option with no entry',
          },
        ],
      },
      {
        id: 'disposition',
        label: 'After posting?',
        multi: false,
        options: [
          {
            value: 'resolve-addressed',
            label: 'resolve-addressed',
            description: 'resolve each thread just replied to',
          },
          {
            value: 'leave-open',
            label: 'leave-open',
            description: 'post the replies without resolving the threads',
          },
        ],
      },
    ],
  };
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function renderGate(row: GateRow) {
  function Host() {
    const form = useGateForm(row, () => {});
    return <GateForm gate={row} mr={MR} form={form} onFocusPane={() => {}} />;
  }
  await React.act(async () => {
    root.render(<Host />);
  });
}

function repliesItem(): Element {
  return container.querySelector('[data-gate-ctx="replies"]')!;
}

test('joined options show the file, the verb tag and the full reply text', async () => {
  await renderGate(postGate(REPLIES));
  const item = repliesItem();
  expect(
    [...item.querySelectorAll('.tui-reply-choice-file')].map(n => n.textContent)
  ).toEqual(['queue/enqueue.ts:88', 'queue/README.md:12']);
  const fix = item.querySelector('[data-verb="fix"]')!;
  expect(fix.textContent).toBe('fix · ab12cd3');
  expect(fix.getAttribute('data-hue')).toBe('green');
  const reply = item.querySelector('[data-verb="reply"]')!;
  expect(reply.textContent).toBe('reply');
  expect(reply.getAttribute('data-hue')).toBe('grey');
  expect(item.textContent).toContain(FIX_TEXT);
});

test('an entry whose thread matches no option is not rendered', async () => {
  await renderGate(postGate(REPLIES));
  expect(container.textContent).not.toContain('an entry no option answers');
  expect(container.textContent).not.toContain('queue/orphan.ts:1');
});

test('an option with no entry renders as today, label and description unchanged', async () => {
  await renderGate(postGate(REPLIES));
  const item = repliesItem();
  expect(item.textContent).toContain('queue/retry.ts:40');
  const subtitles = [...item.querySelectorAll('.tui-gate-choice-subtitle')];
  expect(subtitles.map(n => n.textContent)).toEqual([
    'a plain option with no entry',
  ]);
});

test('every option stays a checkbox, and the context never renders as prose', async () => {
  await renderGate(postGate(REPLIES));
  const item = repliesItem();
  expect(item.querySelectorAll('.tui-gate-choice-input').length).toBe(3);
  expect(item.querySelector('.tui-gate-question-context')).toBeNull();
  expect(container.textContent).not.toContain('gate-ctx');
});

test('the disposition question renders as normal option cards', async () => {
  await renderGate(postGate(REPLIES));
  expect(container.textContent).toContain('resolve each thread just replied to');
  expect(container.textContent).toContain(
    'post the replies without resolving the threads'
  );
});

test('with no structured context the replies question renders exactly as before', async () => {
  await renderGate(postGate(undefined));
  expect(container.querySelector('[data-gate-ctx]')).toBeNull();
  expect(container.querySelector('.tui-reply-choice-file')).toBeNull();
  expect(container.textContent).toContain('Good call. enqueue() now drops…');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/respond-replies-dom.test.tsx`
Expected: FAIL (no `[data-gate-ctx="replies"]`; the JSON renders as prose).

- [ ] **Step 3: Join entries to options in GateForm**

In `apps/board/src/client/board/GateForm.tsx`:

(a) Extend the Task 3 import to `import { ReplyChoiceBody, SeverityPill, ThreadCard } from './RespondCards.tsx';`.

(b) In the `display.map` body, after the `threadCtx` line, add:

```tsx
        const repliesCtx = qctx?.shape === 'replies@1' ? qctx : null;
```

and change the `section` line to skip the prose section for either shape:

```tsx
        const section =
          threadCtx || repliesCtx
            ? undefined
            : sectionFor(context, { id: q.name, label: q.prompt });
```

(c) Change the item attribute to:

```tsx
            data-gate-ctx={
              threadCtx ? 'thread' : repliesCtx ? 'replies' : undefined
            }
```

(d) Change the prose fallback so a replies question renders no context block:

```tsx
            {threadCtx ? (
              <ThreadCard ctx={threadCtx} />
            ) : (
              q.context &&
              !repliesCtx && (
                <div className="tui-gate-question-context">
                  <Markdown unstyled linkTargetBlank>
                    {q.context}
                  </Markdown>
                </div>
              )
            )}
```

(e) Inside `q.choices.map(choice => { ... })`, after the `recommended` const, add:

```tsx
                const entry = repliesCtx?.replies.find(
                  r => r.thread === choice.value
                );
                const recommendedChip = recommended && (
                  <Chip
                    intent="ok"
                    variant="outline"
                    uppercase
                    data-gate="recommended"
                    className="tui-gate-recommended"
                  >
                    recommended
                  </Chip>
                );
```

and replace the whole `<Questionnaire.ChoiceLabel ...> ... </Questionnaire.ChoiceLabel>` element with:

```tsx
                    <Questionnaire.ChoiceLabel className="tui-gate-choice-label">
                      {entry ? (
                        <ReplyChoiceBody entry={entry}>
                          {recommendedChip}
                        </ReplyChoiceBody>
                      ) : (
                        <>
                          <span className="tui-gate-choice-label-row">
                            <span title={choice.description}>
                              {choice.label}
                            </span>
                            {recommendedChip}
                          </span>
                          {choice.subtitle && (
                            <span className="tui-gate-choice-subtitle">
                              {choice.subtitle}
                            </span>
                          )}
                        </>
                      )}
                    </Questionnaire.ChoiceLabel>
```

- [ ] **Step 4: Add the replies CSS**

In `apps/board/src/style.css`, directly after the `.tui-thread-reply[data-kind='direction'] .tui-thread-reply-k` rule from Task 3, add:

```css
/* A respond-post reply option carries the full reply text, so the box
   tops its checkbox against the first line instead of centring it. */
.tui-gate-question[data-gate-ctx='replies'] .tui-gate-choice {
  align-items: flex-start;
}
.tui-reply-choice-file {
  font-weight: 500;
  color: var(--text-1);
  overflow-wrap: anywhere;
}
.tui-reply-choice-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-1);
}
.tui-reply-choice-text [data-part='markdown'] > * {
  margin: 0;
}
.tui-reply-choice-text [data-part='markdown'] > * + * {
  margin-top: 6px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__`
Expected: PASS (replies, thread card, and every existing DOM suite).

- [ ] **Step 6: Typecheck, lint and commit**

```bash
bun run board:typecheck && bun run lint
bunx prettier --write apps/board/src/client/board/GateForm.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/respond-replies-dom.test.tsx
git add apps/board/src/client/board/GateForm.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/respond-replies-dom.test.tsx
git commit -m "board: respond-post replies question renders each reply in full on its option"
```

---

### Task 5: The header card

**Files:**

- Create: `apps/board/src/client/board/RespondGateHeader.tsx`
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx`
- Modify: `apps/board/src/client/board/GateForm.tsx` (fallback guard)
- Modify: `apps/board/src/style.css`
- Test: `apps/board/src/client/board/__tests__/respond-header-dom.test.tsx`

**Interfaces:**

- Consumes: `parseGateCtx`, `PlanCtx`, `PostCtx` from `./gate-ctx.ts` (Task 1); `.tui-respond-pill` hue rules (Task 3).
- Produces:
  - `interface HeaderChip { key: string; text: string; hue: 'grey' | 'amber' | 'green' }`
  - `function headerChips(ctx: PlanCtx | PostCtx): HeaderChip[]`
  - `function RespondGateHeader(props: { gate: GateRow; mr?: BoardMRWithReview; ctx: PlanCtx | PostCtx })` rendering `.tui-respond-head[data-shape]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/board/src/client/board/__tests__/respond-header-dom.test.tsx`:

```tsx
/** A gate whose gate-level context parses as plan@1 or post@1 heads the
    decision-queue modal with the header card: the reviewer leads, the MR
    is the object line, the chips come from the context, the parked and
    escalated chips move onto the action strip, and neither the MR strip
    nor the "Decision context" pane renders. Prose and malformed contexts
    keep today's strip and pane. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';
import type { PlanCtx, PostCtx } from '../gate-ctx.ts';
import { GateForm, useGateForm } from '../GateForm.tsx';
import { headerChips } from '../RespondGateHeader.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MR = {
  iid: 87,
  title: 'DEMO-12: add retry to the fetch queue',
  sourceBranch: 'feature/demo-12-retry',
  author: { username: 'alex', name: 'Alex Doe' },
} as unknown as BoardMRWithReview;

const PLAN = JSON.stringify({
  'gate-ctx': 'plan@1',
  reviewer: 'renee',
  round: 1,
  threads: { total: 2, blocking: 1 },
  adjudication: 'both valid · fresh-context adjudicated',
});

const POST = JSON.stringify({
  'gate-ctx': 'post@1',
  reviewer: 'renee',
  round: 1,
  replies: 2,
  fixes: [{ sha: 'ab12cd3' }],
});

const THREAD = JSON.stringify({
  'gate-ctx': 'thread@1',
  author: 'renee',
  severity: 'blocking',
  claim: { summary: 'enqueue() retries a job that failed permanently.' },
  verdict: { call: 'valid' },
  reply: { kind: 'none' },
});

function gate(overrides: Partial<GateRow>): GateRow {
  return {
    gateId: 'g-87',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/87',
    kind: 'respond-plan',
    label: 'respond gate !87',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: PLAN,
    origin: { paneId: 'pane-87', worktree: '/work/demo-worktree' },
    questions: [
      {
        id: 'thread-1',
        label: 'queue/enqueue.ts:88',
        multi: false,
        context: THREAD,
        options: [
          { value: 'reply:t1', label: 'reply' },
          { value: 'fix:t1', label: 'fix' },
          { value: 'skip:t1', label: 'skip' },
        ],
      },
    ],
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function renderModal(row: GateRow, mr?: BoardMRWithReview) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
        mr={mr}
        position={1}
        states={['active']}
        onClose={() => {}}
        onSkip={() => {}}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {}}
      />
    );
  });
}

const $ = (selector: string) => document.body.querySelector(selector);

test('a plan@1 gate renders the header card in place of the MR strip and the context pane', async () => {
  await renderModal(gate({}), MR);
  const head = $('.tui-respond-head[data-shape="plan@1"]')!;
  expect(head).not.toBeNull();
  expect(head.querySelector('.tui-respond-headline')!.textContent).toBe(
    "Responding to renee's review"
  );
  expect(head.querySelector('.tui-respond-headline strong')!.textContent).toBe(
    'renee'
  );
  expect(head.querySelector('.tui-respond-object-ref')!.textContent).toBe(
    '!87'
  );
  expect(head.querySelector('.tui-respond-object')!.textContent).toContain(
    'add retry to the fetch queue'
  );
  const meta = head.querySelector('.tui-respond-meta')!.textContent!;
  expect(meta).toContain('feature/demo-12-retry');
  expect(meta).toContain('Alex Doe');
  expect($('.tui-triage-strip')).toBeNull();
  expect($('.tui-triage-modal [data-part="scrollpane"]')).toBeNull();
  expect($('.tui-triage-overview')).toBeNull();
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('gate-ctx');
  expect(text).not.toContain('pane-87');
  expect(text).not.toContain('demo-worktree');
});

test('the chips row renders the derived chips in order', async () => {
  await renderModal(gate({}), MR);
  expect(
    [...document.body.querySelectorAll('.tui-respond-chip')].map(c => [
      c.textContent,
      c.getAttribute('data-hue'),
    ])
  ).toEqual([
    ['2 threads', 'grey'],
    ['1 blocking', 'amber'],
    ['both valid · fresh-context adjudicated', 'green'],
    ['round 1', 'grey'],
  ]);
});

test('a post@1 gate heads with "Posting replies to"', async () => {
  await renderModal(gate({ kind: 'respond-post', context: POST }), MR);
  expect($('.tui-respond-head[data-shape="post@1"]')).not.toBeNull();
  expect($('.tui-respond-headline')!.textContent).toBe(
    "Posting replies to renee's review"
  );
});

test('parked and escalated chips move onto the action strip', async () => {
  await renderModal(gate({ status: 'parked', escalatedAt: 5 }), MR);
  expect($('.tui-triage-head-actions [data-gate="parked"]')).not.toBeNull();
  expect($('.tui-triage-head-actions [data-gate="escalated"]')).not.toBeNull();
});

test('with no MR row the object line falls back to the subject reference', async () => {
  await renderModal(gate({}));
  const object = $('.tui-respond-object')!;
  expect(object.querySelector('.tui-respond-object-ref')!.textContent).toBe(
    '!87'
  );
  expect(object.querySelector('.tui-respond-object-title')).toBeNull();
});

test('a prose respond gate keeps the MR strip and the context pane', async () => {
  await renderModal(gate({ context: 'Two threads from renee, both valid.' }), MR);
  expect($('.tui-respond-head')).toBeNull();
  expect($('.tui-triage-strip')).not.toBeNull();
  expect(
    $('.tui-triage-modal [data-part="scrollpane"]')!.textContent
  ).toContain('Two threads from renee, both valid.');
});

test('a malformed plan context keeps the MR strip and the context pane', async () => {
  await renderModal(gate({ context: JSON.stringify({ 'gate-ctx': 'plan@1' }) }), MR);
  expect($('.tui-respond-head')).toBeNull();
  expect($('.tui-triage-strip')).not.toBeNull();
  expect($('.tui-triage-modal [data-part="scrollpane"]')).not.toBeNull();
});

test('a respond gate whose contexts were dropped still renders its questions and options', async () => {
  await renderModal(
    gate({
      context: undefined,
      questions: [
        {
          id: 'thread-1',
          label: 'queue/enqueue.ts:88',
          multi: false,
          options: [
            { value: 'reply:t1', label: 'reply' },
            { value: 'fix:t1', label: 'fix' },
          ],
        },
      ],
    }),
    MR
  );
  expect($('.tui-respond-head')).toBeNull();
  expect($('.tui-triage-strip')).not.toBeNull();
  const text = document.body.textContent ?? '';
  expect(text).toContain('queue/enqueue.ts:88');
  expect(text).toContain('reply');
});

test('a bare GateForm host never pours a structured gate context out raw', async () => {
  const row = gate({});
  function Host() {
    const form = useGateForm(row, () => {});
    return <GateForm gate={row} mr={MR} form={form} onFocusPane={() => {}} />;
  }
  await React.act(async () => {
    root.render(<Host />);
  });
  expect(container.querySelector('.tui-gate-context-raw')).toBeNull();
  expect(container.textContent).not.toContain('gate-ctx');
});

const plan = (over: Partial<PlanCtx> = {}): PlanCtx => ({
  shape: 'plan@1',
  reviewer: 'renee',
  threads: { total: 2, blocking: 1 },
  ...over,
});

const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  shape: 'post@1',
  reviewer: 'renee',
  replies: 2,
  fixes: [],
  ...over,
});

const chips = (ctx: PlanCtx | PostCtx) =>
  headerChips(ctx).map(c => [c.text, c.hue]);

test('plan chips: threads, blocking, adjudication, round', () => {
  expect(
    chips(plan({ adjudication: 'both valid', round: 2 }))
  ).toEqual([
    ['2 threads', 'grey'],
    ['1 blocking', 'amber'],
    ['both valid', 'green'],
    ['round 2', 'grey'],
  ]);
});

test('plan chips: zero blocking reads grey "all non-blocking"; one thread is singular', () => {
  expect(chips(plan({ threads: { total: 1, blocking: 0 } }))).toEqual([
    ['1 thread', 'grey'],
    ['all non-blocking', 'grey'],
  ]);
});

test('post chips: replies, one chip per fix, then round', () => {
  expect(
    chips(post({ fixes: [{ sha: 'ab12cd3' }, { sha: 'ef45ab6' }], round: 1 }))
  ).toEqual([
    ['2 replies', 'grey'],
    ['fix pushed · ab12cd3', 'green'],
    ['fix pushed · ef45ab6', 'green'],
    ['round 1', 'grey'],
  ]);
});

test('post chips: three or more fixes collapse; one reply is singular', () => {
  expect(
    chips(
      post({
        replies: 1,
        fixes: [{ sha: 'a1' }, { sha: 'b2' }, { sha: 'c3' }],
      })
    )
  ).toEqual([
    ['1 reply', 'grey'],
    ['3 fixes pushed', 'green'],
  ]);
});

test('post chips: an adjudication renders before the round', () => {
  expect(chips(post({ adjudication: 'both conceded', round: 1 }))).toEqual([
    ['2 replies', 'grey'],
    ['both conceded', 'green'],
    ['round 1', 'grey'],
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/respond-header-dom.test.tsx`
Expected: FAIL, cannot resolve `../RespondGateHeader.tsx`.

- [ ] **Step 3: Create RespondGateHeader.tsx**

Create `apps/board/src/client/board/RespondGateHeader.tsx`:

```tsx
import { Invadr } from 'invadrs/react';

import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { ago, cleanTitle } from './format.ts';
import type { PlanCtx, PostCtx } from './gate-ctx.ts';

export interface HeaderChip {
  key: string;
  text: string;
  hue: 'grey' | 'amber' | 'green';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function headerChips(ctx: PlanCtx | PostCtx): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (ctx.shape === 'plan@1') {
    const { total, blocking } = ctx.threads;
    chips.push({
      key: 'threads',
      text: plural(total, 'thread', 'threads'),
      hue: 'grey',
    });
    chips.push(
      blocking > 0
        ? { key: 'blocking', text: `${blocking} blocking`, hue: 'amber' }
        : { key: 'blocking', text: 'all non-blocking', hue: 'grey' }
    );
  } else {
    chips.push({
      key: 'replies',
      text: plural(ctx.replies, 'reply', 'replies'),
      hue: 'grey',
    });
    if (ctx.fixes.length >= 3)
      chips.push({
        key: 'fixes',
        text: `${ctx.fixes.length} fixes pushed`,
        hue: 'green',
      });
    else
      ctx.fixes.forEach((fix, i) =>
        chips.push({
          key: `fix-${i}`,
          text: `fix pushed · ${fix.sha}`,
          hue: 'green',
        })
      );
  }
  if (ctx.adjudication)
    chips.push({ key: 'adjudication', text: ctx.adjudication, hue: 'green' });
  if (ctx.round !== undefined)
    chips.push({ key: 'round', text: `round ${ctx.round}`, hue: 'grey' });
  return chips;
}

/** `!<n>` from an `mr:<url>` subject: the object line's stand-in when the
    board has no row for the MR, so the card never waits on the join. */
function subjectRef(subject: string): string {
  const m = subject.startsWith('mr:') ? /(\d+)\/?$/.exec(subject) : null;
  return m ? `!${m[1]}` : subject;
}

/** A respond gate's head in the decision queue, in place of the MR strip
    and the context pane: who is being answered leads, the MR is the
    object line, and the chips say what the gate decides. */
export function RespondGateHeader({
  gate,
  mr,
  ctx,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  ctx: PlanCtx | PostCtx;
}) {
  const author = mr?.author?.name || mr?.author?.username;
  const meta = [
    mr?.sourceBranch,
    author,
    ago(new Date(gate.openedAt).toISOString(), Date.now()),
  ].filter(Boolean);
  return (
    <div className="tui-respond-head" data-shape={ctx.shape}>
      <div className="tui-respond-head-top">
        <Invadr
          id={ctx.reviewer}
          palette="css-vars"
          className="tui-respond-avatar"
        />
        <div className="tui-respond-head-text">
          <p className="tui-respond-headline">
            {ctx.shape === 'plan@1' ? 'Responding to ' : 'Posting replies to '}
            <strong>{ctx.reviewer}</strong>
            {"'s review"}
          </p>
          <p className="tui-respond-object">
            <span className="tui-respond-object-ref">
              {mr ? `!${mr.iid}` : subjectRef(gate.subject)}
            </span>
            {mr && (
              <span className="tui-respond-object-title">
                · {cleanTitle(mr.title)}
              </span>
            )}
          </p>
          <p className="tui-respond-meta">{meta.join(' · ')}</p>
        </div>
      </div>
      <div className="tui-respond-chips">
        {headerChips(ctx).map(chip => (
          <span
            key={chip.key}
            className="tui-respond-chip"
            data-hue={chip.hue}
            data-chip={chip.key}
          >
            {chip.text}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into DecisionQueueModal**

In `apps/board/src/client/board/DecisionQueueModal.tsx`:

(a) Add imports:

```tsx
import { parseGateCtx, type PlanCtx, type PostCtx } from './gate-ctx.ts';
import { RespondGateHeader } from './RespondGateHeader.tsx';
```

(b) Add this component above `DecisionQueueModal` (after `OverviewStrip`):

```tsx
/** The gate's own state chips; they ride the MR strip, or the action strip
    when the header card has taken the strip's place. */
function GateStateChips({ gate }: { gate: GateRow }) {
  return (
    <>
      {gate.status === 'parked' && (
        <Chip intent="warn" variant="outline" uppercase data-gate="parked">
          parked
        </Chip>
      )}
      {gate.escalatedAt != null && (
        <Chip intent="warn" variant="outline" uppercase data-gate="escalated">
          escalated
        </Chip>
      )}
    </>
  );
}
```

(c) Inside `DecisionQueueModal`, directly after `const paneGone = ...;`, add:

```tsx
  const headerCtx = useMemo((): PlanCtx | PostCtx | null => {
    const ctx = parseGateCtx(gate.context);
    return ctx?.shape === 'plan@1' || ctx?.shape === 'post@1' ? ctx : null;
  }, [gate.context]);
  // A structured gate context is never prose: the header card is its only
  // reading, so neither the B7 strip, the B9 groups nor the pane sees it.
  const proseContext = headerCtx ? undefined : gate.context;
```

(d) In the `sectioned` and `grouped` useMemos, and in the two render conditions and the Markdown child of the pane, use `proseContext` wherever `gate.context` appears:

```tsx
  const sectioned = useMemo(() => {
    const parsed = parseGateContext(proseContext);
    return parsed &&
      gate.questions.some(q => sectionFor(parsed, { id: q.id, label: q.label }))
      ? parsed
      : null;
  }, [proseContext, gate.questions]);
```

```tsx
  const grouped = useMemo(
    () => (sectioned ? null : parseLabelledLines(proseContext)),
    [sectioned, proseContext]
  );
```

```tsx
            {proseContext && sectioned && (
```

```tsx
            {proseContext && (!sectioned || fullContext) && (
```

```tsx
                  <Markdown unstyled linkTargetBlank>
                    {proseContext}
                  </Markdown>
```

(e) After the `skip gate` `<Button>` inside `.tui-triage-head-actions`, add:

```tsx
          {headerCtx && <GateStateChips gate={gate} />}
```

(f) Replace the whole `<div className="tui-triage-strip"> ... </div>` element with:

```tsx
      {headerCtx ? (
        <RespondGateHeader gate={gate} mr={mr} ctx={headerCtx} />
      ) : (
        <div className="tui-triage-strip">
          ...the existing strip, unchanged, except that the two parked /
          escalated <Chip> elements inside .tui-triage-row-1 become
          <GateStateChips gate={gate} />
        </div>
      )}
```

(Concretely: keep every line of the existing strip; delete the `{gate.status === 'parked' && (<Chip ...>parked</Chip>)}` and `{gate.escalatedAt != null && (<Chip ...>escalated</Chip>)}` blocks from `.tui-triage-row-1` and put `<GateStateChips gate={gate} />` where they were.)

- [ ] **Step 5: Guard GateForm's bare-host fallback**

In `apps/board/src/client/board/GateForm.tsx`, after the `questionCtx` useMemo, add:

```tsx
  const gateCtx = useMemo(() => parseGateCtx(gate.context), [gate.context]);
```

and change the fallback condition from `{showContextFallback && gate.context && !sectioned && (` to:

```tsx
      {showContextFallback && gate.context && !sectioned && !gateCtx && (
```

- [ ] **Step 6: Add the header card CSS**

In `apps/board/src/style.css`:

(a) Directly before the `.tui-triage-strip {` rule, add:

```css
/* The respond gate's header card, in place of the MR strip when the
   gate-level context is structured: who is being answered leads, the MR is
   the object line, the operator plumbing (pane, worktree) is gone. */
.tui-respond-head {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--panel);
}
.tui-respond-head-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}
.tui-respond-avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
}
.tui-respond-head-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.tui-respond-headline {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
  color: var(--text-1);
}
.tui-respond-headline strong {
  font-weight: 700;
}
.tui-respond-object {
  margin: 0;
  display: flex;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 1.3;
  color: var(--text-1);
}
.tui-respond-object-ref {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--text-accent-small);
}
.tui-respond-object-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tui-respond-meta {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--text-3);
  overflow-wrap: anywhere;
}
.tui-respond-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tui-respond-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font: 500 11px / 1.2 var(--font-sans);
  color: var(--text-2);
  background: color-mix(in srgb, var(--fg) 7%, transparent);
}
```

(b) Extend the three hue rules Task 3 added so chips share them. Replace:

```css
.tui-respond-pill[data-hue='amber'] {
```

with:

```css
.tui-respond-pill[data-hue='amber'],
.tui-respond-chip[data-hue='amber'] {
```

and do the same for `green` (`.tui-respond-pill[data-hue='green'],` + `.tui-respond-chip[data-hue='green'] {`) and `accent`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__`
Expected: PASS, including `decision-queue-dom.test.tsx` and `attention-card-dom.test.tsx` (their gates carry no structured context, so the strip and its chips are unchanged).

- [ ] **Step 8: Typecheck, lint and commit**

```bash
bun run board:typecheck && bun run lint
bunx prettier --write apps/board/src/client/board/RespondGateHeader.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/GateForm.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/respond-header-dom.test.tsx
git add apps/board/src/client/board/RespondGateHeader.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/GateForm.tsx apps/board/src/style.css apps/board/src/client/board/__tests__/respond-header-dom.test.tsx
git commit -m "board: respond gates with plan@1/post@1 context head the queue with a header card"
```

---

### Task 6: Fixture gates, captures and baselines

**Files:**

- Modify: `apps/board/tests/fixture/data.json`
- Modify: `apps/board/tests/fixture/README.md`
- Modify: `apps/board/tests/capture.ts`
- Modify: `apps/board/tests/baselines/*.png`

**Interfaces:**

- Consumes: `.tui-respond-head[data-shape="plan@1"|"post@1"]` (Task 5).
- Produces: captures `queueplan-{light,dark}.png` and `queuepost-{light,dark}.png`.

- [ ] **Step 1: Learn whether this machine reproduces the baselines**

```bash
cd apps/board && bun run capture && bun run capture:compare
```

Record the result. If every baseline matches, a later full re-baseline only changes what this task changes. If some already differ (machine drift), note which ones: in Step 5 you will keep only the PNGs this task legitimately changes and restore the rest.

- [ ] **Step 2: Add the two structured gates to `!1235`**

Write this throwaway script to the session scratchpad (NOT into the repo) and run it with `bun run <path>`; it prints the two gate objects as JSON:

```ts
const now = 1755603600000;
const t1 = 'f1e2d3c4b5a697887766554433221100ffeeddcc';
const t2 = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
const subject = 'mr:https://gitlab.example.com/acme/webapp/-/merge_requests/1235';
const origin = { paneId: 'pane-1235', tabId: 'w18:t1', worktree: 'webapp' };
const fixText =
  'Good catch. The panel now reads the factored score as-is; added a test that renders a cached score twice.';
const s = JSON.stringify;

const plan = {
  gateId: 'gate-respond-plan-1235',
  subject,
  kind: 'respond-plan',
  label: 'respond gate !1235',
  status: 'open',
  openedAt: now - 60_000,
  domain: 'respond',
  origin,
  context: s({
    'gate-ctx': 'plan@1',
    reviewer: 'pat',
    round: 1,
    threads: { total: 2, blocking: 1 },
    adjudication: 'both valid · fresh-context adjudicated',
  }),
  questions: [
    {
      id: 'thread-1',
      label: 'highlights/panel.tsx:118',
      multi: false,
      context: s({
        'gate-ctx': 'thread@1',
        author: 'pat',
        severity: 'blocking',
        claim: {
          summary:
            'The temperature factor is applied twice when the panel re-renders with a cached score.',
          points: [
            '`scoreFor()` already multiplies by the factor, and the panel multiplies again',
            'a cached score of 0.8 renders as 0.64 after one refresh',
          ],
        },
        verdict: {
          call: 'valid',
          note: 'reproduced against the checkout with a cached score',
        },
        reply: { kind: 'verbatim', text: fixText },
      }),
      options: [
        {
          value: `reply:${t1}`,
          label: 'reply',
          description: 'post the drafted reply only, no code change',
        },
        {
          value: `fix:${t1}`,
          label: 'fix (recommended)',
          description:
            'drop the second multiply in panel.tsx and add a cached-score render test',
        },
        {
          value: `skip:${t1}`,
          label: 'skip',
          description: 'neither reply nor fix; the thread stays open',
        },
      ],
    },
    {
      id: 'thread-2',
      label: 'highlights/temperature.ts:42',
      multi: false,
      context: s({
        'gate-ctx': 'thread@1',
        author: 'pat',
        severity: 'non-blocking',
        claim: {
          summary:
            "Could the factor's default live in settings instead of a constant?",
        },
        verdict: {
          call: 'valid-low-value',
          note: 'reasonable, but no second caller needs it yet',
        },
        reply: {
          kind: 'direction',
          text: 'Agree it could; keep the constant until a second caller appears, and say so.',
        },
      }),
      options: [
        {
          value: `reply:${t2}`,
          label: 'reply (recommended)',
          description: 'answer with the direction above, no code change',
        },
        {
          value: `fix:${t2}`,
          label: 'fix',
          description: 'move the default into settings now',
        },
        {
          value: `skip:${t2}`,
          label: 'skip',
          description: 'neither reply nor fix; the thread stays open',
        },
      ],
    },
    {
      id: 'code-changes',
      label: 'Approve the proposed code changes?',
      multi: false,
      options: ['approve', 'revise', 'skip'],
    },
  ],
};

const post = {
  gateId: 'gate-respond-post-1235',
  subject,
  kind: 'respond-post',
  label: 'respond-post !1235',
  status: 'open',
  openedAt: now - 120_000,
  domain: 'respond',
  origin,
  context: s({
    'gate-ctx': 'post@1',
    reviewer: 'pat',
    round: 1,
    replies: 2,
    fixes: [{ sha: '4be91c2' }],
  }),
  questions: [
    {
      id: 'replies',
      label: 'Post which replies?',
      multi: true,
      context: s({
        'gate-ctx': 'replies@1',
        replies: [
          {
            thread: t1,
            file: 'highlights/panel.tsx:118',
            verb: 'fix',
            sha: '4be91c2',
            text: fixText,
          },
          {
            thread: t2,
            file: 'highlights/temperature.ts:42',
            verb: 'reply',
            text: 'Agreed it could live in settings. Keeping the constant until a second caller needs it; noted that beside the constant.',
          },
        ],
      }),
      options: [
        {
          value: t1,
          label: 'highlights/panel.tsx:118',
          description: 'Good catch. The panel now reads the factored score…',
        },
        {
          value: t2,
          label: 'highlights/temperature.ts:42',
          description: 'Agreed it could live in settings…',
        },
      ],
    },
    {
      id: 'disposition',
      label: 'After posting?',
      multi: false,
      options: [
        {
          value: 'resolve-addressed',
          label: 'resolve-addressed (recommended)',
          description: 'resolve each thread just replied to',
        },
        {
          value: 'leave-open',
          label: 'leave-open',
          description: 'post the replies without resolving the threads',
        },
      ],
    },
  ],
};

console.log(JSON.stringify(plan, null, 2) + ',\n' + JSON.stringify(post, null, 2));
```

Open `apps/board/tests/fixture/data.json`, find the `mrs` entry with `"iid": 1235` (its `gates` array holds `gate-review-post-1235`), and paste the printed text as two new elements AFTER that existing gate (add the comma after the existing gate's closing brace). Then:

```bash
bunx prettier --write apps/board/tests/fixture/data.json
git diff --stat apps/board/tests/fixture/data.json
```

Expected: insertions only in that file (no reflowed existing lines). Validate: `bun -e "JSON.parse(await Bun.file('apps/board/tests/fixture/data.json').text())"` prints nothing and exits 0.

- [ ] **Step 3: Document the gates in the fixture README**

In `apps/board/tests/fixture/README.md`, append to the `!1235` row's "carries" cell (keep the table formatted; prettier realigns it):

```
; plus two structured respond gates (gate-ctx): an open respond-plan answering `pat` (two threads, one blocking; the header, thread and reply cards) and an open respond-post (two replies, one riding a pushed fix; the replies card)
```

- [ ] **Step 4: Add the two shots to the capture harness**

In `apps/board/tests/capture.ts`:

(a) Make the two existing queue shots robust to gates ahead of theirs. For the `queue-*` shot, replace

```ts
  if (!(await page.locator('.tui-gate-question[data-sectioned]').count()))
    await page.getByRole('button', { name: 'skip gate' }).click();
```

with

```ts
  for (
    let i = 0;
    i < 10 &&
    !(await page.locator('.tui-gate-question[data-sectioned]').count());
    i++
  ) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
```

and in the `queuegroups` loop raise the bound from `i < 4` to `i < 10`.

(b) Directly after the `await page.keyboard.press('Escape');` that follows the `queuegroups` shot, add:

```ts
  // Structured respond gates: the header card in place of the MR strip,
  // then the thread card (respond-plan) and the replies card (respond-post).
  // Each shot reopens the queue, which starts a fresh session at the first
  // gate, and skips forward to its gate.
  for (const [shape, name] of [
    ['plan@1', 'queueplan'],
    ['post@1', 'queuepost'],
  ] as const) {
    await page.click('.tui-dq-open');
    await page.waitForSelector('.tui-triage-body');
    const head = page.locator(`.tui-respond-head[data-shape="${shape}"]`);
    for (let i = 0; i < 10 && !(await head.count()); i++) {
      await page.getByRole('button', { name: 'skip gate' }).click();
      await page.waitForTimeout(120);
    }
    await head.waitFor();
    await shoot(page, `${name}-${theme}`);
    await page.keyboard.press('Escape');
  }
```

- [ ] **Step 5: Re-baseline and look at every changed PNG**

```bash
cd apps/board && bun run capture:baseline
git status --short tests/baselines
```

Expected changes: four new files (`queueplan-light.png`, `queueplan-dark.png`, `queuepost-light.png`, `queuepost-dark.png`), plus shots where the `!1235` row's status line now counts two more active gates (at least `rows-*`, possibly `needsme-*`, `selection-*`, `mobile-*`, `phone-*`, `focus-*`). Open each changed PNG with the Read tool and confirm the only difference is the one this task caused. Restore any PNG whose change is machine drift from Step 1 (`git checkout -- tests/baselines/<file>`). Then:

```bash
bun run capture && bun run capture:compare
```

Expected: every baseline you kept matches.

- [ ] **Step 6: Run the suites that read the fixture**

```bash
cd apps/board && bun test tests/ src/client/board/__tests__
```

Expected: PASS (the layout test skips forward to the prose gate regardless of the new gates).

- [ ] **Step 7: Purity and commit**

```bash
./scripts/repo-purity.sh
bunx prettier --write apps/board/tests/capture.ts apps/board/tests/fixture/README.md apps/board/tests/fixture/data.json
git add apps/board/tests/capture.ts apps/board/tests/fixture/README.md apps/board/tests/fixture/data.json apps/board/tests/baselines
git commit -m "board: fixture respond gates with gate-ctx, queueplan and queuepost captures"
```

---

### Task 7: Look at it, then the full gates (controller, not a subagent)

This task needs Fast Browser and a human-quality look; the controller runs it after Task 6's review is clean.

- [ ] **Step 1: Boot the fixture board**

```bash
cd apps/board && BOARD_FIXTURE=$(pwd)/tests/fixture PORT=7941 bun run src/server.ts
```

(background; wait for `/healthz`). Use the raw port `http://127.0.0.1:7941/?member=all`, never a `.mattstack` URL.

- [ ] **Step 2: Screenshot both respond gates in both schemes with Fast Browser**

For each theme (`localStorage.setItem('mrs-theme', 'light' | 'dark')` then reload): open the decision queue, skip to the respond-plan gate, screenshot the modal; skip to the respond-post gate, screenshot the modal. Also open one prose gate (the review gate with the context pane) to confirm it still reads as before with the floor gone.

- [ ] **Step 3: Look, and say plainly what is wrong**

Check against the approved frames (header card, thread card, replies card): hierarchy (reviewer leads), no raw JSON, no `--text-3` content text, chip hues, severity pill, reply box wash, readable contrast in dark, no clipped text, no layout collapse. Fix anything wrong (TDD where it is behaviour, CSS where it is looks), re-baseline the affected captures, and commit each fix.

- [ ] **Step 4: Full verification**

From the repo root:

```bash
bun run tui-kit:build
bun run board:typecheck && bun run board:test && bun run lint && bun run board:build && bun run format:check && ./scripts/repo-purity.sh
```

Expected: every command exits 0.
