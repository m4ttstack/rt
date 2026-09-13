# rt pane send self Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent in a herdr pane queue a line into its own pane (`rt pane send self`), optionally followed by a continuation line (`--then`), and teach agents to reach for it through `rt:herdr-inject` and a "Crossing repos" section in `rt:worktree`.

**Architecture:** `self` lands in the CLI module `commands/pane.ts`: it resolves through the existing `selfPaneRef()` and simply omits `callerPane`, which is what the daemon's same-pane guard keys on. `--then` rides the `pane:send` payload as `continuation`; the daemon injects the first line, then in a detached wait injects the second once the target's turn has ended (Tasks 6-7; the original Task 2 design of two immediate calls inverted the order in the live check). rt-client gains the field and bumps to 0.20.0.

**Tech Stack:** Bun, TypeScript, `bun:test` (the fake rt daemon over a unix socket in `commands/__tests__/pane.test.ts`), herdr socket API via the running rt daemon, Claude Code skills (Markdown + YAML frontmatter).

**Spec:** `docs/superpowers/specs/2026-09-13-pane-send-self-design.md`

## Global Constraints

- No em dashes or en dashes anywhere (code, comments, commit messages, skills). Use `...`, parens, or rephrase.
- Comments only for constraints the code cannot show. No narration, no process citations, no ticket ids.
- Commit after every task with a short imperative message; every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Daemon and rt-client changes are limited to the deferred continuation (Task 6): `lib/daemon/inject.ts`, `lib/daemon/handlers/pane.ts`, `lib/daemon/command-router.ts`, and the `pane:send` types, wrapper, version and README row in `packages/rt-client`. Nothing else in `lib/daemon/**` or `packages/rt-client/**` changes. `bun run build` in `packages/rt-client` after touching it.
- Wire and type field name is `continuation`, never `then` (a `then` property reads as a thenable); only the CLI flag and the CLI's own output say `then`.
- Every skill edit goes through `superpowers:writing-skills` (RED baseline first).
- Worktree Bash guard: one plain command per Bash call (no `&&`, no heredocs, no `-C`, no loops). Use the Write/Edit tools for files.
- Exact CLI strings from the spec: usage `usage: rt pane send <pane|self> --text <text> [--then <text>]  (--text - reads stdin)`; not-in-pane error `not in a herdr pane (HERDR_PANE_ID unset)` (the module's `fail()` prefixes `rt pane: `); plain `--then` line prefix `then: `.
- This session's own pane is `wD0:pB`. Never send to it during the spike or tests; a queued line would arrive as a fake user turn.

---

### Task 0: Live spike (throwaway, gates everything below)

**Files:** none committed. Scratch dir: the session scratchpad.

**Interfaces:**
- Consumes: `rt pane spawn`, `rt pane send`, `rt pane peek` as they exist on `main` today (the dev `rt` wrapper runs the main checkout, not this worktree; that is fine, the spike needs only existing verbs).
- Produces: a written verdict in the task report: PASS, or which of (a)/(b)/(c) from the spec failed.

- [ ] **Step 1: Spawn a throwaway claude pane and capture its id**

Run: `rt pane spawn --cwd /private/tmp --prompt "Count from 1 to 40, printing one number per line, pausing about one second between numbers. Do not use tools." --json`

Expected: JSON with `ready: true` and `pane.paneId` like `wXX:pYY`. Record the id as `$T`. If `ready` is false, run `rt pane peek $T` and answer any trust dialog by hand before continuing.

- [ ] **Step 2: While it is counting, send the two-line pair**

Within ~15 seconds of step 1, run: `rt pane send <T> --text "/cd /Users/matt" --json`

Expected: `delivered: "queued"` (the pane is working).

Then immediately run: `rt pane send <T> --text "Now say DONE and print the output of pwd" --json`

Expected: `delivered: "queued"`.

(Two separate calls stand in for `--then`, which does not exist yet; ordering is what the spike checks.)

- [ ] **Step 3: Wait for the count to end, then read the screen**

Wait ~50 seconds, then run: `rt pane peek <T> --lines 40`

PASS if the screen shows, in order: the counting, `/cd /Users/matt` having run (Claude Code prints a cwd change line), then `DONE` and a `pwd` line ending in `/Users/matt`.

FAIL (a) if only the first queued line ran. FAIL (b) if `/cd` ran but the second line never did. FAIL (c) if a line sits unsubmitted in the composer (visible at the bottom, no response). Capture the peek output verbatim into the report.

- [ ] **Step 4: Close the throwaway pane**

Run: `herdr pane close <T>`

- [ ] **Step 5: Report**

Write the verdict. On PASS, proceed to Task 1. On any FAIL, stop: the controller re-approves a design change before Task 1 starts (the spec names the candidate fix for (c) and it widens scope into `lib/daemon/inject.ts`).

---

### Task 1: `self` target in `rt pane send`

**Files:**
- Modify: `commands/pane.ts` (the `paneSend` function and the header comment)
- Modify: `lib/command-tree-def.ts` (the `pane.subcommands.send` node, around line 1686)
- Test: `commands/__tests__/pane.test.ts`

**Interfaces:**
- Consumes: `selfPaneRef()` from `lib/self-pane.ts` (returns `"w1:p1"` or `"bg:w1:p1"` from `HERDR_PANE_ID`/`HERDR_SESSION`, or `undefined`); `paneSend` wrapper from rt-client with payload `{ paneId, text, callerPane? }`.
- Produces: `paneSend(args)` accepting `self` as the positional; the exported string constant `NOT_IN_PANE = "not in a herdr pane (HERDR_PANE_ID unset)"` (Task 2 reuses the same function).

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/pane.test.ts` (before the `pane focus` section header):

```ts
// ─── pane send self ────────────────────────────────────────────────────────

test("pane send self targets HERDR_PANE_ID and omits callerPane", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "queued" } } };
  const orig = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "w1:p1";
  try {
    const r = await run(paneSend, ["self", "--text", "/cd /repos/acme"]);
    expect(seen[0]).toEqual({ cmd: "pane:send", payload: { paneId: "w1:p1", text: "/cd /repos/acme" } });
    expect(r.stdout).toBe("w1:p1 queued");
    expect(r.code).toBe(0);
  } finally {
    if (orig === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = orig;
  }
});

