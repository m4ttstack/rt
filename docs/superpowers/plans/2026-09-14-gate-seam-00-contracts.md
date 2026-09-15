# Gate seam epic: shared contracts (wave 1)

> Not a plan. This document pins every cross-lane interface ONCE. Each lane
> plan (2026-09-14-gate-seam-L*.md) cites this file in its Global
> Constraints; a lane that needs to deviate STOPS and surfaces it rather
> than deviating locally.

Spec: `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md`

## C1. The 4-option form cap (owner: rt-client)

```ts
// packages/rt-client/src/gate-presentation.ts
export const GATE_FORM_OPTION_CAP = 4;

/** The ONE presentation rule. form iff an injectable pane exists, a nudge
    target exists, and every question fits the native form's option cap. */
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

Exported from rt-client's index. Consumers: the daemon's gate:ask handler
and herd:ask (L2); the board deletes its own copy in wave 2 (BOARD-31).

## C2. Canonical answer-shape module (owner: rt-client, lane L3)

```ts
// packages/rt-client/src/gate-answers.ts
import type { GateQuestion, GateAnswer } from "./commands.ts";

export type GateAnswerWire = GateAnswer["answers"][string];

/** Bare value out of the {value, note} wrapper; non-objects pass through. */
export function unwrapGateAnswerValue(raw: unknown): unknown;

/** null when valid, else the first human-readable error. Rules (verbatim
    from today's daemon validateAnswers, lib/daemon/handlers/gate.ts:163-184):
    unknown question id; multi expects array / single expects scalar; every
    element a string; option membership against VALUES when options are
    non-empty; every question id present in answers. */
export function validateGateAnswers(
  questions: GateQuestion[],
  answers: Record<string, unknown>,
): string | null;
```

Daemon `validateAnswers` becomes a re-export/thin call of this. gate-kit's
`payload.ts`/`react` keep their UI-shaping functions but any duplicated
membership logic is replaced by importing this module (wave 2, BOARD-31
side; L3 only lands the module + daemon consumption).

## C3. gate:ask wire contract (owner: rt-client commands.ts, lane L2)

```ts
// packages/rt-client/src/commands.ts (Commands map entry + COMMAND_NAMES)
"gate:ask": {
  payload: {
    questions: GateQuestion[];
    context?: string;
    kind?: string;          // default "question"
    subject?: string;       // explicit override; else resolved
    sessionId?: string;     // CLAUDE_CODE_SESSION_ID from the caller
    paneId?: string;        // HERDR_PANE_ID from the caller
  };
  data: {
    id: string;
    presentation: "form" | "wait";
    subject: string;
    supersededId: string | null;
  };
};
```

Handler behavior (lane L2, lib/daemon/handlers/gate.ts):

| Input state | Behavior |
|---|---|
| subject given | use verbatim (gate:open's `<prefix>:<id>` validation applies) |
| else sessionId with exactly one running run recorded for it | `run:<runId>` via lib/runs/store.ts `findRunsBySession` filtered to running |
| else sessionId matching an agent record | `agent:<id>` via lib/state/agents-store.ts `getAgent(sessionId)` |
| else | `{ok:false, error:"no subject: pass --subject, or run under a recorded run/agent session"}` |
| >1 running runs for the session | `{ok:false, error}` naming the candidate run ids (mirror resolve-db.ts:75-76) |

Presentation from C1's `gatePresentation`. On "form": `nudge = {session:
sessionId}` and `origin = {paneId, presentation:"form", ...(runId? {runId}),
worktree: <run's worktree field when resolved from a run>}`. On "wait":
no nudge; origin carries presentation "wait" plus runId/worktree when known.
Context over 8192 UTF-8 bytes is OMITTED (not trimmed, not an error);
the response is unchanged. Everything else (supersede, validation, events,
push) is inherited by delegating to the existing gate:open handler
internally; gate:ask NEVER reimplements open semantics.

herd:ask change (same lane): `paneOrigin` (handlers/herd.ts:82-83) is
replaced by C1's `gatePresentation({paneId: paneRef, sessionId: session,
questions})`; nudge only on "form".

## C4. rt gate ask CLI (wave 2, RT-150; pinned now for prose stability)

```
rt gate ask --questions <json> [--context <text>] [--kind <k>] [--subject <s>] [--json]
```

Reads CLAUDE_CODE_SESSION_ID and HERDR_PANE_ID from its own env, passes
them as payload fields. Output (always JSON, matching the daemon data):
`{"ok":true,"id":"gt-...","presentation":"form","subject":"run:..."}`.
Exit 1 with `{"ok":false,"error":...}` on refusal. No TTY behavior, no
picker (agent-facing exempt).

## C5. rt mcp serve (lane L4)

- Module: `commands/mcp.ts`, tree node `mcp` -> subcommand `serve`
  (hidden: true; agent/plugin-facing). Module-registry entry:
  `"./commands/mcp.ts": () => import("../commands/mcp.ts")` per the thunk
  convention.
- Dependency: `@modelcontextprotocol/sdk` (exact-pin in package.json;
  stdio transport). Imported ONLY inside the serve handler (lazy; the
  no-eager-tui/startup gates must stay green).
- Server name: `mattstack`. Tool names (flat, snake_case):
  `gate_answer, gate_list, chat_post, chat_dm, chat_ack, chat_claim,
  chat_release, mr_reply_thread, herd_gates, herd_ask, herd_answer,
  herd_report` (L4), plus `gate_ask, mr_comment_inline, mr_map` (wave 2).
- Every tool handler: resolve env ONCE per call
  (`process.env.CLAUDE_CODE_SESSION_ID`, `HERDR_PANE_ID`, `HERD_ID`,
  `HERD_JOB`), call the typed rt-client function, return
  `{content:[{type:"text", text: JSON.stringify(result)}]}`; an
  `{ok:false}` becomes an MCP tool error with the daemon's error string.
- Chat identity: `readChatSession(process.env.CLAUDE_CODE_SESSION_ID)`
  (lib/chat-session.ts:53) supplies the handle; no handle -> tool error
  telling the model to run `rt chat sign-in` (sign-in stays CLI).
- Input schemas (zod or hand JSON schema, L4's choice, but the SHAPES are
  fixed):
  - chat_post: `{room: string, body: string, mentions?: string[], quiet?: boolean}`
  - chat_dm: `{to: string, body: string}`
  - chat_ack / chat_claim / chat_release: `{id: number}`
  - gate_answer: `{id: string, answers: Record<string, string | string[] | {value: string|string[], note?: string}>, override?: boolean}` (by="pane", session from env)
  - gate_list: `{open?: boolean, subjectPrefix?: string, kind?: string, limit?: number}`
  - mr_reply_thread: `{repoName: string, iid: number, discussionId: string, body: string}`
  - herd_gates: `{herd?: string}` (default HERD_ID)
  - herd_ask: `{questions: GateQuestion[], context?: string}` (herd/job/session from env)
  - herd_answer: `{gate: string}`
  - herd_report: `{body: string}`
- Plugin wiring (mattstack-skills repo): the plugin's `.mcp.json` gains
  `{"mcpServers": {"mattstack": {"command": "rt", "args": ["mcp", "serve"]}}}`
  (exact key names per Claude Code plugin MCP config).

## C6. mr:comment-inline (lane L5; spans glance + repo-tools)

glance (packages/glance, m4ttstack/glance) NoteMutator additions:

```ts
export interface DiffRefs { base_sha: string; start_sha: string; head_sha: string }
fetchDiffRefs(projectId: number, mrIid: number): Promise<DiffRefs>;
createPositionedDiscussion(
  projectId: number, mrIid: number, body: string,
  position: { position_type: "text"; new_path: string; new_line: number;
              old_path?: string; old_line?: number } & DiffRefs,
): Promise<CreatedDiscussion>;
```

Daemon command:

```ts
"mr:comment-inline": {
  payload: { repoName: string; iid: number; body: string;
             path: string; line: number; oldPath?: string; oldLine?: number };
  data: { discussionId: string; noteId: number; verified: true };
};
```

Handler (new section in lib/daemon/handlers/discussions.ts, same provider
plumbing as discussions:reply): fetch diff_refs, createPositionedDiscussion,
verify the created note's type by re-reading the discussion (type must be
DiffNote); on a silent general-note degrade, deleteNote and retry ONCE with
corrected position; second failure returns `{ok:false, error}` naming what
GitLab returned. `verified: true` in data is the contract that the check ran.

## C7. mr map (lane L6)

CLI: new tree branch `mr` with leaf `map` (omitBehavior "list").
`rt mr map [--repo <name>] --json` returns
`{"ok":true,"rows":[{ref:"!123", title, sourceBranch, worktree: string|null, mrState, ciStatus: string|null}]}`.
Implementation: project-mrs:read (authors [me]) joined by exact branch
equality to worktree:list rows; no daemon change. MCP tool mr_map projects
it in wave 2.

## C8. rt herd brief (lane L7)

```
rt herd brief --job <name> --template <path> [--strategy <name> --strategies <path>]
              [--method-file <path>] [--fence <path>] [--branch <name>] [--out <path>] --json