test("pane send self from a bg pane targets the bg: ref", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "bg:w1:p1", delivered: "queued" } } };
  const origPane = process.env.HERDR_PANE_ID;
  const origSession = process.env.HERDR_SESSION;
  process.env.HERDR_PANE_ID = "w1:p1";
  process.env.HERDR_SESSION = "bg";
  try {
    await run(paneSend, ["self", "--text", "/cd /repos/acme"]);
    expect(seen[0]).toEqual({ cmd: "pane:send", payload: { paneId: "bg:w1:p1", text: "/cd /repos/acme" } });
  } finally {
    if (origPane === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = origPane;
    if (origSession === undefined) delete process.env.HERDR_SESSION; else process.env.HERDR_SESSION = origSession;
  }
});

test("pane send self outside a herdr pane fails before any daemon call", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "queued" } } };
  const orig = process.env.HERDR_PANE_ID;
  delete process.env.HERDR_PANE_ID;
  try {
    const r = await run(paneSend, ["self", "--text", "/cd /repos/acme"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("rt pane: not in a herdr pane (HERDR_PANE_ID unset)");
    expect(seen).toEqual([]);
  } finally {
    if (orig !== undefined) process.env.HERDR_PANE_ID = orig;
  }
});

test("pane send with a literal copy of the caller's own id still sends callerPane", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "that is this pane" } } };
  const orig = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "w1:p1";
  try {
    const r = await run(paneSend, ["w1:p1", "--text", "/cd /repos/acme"]);
    expect(seen[0]).toEqual({ cmd: "pane:send", payload: { paneId: "w1:p1", text: "/cd /repos/acme", callerPane: "w1:p1" } });
    expect(r.stdout).toBe("w1:p1 refused (that is this pane)");
  } finally {
    if (orig === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = orig;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test commands/__tests__/pane.test.ts -t "pane send self"`

Expected: the first three FAIL. The `self` test fails because the payload carries `paneId: "self"` and `callerPane`; the outside-pane test fails because a daemon call happened (`seen` is not empty). The literal-id test already passes (it pins existing behavior).

- [ ] **Step 3: Implement `self` in `commands/pane.ts`**

Replace the `paneSend` function with:

```ts
const SELF_TARGET = "self";
export const NOT_IN_PANE = "not in a herdr pane (HERDR_PANE_ID unset)";

export async function paneSend(args: string[]): Promise<void> {
  const target = positional(args);
  const rawText = flagValue(args, "--text");
  if (!target || rawText === undefined) fail("usage: rt pane send <pane|self> --text <text> [--then <text>]  (--text - reads stdin)");
  const text = rawText === "-" ? await new Response(Bun.stdin.stream()).text() : rawText;
  const own = selfPaneRef();
  // The daemon refuses a callerPane equal to the target, so `self` is the one
  // spelling that reaches this pane: it sends the own ref as the target and no
  // callerPane. A literal copy of the own id keeps the guard.
  if (target === SELF_TARGET && !own) fail(NOT_IN_PANE);
  const paneId = target === SELF_TARGET ? own! : target;
  const callerPane = target === SELF_TARGET ? undefined : own;
  const data = unwrap(await paneSendRt({ paneId, text, ...(callerPane ? { callerPane } : {}) }, opts(args)), "pane send");
  if (args.includes("--json")) return void console.log(JSON.stringify({ ok: true, ...data }));
  console.log(`${data.paneId} ${data.delivered}${data.reason ? ` (${data.reason})` : ""}`);
}
```

Update the module header comment line for send to:

```
 *   rt pane send <pane|self> --text <text> [--then <text>]        inject text into a pane; self is this pane (--text - reads stdin)
```

- [ ] **Step 4: Update the command tree node**

In `lib/command-tree-def.ts`, in `pane.subcommands.send`, change:

```ts
        description: "Inject text into a pane as if typed and submitted; self is this pane (--text - reads stdin)",
```

and the `Pane` arg to:

```ts
          { name: "Pane", type: "text", placeholder: "w7A:pY | self", hint: "herdr pane id to send to, or self for the pane this command runs in (HERDR_PANE_ID)" },
```

Leave `omitBehavior` as is.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test commands/__tests__/pane.test.ts`

Expected: all PASS, including the pre-existing `pane send requires a pane and --text` (usage text still contains `usage`).

Run: `bun test lib/__tests__/picker-conformance.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/pane.ts commands/__tests__/pane.test.ts lib/command-tree-def.ts
git commit -m "pane send: self targets the caller's own pane" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Two Bash calls: one `git add`, one `git commit`.)

---

### Task 2: `--then` continuation line

**Files:**
- Modify: `commands/pane.ts` (`FLAGS_WITH_VALUES`, `paneSend`)
- Modify: `lib/command-tree-def.ts` (`pane.subcommands.send.args`)
- Test: `commands/__tests__/pane.test.ts`

**Interfaces:**
- Consumes: `paneSend` from Task 1; `PaneSendResult` type from `packages/rt-client/src/index.ts` (`{ paneId; delivered: "accepted" | "queued" | "refused"; reason? }`).
- Produces: `--then <text>`; JSON `{ ok, paneId, delivered, reason?, then?: { delivered, reason? } }`; plain second line `then: <ref> <delivered> (<reason>)`.

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/pane.test.ts` after the Task 1 tests:

```ts
test("pane send --then queues a second line to the same target after a queued first", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "queued" } } };
  const orig = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "w1:p1";
  try {
    const r = await run(paneSend, ["self", "--text", "/cd /repos/acme", "--then", "Continue: enter worktree foo"]);
    expect(seen).toEqual([
      { cmd: "pane:send", payload: { paneId: "w1:p1", text: "/cd /repos/acme" } },
      { cmd: "pane:send", payload: { paneId: "w1:p1", text: "Continue: enter worktree foo" } },
    ]);
    expect(r.stdout).toBe("w1:p1 queued\nthen: w1:p1 queued");
    expect(r.code).toBe(0);
  } finally {
    if (orig === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = orig;
  }
});

test("pane send --then is skipped when the first line is refused", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "refused", reason: "at a prompt" } } };
  const r = await run(paneSend, ["w1:p2", "--text", "hi", "--then", "and again"]);
  expect(seen).toHaveLength(1);
  expect(r.stdout).toBe("w1:p2 refused (at a prompt)");
  expect(r.code).toBe(0);
});

test("pane send --then --json nests the second delivery under then", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "accepted" } } };
  const r = await run(paneSend, ["w1:p2", "--text", "hi", "--then", "and again", "--json"]);
  expect(seen).toHaveLength(2);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, paneId: "w1:p2", delivered: "accepted", then: { delivered: "accepted" } });
});

test("pane send --then --json omits then when the first line is refused", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "refused", reason: "not a claude pane" } } };
  const r = await run(paneSend, ["w1:p2", "--text", "hi", "--then", "and again", "--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, paneId: "w1:p2", delivered: "refused", reason: "not a claude pane" });
});

test("pane send --then value is not mistaken for the positional pane", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "accepted" } } };
  await run(paneSend, ["--then", "and again", "w1:p2", "--text", "hi"]);
  expect(seen[0]!.payload).toMatchObject({ paneId: "w1:p2", text: "hi" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test commands/__tests__/pane.test.ts -t "then"`

Expected: the first, third and fifth FAIL (only one daemon call is made; the fifth sends `paneId: "and again"`). The second and fourth pass already; they pin the gate.

- [ ] **Step 3: Implement `--then`**

In `commands/pane.ts`, add `"--then"` to `FLAGS_WITH_VALUES`:

```ts
const FLAGS_WITH_VALUES = new Set(["--lines", "--cwd", "--account", "--model", "--effort", "--prompt", "--workspace", "--q", "--sock", "--text", "--then"]);
```

Add the `PaneSendResult` type to the rt-client type import:

```ts
import type { ChatPane, PaneSendResult, RtResponse } from "../packages/rt-client/src/index.ts";
```

Replace the whole `paneSend` function (from Task 1) with the version below and add `renderDelivery` after it. `unwrap` takes a resolved `RtResponse`, so `send` awaits the wrapper before unwrapping:

```ts
export async function paneSend(args: string[]): Promise<void> {
  const target = positional(args);
  const rawText = flagValue(args, "--text");
  if (!target || rawText === undefined) fail("usage: rt pane send <pane|self> --text <text> [--then <text>]  (--text - reads stdin)");
  const text = rawText === "-" ? await new Response(Bun.stdin.stream()).text() : rawText;
  const own = selfPaneRef();
  // The daemon refuses a callerPane equal to the target, so `self` is the one
  // spelling that reaches this pane: it sends the own ref as the target and no
  // callerPane. A literal copy of the own id keeps the guard.
  if (target === SELF_TARGET && !own) fail(NOT_IN_PANE);
  const paneId = target === SELF_TARGET ? own! : target;
  const callerPane = target === SELF_TARGET ? undefined : own;
  const send = async (body: string, label: string): Promise<PaneSendResult> =>
    unwrap(await paneSendRt({ paneId, text: body, ...(callerPane ? { callerPane } : {}) }, opts(args)), label);
  const data = await send(text, "pane send");
  const thenText = flagValue(args, "--then");
  const then = thenText !== undefined && data.delivered !== "refused" ? await send(thenText, "pane send --then") : undefined;
  if (args.includes("--json")) {
    const thenJson = then ? { then: then.reason ? { delivered: then.delivered, reason: then.reason } : { delivered: then.delivered } } : {};
    return void console.log(JSON.stringify({ ok: true, ...data, ...thenJson }));
  }
  console.log(renderDelivery(data));
  if (then) console.log(`then: ${renderDelivery(then)}`);
}

function renderDelivery(d: PaneSendResult): string {
  return `${d.paneId} ${d.delivered}${d.reason ? ` (${d.reason})` : ""}`;
}
```

- [ ] **Step 4: Add the flag to the command tree**

In `lib/command-tree-def.ts`, `pane.subcommands.send.args`, insert after the `Text` arg:

```ts
          { name: "Then", flag: "--then", type: "text", optional: true, placeholder: "Continue: enter worktree foo", hint: "A second line queued after the first, sent only when the first was accepted or queued" },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test commands/__tests__/pane.test.ts`

Expected: all PASS.

Run: `bun test lib/__tests__/picker-conformance.test.ts lib/__tests__/no-ui-in-cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/pane.ts commands/__tests__/pane.test.ts lib/command-tree-def.ts
git commit -m "pane send: --then queues a continuation line" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `rt:herdr-inject` skill

**Files:**
- Create: `skills/rt-herdr-inject/SKILL.md`

**Interfaces:**
- Consumes: the finished verb from Tasks 1 and 2 (`rt pane send self --text <text> [--then <text>] [--json]`, the `queued` verdict, the `not in a herdr pane` error).
- Produces: the skill Task 4 links to as `rt:herdr-inject`.

- [ ] **Step 1: Invoke `superpowers:writing-skills` and run the RED baseline**

Invoke the skill. Then dispatch one subagent (model: sonnet) with no skill loaded and this prompt, verbatim:

> You are a Claude Code agent running inside a herdr pane (`HERDR_PANE_ID` is set in your environment). Your task is in the repo at `/Users/matt/Documents/GitHub/chat`, but your session cwd is `/Users/matt/Documents/GitHub/repo-tools`. `EnterWorktree` cannot cross repos, and `/cd` is a user-only Claude Code command you cannot call as a tool. Do not actually run anything; write out, step by step, exactly what commands you would run to get your session into the other repo and then continue with the task. Be concrete.

Record in the task report what the baseline agent does (expected: it reaches for `herdr pane list` / `herdr pane run $HERDR_PANE_ID "/cd ..."` or gives up; that is the four-step dance the skill removes).

- [ ] **Step 2: Write the skill**

Create `skills/rt-herdr-inject/SKILL.md`:

```markdown
---
name: rt:herdr-inject
description: Use when a Claude Code session needs a user-only slash command run in itself (/cd, /exit, /resume, /model) or needs a line typed into another agent's herdr pane ... or the moment you catch yourself working out whether this is a herdr pane and what its id is. Not for chat (see rt:chat) or for starting agents (rt agent, rt pane spawn).
---

# rt herdr-inject

`rt pane send` types a line into a herdr pane as if a human had typed it and
pressed Enter. `self` names the pane this session runs in, so an agent never
needs the herdr CLI, its pane id, or a check that it is inside herdr.

`rt pane send --help` is the live reference; trust it over anything here.

## Your own pane

```bash
rt pane send self --text "/cd /Users/matt/Documents/GitHub/chat"
```

- It always reports `queued`: you are mid-turn, so the line sits in the
  composer until your turn ends. **End your turn** right after, with one
  short line saying what was queued. More tool calls only delay it.
- Chain a continuation so nobody has to say "continue":

```bash
rt pane send self --text "/cd <repo>" --then "Continue: enter worktree <name> for <ticket>"
```

  Both lines run in order after the turn ends; the second arrives as your
  next user message, so phrase it as the instruction you want to receive.
- `not in a herdr pane (HERDR_PANE_ID unset)` means there is no pane to
  type into. Ask the human to type the line; never guess a pane id or fall
  back to the herdr CLI.

## Another agent's pane

```bash
rt pane list                       # find the pane id
rt pane send <pane> --text "..."   # accepted | queued | refused (reason)
```

`accepted` means the agent picked it up; `queued` means it was working and
will see it after its turn; `refused` says why (at a prompt, not a claude
pane). None of these exit non-zero; read the verdict.

## Body rules

- One line. For a body with quotes or `$`, pipe it: `printf '%s' "$body" | rt pane send self --text -`.
- Keep backticks out of `--text`; the shell eats them.
- `--json` for scripts: `{ ok, paneId, delivered, reason?, then? }`.
```

- [ ] **Step 3: GREEN retest**

Dispatch a fresh subagent (model: sonnet) with the same prompt as step 1, prefixed with: "Read `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/merry/skills/rt-herdr-inject/SKILL.md` first and follow it." (Adjust the path to wherever this worktree lives; `pwd` tells you.)

Expected: the agent answers with `rt pane send self --text "/cd /Users/matt/Documents/GitHub/chat" --then "..."` and says it would end its turn. If it still reaches for the herdr CLI or forgets to end the turn, tighten the skill text and retest once.

- [ ] **Step 4: Commit**

```bash
git add skills/rt-herdr-inject/SKILL.md
git commit -m "skills: add rt:herdr-inject" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Doors from `rt:worktree` and `rt:chat`

**Files:**
- Modify: `skills/rt-worktree/SKILL.md` (append a section after "Driving it as an agent")
- Modify: `skills/rt-chat/SKILL.md:153-155`

**Interfaces:**
- Consumes: `rt:herdr-inject` from Task 3.
- Produces: nothing downstream.

- [ ] **Step 1: Invoke `superpowers:writing-skills` and run the RED baseline**

Dispatch one subagent (model: sonnet) with this prompt, verbatim:

> Read `<worktree>/skills/rt-worktree/SKILL.md` and follow it. You are a Claude Code agent in a herdr pane. Your session cwd is `/Users/matt/Documents/GitHub/repo-tools`. Matt asks you to start ticket CHAT-42 in the repo at `/Users/matt/Documents/GitHub/chat`, which rt manages. Do not run anything; write the exact sequence of tool calls and commands you would make, in order.

Record what it does (expected: it calls `EnterWorktree` from the wrong repo, or improvises a cd).

- [ ] **Step 2: Add the section to `rt:worktree`**

Append to `skills/rt-worktree/SKILL.md`:

```markdown
## Crossing repos

`EnterWorktree` cannot leave the repo the session started in. When the
task's repo is not the session cwd, queue the cd and the next step into
your own pane, then end the turn:

```bash
rt pane send self --text "/cd /Users/matt/Documents/GitHub/chat" --then "Continue: EnterWorktree name chat-42 for CHAT-42"
```

The `/cd` runs when your turn ends and the `--then` line arrives as your
next message, so the worktree step happens in the right repo without
anyone typing "continue". Outside a herdr pane the command says so; ask
Matt to run the `/cd` instead. Rules and the other-pane form: `rt:herdr-inject`.
```

- [ ] **Step 3: Point `rt:chat` at the self form**

In `skills/rt-chat/SKILL.md`, replace lines 153-155:

```markdown
`rt pane send <pane> --text <text>` injects text into a pane and reports
`accepted` \| `queued` \| `refused`; a working pane queues the text until its
turn ends. It's the primitive the herdr-chat plugin's broadcast uses.
```

with:

```markdown
`rt pane send <pane> --text <text>` injects text into a pane and reports
`accepted` \| `queued` \| `refused`; a working pane queues the text until its
turn ends. It's the primitive the herdr-chat plugin's broadcast uses. `self`
as the pane is your own session (user-only slash commands); see `rt:herdr-inject`.
```

- [ ] **Step 4: GREEN retest**

Dispatch a fresh subagent (model: sonnet) with the step 1 prompt.

Expected: it runs `rt pane send self --text "/cd /Users/matt/Documents/GitHub/chat" --then "..."`, ends the turn, and describes `EnterWorktree` happening in the next turn. Tighten and retest once if not.

- [ ] **Step 5: Commit**

```bash
git add skills/rt-worktree/SKILL.md skills/rt-chat/SKILL.md
git commit -m "skills: rt:worktree crossing repos, rt:chat points at self" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verify end to end and open the PR (SUPERSEDED by Task 8)

Ran once on 2026-09-13: full suite green, but the live check inverted the
order of `/cd` and the `--then` line (see the spec's "Deferred
continuation"). Tasks 6 and 7 rework `--then`; Task 8 repeats this task's
verification and opens the PR. The steps below are kept for the record.

- [ ] **Step 1: Full test run**

Run: `bun run test:all`

Expected: green. If a failure is unrelated to `commands/pane.ts` or the skills, re-run the failing file alone; the suite has known rotating flakes on main. Report any real failure with the test name.

- [ ] **Step 2: Live check from this worktree's source**

Never target `self` from this session (its pane is `wD0:pB`; a queued line would arrive as a fake user turn). Spawn a throwaway pane as in Task 0 step 1, then run:

`bun run cli.ts pane send <T> --text "/cd /Users/matt" --then "Say DONE and print pwd" --json`

Expected: `{"ok":true,"paneId":"<T>","delivered":"queued","then":{"delivered":"queued"}}`, and `rt pane peek <T>` after the count shows both lines ran in order. Close the pane with `herdr pane close <T>`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin pane-send-self
gh pr create --title "rt pane send self: an agent's door into its own pane" --body-file /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/3e0d4051-6753-464e-8149-f13602948e5e/scratchpad/pr-body.md
```

Write `pr-body.md` with the Write tool first: a short framing paragraph, "What changed" bullets (verb, `--then`, two skills, one pointer), the spike verdict from Task 0 with the peek excerpt, and the closing line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Post-merge (controller, not the PR)**

After merge and a `git pull` in the main checkout: `ln -s /Users/matt/Documents/GitHub/repo-tools/skills/rt-herdr-inject ~/.claude/skills/rt:herdr-inject`. The existing `rt:worktree` and `rt:chat` symlinks pick their edits up on pull. Matt's `~/.claude/CLAUDE.md` "inject it via herdr" line can then point at `rt:herdr-inject`.

---

### Task 6: Daemon-deferred continuation (`injectAfterTurn`, `pane:send continuation`, rt-client 0.20.0)

**Files:**
- Modify: `lib/daemon/inject.ts` (add `injectAfterTurn`)
- Modify: `lib/daemon/handlers/pane.ts` (`createPaneHandlers` opts gain `log?`; `pane:send` schedules the continuation)
- Modify: `lib/daemon/command-router.ts:136-139` (pass `log: ctx.log`)
- Modify: `packages/rt-client/src/commands.ts:263-264,619` (types)
- Modify: `packages/rt-client/src/client.ts:429-436` (`paneSend` forwards `continuation`)
- Modify: `packages/rt-client/package.json:3` (`0.19.1` -> `0.20.0`)
- Modify: `packages/rt-client/README.md:105-106` (one row)
- Test: `lib/daemon/__tests__/inject.test.ts`, `lib/daemon/__tests__/pane-handlers.test.ts`

**Interfaces:**
- Consumes: `injectIntoPane`, `herdrRequest`, `waitTimeout` (all in place); `Logger` from `pino` (the type `lib/daemon/handlers/types.ts` already imports).
- Produces: `injectAfterTurn(opts: AfterTurnOptions): Promise<void>` exported from `lib/daemon/inject.ts`; `Commands["pane:send"]` payload `{ paneId; text; callerPane?; continuation? }` and data `PaneSendResult { paneId; delivered; reason?; continuation?: { delivered: "deferred" } }`; `paneSend` wrapper forwarding `continuation`. Task 7 consumes all three.

- [ ] **Step 1: Write the failing `injectAfterTurn` tests**

Append to `lib/daemon/__tests__/inject.test.ts`:

```ts
import { injectAfterTurn } from "../inject.ts";

// ─── injectAfterTurn ───────────────────────────────────────────────────────

const noLog = { info: () => {}, warn: () => {} } as unknown as import("pino").Logger;

test("injectAfterTurn waits for the turn to end, then injects the continuation", async () => {
  let waits = 0;
  const { herdr, seen } = on((method, params) => {
    if (method === "agent.wait") return ++waits === 1 ? new HerdrFakeError("timeout", "timed out waiting for agent status") : agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  const logged: unknown[] = [];
  const log = { info: (o: unknown) => { logged.push(o); }, warn: () => {} } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50 });
  const methods = seen.map((s) => s.method);
  expect(methods).toEqual(["agent.wait", "agent.wait", "agent.get", "agent.prompt"]);
  expect(seen[0]!.params).toEqual({ target: "w1:p1", until: ["idle", "done"], timeout_ms: 50 });
  expect(seen[3]!.params).toMatchObject({ target: "w1:p1", text: "Continue" });
  expect(logged[0]).toMatchObject({ paneId: "w1:p1", delivered: "accepted" });
});

test("injectAfterTurn abandons on a herdr error that is not a leg timeout", async () => {
  const { herdr, seen } = on((method) => (method === "agent.wait" ? new HerdrFakeError("agent_not_found", "gone") : new HerdrFakeError("invalid_request", method)));
  const warned: unknown[] = [];
  const log = { info: () => {}, warn: (o: unknown) => { warned.push(o); } } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 50 });
  expect(seen.map((s) => s.method)).toEqual(["agent.wait"]);
  expect(warned[0]).toMatchObject({ paneId: "w1:p1" });
});

test("injectAfterTurn abandons at the deadline when the turn never ends", async () => {
  const { herdr, seen } = on((method) => (method === "agent.wait" ? new HerdrFakeError("timeout", "timed out") : new HerdrFakeError("invalid_request", method)));
  const warned: unknown[] = [];
  const log = { info: () => {}, warn: (o: unknown) => { warned.push(o); } } as unknown as import("pino").Logger;
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", herdr, log, legMs: 20, maxWaitMs: 70 });
  expect(seen.every((s) => s.method === "agent.wait")).toBe(true);
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(warned).toHaveLength(1);
});

test("injectAfterTurn passes sockPath through the wait and the injection", async () => {
  const { sock, seen, stop } = fakeHerdr((method, params) => {
    if (method === "agent.wait") return agent("idle");
    if (method === "agent.get") return agent("idle");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...agent("working").agent, text: params.text } };
    return new HerdrFakeError("invalid_request", method);
  });
  stops.push(stop);
  await injectAfterTurn({ paneId: "w1:p1", text: "Continue", sockPath: sock, log: noLog, legMs: 50 });
  expect(seen.map((s) => s.method)).toEqual(["agent.wait", "agent.get", "agent.prompt"]);
});
```

Put the `import { injectAfterTurn } ...` line with the other imports at the top of the file rather than mid-file (merge it into the existing `import { injectIntoPane } from "../inject.ts";`).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/inject.test.ts -t "injectAfterTurn"`

Expected: FAIL, `injectAfterTurn` is not exported.

- [ ] **Step 3: Implement `injectAfterTurn`**

Append to `lib/daemon/inject.ts` (add `import type { Logger } from "pino";` at the top):

```ts
const AFTER_TURN_STATES = ["idle", "done"];
const AFTER_TURN_LEG_MS = 60_000;
const AFTER_TURN_MAX_MS = 30 * 60_000;

export interface AfterTurnOptions {
  paneId: string;
  text: string;
  herdr?: typeof herdrRequest;
  sockPath?: string;
  log?: Logger;
  legMs?: number;
  maxWaitMs?: number;
}

/**
 * Injects `text` once the target's current turn has ended. Claude Code hands
 * a plain line queued mid-turn to the model inside that turn, while a slash
 * command waits for the turn's end, so a continuation sent right behind one
 * would run first; waiting for idle restores the order. `blocked` is a
 * prompt mid-turn, not an end, so it keeps waiting. The caller is often the
 * very pane whose turn must end, so this never blocks a reply: handlers
 * schedule it with `void`.
 */
export async function injectAfterTurn(opts: AfterTurnOptions): Promise<void> {
  const { paneId, text, sockPath, log } = opts;
  const herdr = opts.herdr ?? herdrRequest;
  const legMs = opts.legMs ?? AFTER_TURN_LEG_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? AFTER_TURN_MAX_MS);
  while (Date.now() < deadline) {
    const settled = await herdr("agent.wait", { target: paneId, until: AFTER_TURN_STATES, timeout_ms: legMs }, { timeoutMs: waitTimeout(legMs), sockPath });
    if (settled.ok) {
      const res = await injectIntoPane({ paneId, text, herdr, sockPath });
      if (res.ok) log?.info({ paneId, ...res.data }, "pane:send continuation delivered");
      else log?.warn({ paneId, err: res.error }, "pane:send continuation failed");
      return;
    }
    if (settled.code !== "timeout") {
      log?.warn({ paneId, err: settled.message }, "pane:send continuation abandoned");
      return;
    }
  }
  log?.warn({ paneId }, "pane:send continuation abandoned: turn never ended");
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/daemon/__tests__/inject.test.ts`

Expected: all PASS (the existing 15 plus 4 new).

- [ ] **Step 5: rt-client types and wrapper**

In `packages/rt-client/src/commands.ts` replace lines 263-264 with:

```ts
export type PaneDelivery = "accepted" | "queued" | "refused";
/** `continuation` is present only when the daemon scheduled a second line for after the target's current turn. */
export interface PaneSendResult { paneId: string; delivered: PaneDelivery; reason?: string; continuation?: { delivered: "deferred" } }
```

and line 619 with:

```ts
  "pane:send": { payload: { paneId: string; text: string; callerPane?: string; continuation?: string }; data: PaneSendResult };
```

In `packages/rt-client/src/client.ts`, in `paneSend`, after the `callerPane` line add:

```ts
  if (a.continuation !== undefined) payload.continuation = a.continuation;
```

In `packages/rt-client/package.json` change `"version": "0.19.1"` to `"version": "0.20.0"`.

In `packages/rt-client/README.md` after line 105 add a row:

```markdown
| `paneSend` | type a line into a pane; `accepted`, `queued` or `refused`, plus an optional `continuation` the daemon types once the pane's turn has ended |
```

- [ ] **Step 6: Write the failing handler tests**

Append to `lib/daemon/__tests__/pane-handlers.test.ts` after the `pane:send is herdr unavailable` test:

```ts
test("pane:send with a continuation replies deferred and schedules the second line for after the turn", async () => {
  const claude = (status: string) => ({ type: "agent_info", agent: { pane_id: "w1:p1", agent: "claude", agent_status: status } });
  let waited = false;
  const { sock, seen, stop } = fakeHerdr((method, params) => {
    if (method === "agent.get") return claude(waited ? "idle" : "working");
    if (method === "agent.prompt") return { type: "agent_prompted", agent: { ...claude("working").agent, text: params.text } };
    if (method === "agent.wait") { waited = true; return claude("idle"); }
    return new HerdrFakeError("invalid_request", method);
  });
  stops.push(stop);
  const herdr: typeof herdrRequest = (m, p, o) => herdrRequest(m, p, { ...o, sockPath: sock });
  const scheduled: Array<Promise<void>> = [];
  const pane = createPaneHandlers({ db: freshDb(), repoIndex: () => ({}), herdr, schedule: (p) => { scheduled.push(p); } });
  const res = await pane["pane:send"]({ paneId: "w1:p1", text: "/cd /repos/chat", continuation: "Continue: enter worktree" });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "queued", continuation: { delivered: "deferred" } } });
  expect(scheduled).toHaveLength(1);
  await scheduled[0];
  const prompts = seen.filter((s) => s.method === "agent.prompt").map((s) => s.params.text);
  expect(prompts).toEqual(["/cd /repos/chat", "Continue: enter worktree"]);
  expect(seen.findIndex((s) => s.method === "agent.wait")).toBeGreaterThan(seen.findIndex((s) => s.params.text === "/cd /repos/chat"));
});

test("pane:send with a continuation after a refused first line schedules nothing and omits continuation", async () => {
  const scheduled: Array<Promise<void>> = [];
  const { sock, stop } = fakeHerdr(() => new HerdrFakeError("invalid_request", "unused"));
  stops.push(stop);
  const herdr: typeof herdrRequest = (m, p, o) => herdrRequest(m, p, { ...o, sockPath: sock });
  const pane = createPaneHandlers({ db: freshDb(), repoIndex: () => ({}), herdr, schedule: (p) => { scheduled.push(p); } });
  const res = await pane["pane:send"]({ paneId: "w1:p1", text: "x", callerPane: "w1:p1", continuation: "y" });
  expect(res).toEqual({ ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "that is this pane" } });
  expect(scheduled).toHaveLength(0);
});
```

- [ ] **Step 7: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/pane-handlers.test.ts -t "continuation"`

Expected: FAIL (`schedule` is not an option; the reply has no `continuation`).

- [ ] **Step 8: Implement the handler side**

In `lib/daemon/handlers/pane.ts`:

Add to the imports: `import type { Logger } from "pino";` and change the inject import to `import { herdrError, injectAfterTurn, injectIntoPane } from "../inject.ts";`.

Add two fields to `createPaneHandlers`'s `opts` type, after `herdrRunnerFor`:

```ts
  /** Daemon logger for the continuation's outcome; the reply has already gone out by then. */
  log?: Logger;
  /** How a continuation's detached wait is started; tests capture the promise, the daemon fires and forgets. */
  schedule?: (work: Promise<void>) => void;
```

In the destructuring block after `const herdrRunnerFor = opts.herdrRunnerFor;` add:

```ts
  const log = opts.log;
  const schedule = opts.schedule ?? ((work: Promise<void>) => { void work; });
```

Replace the `pane:send` handler with:

```ts
    "pane:send": async (rawPayload: unknown): Promise<CommandResult<"pane:send">> => {
      const payload = rawPayload as Commands["pane:send"]["payload"];
      const { paneId, sockPath } = resolvePaneRef(payload.paneId);
      const res = await injectIntoPane({ paneId, text: payload.text, callerPane: payload.callerPane, herdr, sockPath });
      if (!res.ok) return res;
      // Echo the ref the caller passed in, not the bare id injectIntoPane
      // resolved against: the round-trip rule -- whatever a caller sends
      // addressably, every verb (including this one's own reply) prints
      // addressably back.
      const data = { ...res.data, paneId: payload.paneId };
      if (payload.continuation === undefined || res.data.delivered === "refused") return { ok: true, data };
      schedule(injectAfterTurn({ paneId, text: payload.continuation, herdr, sockPath, log }));
      return { ok: true, data: { ...data, continuation: { delivered: "deferred" } } };
    },
```