```

Pure CLI assembly (no daemon): copies the template verbatim, fills its
slots (job name, question/report pointers, strategies-file absolute paths,
write fence, branch), inserts the strategy body from `--strategies` or the
`--method-file` content as `## Method`. `--out` writes the file and prints
`{"ok":true,"path":...}`. The shepherd passes `--template <CLAUDE_SKILL_DIR>/references/job-template.md`
and `--strategies <CLAUDE_SKILL_DIR>/parts/strategy/references/strategies.md`;
rt never guesses skill paths. Slot names are read from the template's
literal `<angle-bracket>` markers; an unfilled marker in the output is an
error listing the leftovers.

## C9. Subject stamping (lane L8 + BOARD-31)

- Herd spawns (handlers/herd.ts spawn -> agent:start): add
  `subject: herdSubject(herdId, name)` (the existing `herd:<id>/<job>`
  builder) to the agent:start payload so worker panes get RT_GATE_SUBJECT
  and the gate-fork hook.
- Board (BOARD-31, mattstack-apps agent-launch.ts payload): add
  `subject: "mr:" + opts.mrUrl`.
- gate-fork.sh itself is unchanged; L8 also wires build.sh to embed
  scripts/hooks/gate-fork.sh under Contents/Helpers (agent-hooks.ts:13-16
  names the gap).

## C10. Cross-lane rules

- Merge order: L3 -> L2 (both touch packages/rt-client and
  lib/daemon/handlers/gate.ts). All other wave-1 lanes are order-free but
  announce in #rt before merging anything touching
  packages/rt-client/src/commands.ts, lib/module-registry.ts, or
  lib/command-tree-def.ts.
- After ANY rt-client change: `bun run build` in packages/rt-client (the
  dist-freshness test is the guard).
- `bun run test:all` before calling a lane verified (e2e is not in
  `bun run test`).
- No lane touches SCHEMA_VERSION, gates.db schema, or state.db schema.
- rt worktrees per lane via EnterWorktree name-mode; branch = ticket id.
- Skill-file lanes (L1) follow superpowers:writing-skills + the
  mattstack:editing-skills pipeline; no em dashes anywhere.