In `lib/daemon/command-router.ts` change the `createPaneHandlers({` call to pass the logger:

```ts
  const paneHandlers = createPaneHandlers({
    db: opts.stateDb, repoIndex: ctx.repoIndex, bg: opts.bgService, log: ctx.log,
    herdrRunnerFor: (socket) => defaultHerdrRunner(socket ? { ...process.env, HERDR_SOCKET_PATH: socket } : process.env),
  });
```

- [ ] **Step 9: Build rt-client, run the tests**

Run: `bun run build` with cwd `packages/rt-client` (use the Bash tool's working directory by running `bun run --cwd packages/rt-client build`).

Run: `bun test lib/daemon/__tests__/inject.test.ts lib/daemon/__tests__/pane-handlers.test.ts packages/rt-client/test`

Expected: all PASS, including `packages/rt-client/test/dist-freshness.test.ts`.

Run: `bun test commands/__tests__/pane.test.ts`

Expected: PASS still (the CLI is untouched until Task 7; the daemon ignores the CLI's second call and the CLI ignores the new field).

- [ ] **Step 10: Commit**

```bash
git add lib/daemon/inject.ts lib/daemon/handlers/pane.ts lib/daemon/command-router.ts lib/daemon/__tests__/inject.test.ts lib/daemon/__tests__/pane-handlers.test.ts packages/rt-client/src/commands.ts packages/rt-client/src/client.ts packages/rt-client/package.json packages/rt-client/README.md
git commit -m "pane:send: continuation delivered after the target's turn ends; rt-client 0.20.0" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: CLI `--then` rides the payload

**Files:**
- Modify: `commands/pane.ts` (`paneSend`, `renderDelivery`, header comment)
- Modify: `lib/command-tree-def.ts` (the `Then` arg hint)
- Test: `commands/__tests__/pane.test.ts`

**Interfaces:**
- Consumes: `paneSend` wrapper forwarding `continuation`; `PaneSendResult.continuation?: { delivered: "deferred" }` (Task 6).
- Produces: `rt pane send <pane|self> --text <text> [--then <text>]` making ONE daemon call; plain output second line `then: <ref> deferred`; JSON `{ ok, paneId, delivered, reason?, then?: { delivered: "deferred" } }`.

- [ ] **Step 1: Rewrite the `--then` tests**

In `commands/__tests__/pane.test.ts`, replace the five Task 2 tests (from `test("pane send --then queues a second line ...` through the end of `test("pane send --then value is not mistaken ...`) with:

```ts
test("pane send --then rides the payload as continuation and prints the deferred line", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "queued", continuation: { delivered: "deferred" } } } };
  const orig = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "w1:p1";
  try {
    const r = await run(paneSend, ["self", "--text", "/cd /repos/acme", "--then", "Continue: enter worktree foo"]);
    expect(seen).toEqual([{ cmd: "pane:send", payload: { paneId: "w1:p1", text: "/cd /repos/acme", continuation: "Continue: enter worktree foo" } }]);
    expect(r.stdout).toBe("w1:p1 queued\nthen: w1:p1 deferred");
    expect(r.code).toBe(0);
  } finally {
    if (orig === undefined) delete process.env.HERDR_PANE_ID; else process.env.HERDR_PANE_ID = orig;
  }
});

test("pane send --then prints no then line when the daemon scheduled nothing", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "refused", reason: "at a prompt" } } };
  const r = await run(paneSend, ["w1:p2", "--text", "hi", "--then", "and again"]);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.payload).toMatchObject({ paneId: "w1:p2", text: "hi", continuation: "and again" });
  expect(r.stdout).toBe("w1:p2 refused (at a prompt)");
  expect(r.code).toBe(0);
});

test("pane send --then --json maps continuation to then", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "accepted", continuation: { delivered: "deferred" } } } };
  const r = await run(paneSend, ["w1:p2", "--text", "hi", "--then", "and again", "--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, paneId: "w1:p2", delivered: "accepted", then: { delivered: "deferred" } });
});

test("pane send --then --json omits then when the daemon scheduled nothing", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "refused", reason: "not a claude pane" } } };
  const r = await run(paneSend, ["w1:p2", "--text", "hi", "--then", "and again", "--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, paneId: "w1:p2", delivered: "refused", reason: "not a claude pane" });
});

test("pane send without --then sends no continuation", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "accepted" } } };
  await run(paneSend, ["w1:p2", "--text", "hi"]);
  expect(seen[0]!.payload).not.toHaveProperty("continuation");
});

test("pane send --then value is not mistaken for the positional pane", async () => {
  replies = { "pane:send": { ok: true, data: { paneId: "w1:p2", delivered: "accepted" } } };
  await run(paneSend, ["--then", "and again", "w1:p2", "--text", "hi"]);
  expect(seen[0]!.payload).toMatchObject({ paneId: "w1:p2", text: "hi" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/pane.test.ts -t "then"`

Expected: the first three FAIL (two daemon calls are made; no `continuation` in the payload; no `then` in the JSON). The others pass.

- [ ] **Step 3: Rewrite `paneSend`**

In `commands/pane.ts` replace `paneSend` and `renderDelivery` with:

```ts
export async function paneSend(args: string[]): Promise<void> {
  const target = positional(args);
  const rawText = flagValue(args, "--text");
  if (!target || rawText === undefined) fail("usage: rt pane send <pane|self> --text <text> [--then <text>]  (--text - reads stdin)");
  const text = rawText === "-" ? await new Response(Bun.stdin.stream()).text() : rawText;
  const own = selfPaneRef();
  // The daemon refuses a callerPane equal to the target, so `self` is the one
  // spelling that reaches this pane: it sends the own ref as the target and no
  // callerPane. A literal copy of the own id keeps the guard.
  if (target === SELF_TARGET && !own) fail(NOT_IN_PANE);
  const paneId = target === SELF_TARGET ? own! : target;
  const callerPane = target === SELF_TARGET ? undefined : own;
  const continuation = flagValue(args, "--then");
  const data = unwrap(
    await paneSendRt({ paneId, text, ...(callerPane ? { callerPane } : {}), ...(continuation !== undefined ? { continuation } : {}) }, opts(args)),
    "pane send",
  );
  const { continuation: then, ...first } = data;
  if (args.includes("--json")) return void console.log(JSON.stringify({ ok: true, ...first, ...(then ? { then } : {}) }));
  console.log(renderDelivery(first));
  if (then) console.log(`then: ${first.paneId} ${then.delivered}`);
}

function renderDelivery(d: Pick<PaneSendResult, "paneId" | "delivered" | "reason">): string {
  return `${d.paneId} ${d.delivered}${d.reason ? ` (${d.reason})` : ""}`;
}
```

Update the header comment line for send to:

```
 *   rt pane send <pane|self> --text <text> [--then <text>]        inject text into a pane; self is this pane; --then lands after its turn (--text - reads stdin)
```

In `lib/command-tree-def.ts` change the `Then` arg hint to:

```ts
          { name: "Then", flag: "--then", type: "text", optional: true, placeholder: "Continue: enter worktree foo", hint: "A second line the daemon types once the pane's current turn has ended, so it lands after a slash command; skipped when the first line is refused" },
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test commands/__tests__/pane.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-ui-in-cli.test.ts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/pane.ts commands/__tests__/pane.test.ts lib/command-tree-def.ts
git commit -m "pane send: --then rides the payload as continuation" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verify end to end and open the PR

**Files:** none new.

- [ ] **Step 1: Full test run**

Run: `bun run test:all > <scratchpad>/test-all-2.log 2>&1`, then grep the log for the pass/fail summary lines.

Expected: green. Re-run a failing file alone if it is unrelated to this branch (the suite has rotating flakes on main); report any real failure by test name.

- [ ] **Step 2: Live check against a daemon running THIS branch**

The dev daemon runs the main checkout's code, so the continuation path is not live until a daemon on this branch is up. The controller decides how (restart the dev daemon from this worktree, or run an isolated daemon under `env -i HOME=<temp>`); never spawn a competing daemon against the real `rt.sock`.

Never target `self` from this session (pane `wD0:pB`). Spawn a throwaway pane: `rt pane spawn --cwd /private/tmp --prompt "Run the shell command sleep 20 in the foreground, then say READY" --json`, record its id `T`, then within the 20 s run:

`bun run cli.ts pane send <T> --text "/cd /Users/matt" --then "Say DONE and print pwd" --json`

Expected: `{"ok":true,"paneId":"<T>","delivered":"queued","then":{"delivered":"deferred"}}`. After ~40 s, `rt pane peek <T> --lines 40` shows, in order: READY, `/cd /Users/matt` with `Moved to /Users/matt`, then DONE and `/Users/matt`. Close the pane with `herdr pane close <T>`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin pane-send-self
gh pr create --title "rt pane send self: an agent's door into its own pane" --body-file /private/tmp/claude-501/-Users-matt-Documents-GitHub-repo-tools/3e0d4051-6753-464e-8149-f13602948e5e/scratchpad/pr-body.md
```

Write `pr-body.md` with the Write tool first: a short framing paragraph; "What changed" bullets (self target, `--then` as a daemon-deferred continuation, rt-client 0.20.0, two skills, one pointer); the spike verdict and the ordering finding that forced the daemon change, with the peek excerpts; the rt-client version bump announced for other lanes; the closing line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Post-merge (controller, not the PR)**

After merge and a `git pull` in the main checkout: `ln -s /Users/matt/Documents/GitHub/repo-tools/skills/rt-herdr-inject ~/.claude/skills/rt:herdr-inject`; restart the dev daemon so `pane:send continuation` is live (a merged daemon change is not live until then). Matt's `~/.claude/CLAUDE.md` "inject it via herdr" line can then point at `rt:herdr-inject`.
