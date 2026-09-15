# Gate seam and mattstack MCP: epic design

Date: 2026-09-14
Status: approved (brainstorm with Matt, this date)
Evidence base: `.local-dev/briefs/mcp-surface-findings.md` (the full-estate
skill/mechanism inventory this design acts on; read it for every file:line
citation behind the claims here)

## Problem

The estate's agent-facing invocation discipline is concentrated in one
cluster and duplicated heavily: the gate protocol is inlined verbatim 13
times in the claimview pack (~30% of the pack's words), the three board
wrapper skills restate ~3,200 words of near-identical gate mechanics, and
the presentation rule (form vs wait) has three divergent implementations
(gate-protocol prose, board `verbs.ts`, `herd:ask`). The answer-side
invariants are already mechanized everywhere except the agent's own
invocation surface. Two satellite clusters (chat posting, GitLab MR
threads) carry the same class of shell-crossing discipline prose.

## Architecture

One new daemon command, `gate:ask`, owns the gate-opening ceremony. The
caller supplies only questions, optional context, and identity facts it
alone knows (sessionId, paneId, optional explicit subject/kind). The daemon
derives:

- subject: explicit wins; else sessionId resolves to its running run
  (`run:<id>`, the same lookup `lib/runs/resolve-db.ts` uses); else the
  session's agent record (`agent:<id>`); else a loud error
- presentation, by the ONE rule: `form` iff paneId AND sessionId AND every
  question has <= 4 options, else `wait`
- nudge (auto-supplied from sessionId on form presentation), origin, and
  the context byte-cap branch (omit context over 8192 bytes, never trim)

`gate:open` stays as the raw primitive underneath. `herd:ask` switches onto
the shared presentation helper (behavior change: a worker question with
more than 4 options now takes the wait path instead of a form the shepherd
cannot render). Response shape: `{id, presentation, subject, supersededId}`.

Three thin projections, zero rule copies:

1. `rt gate ask` (CLI) for bash, scripts, and skills
2. `gate_ask` in the new MCP server for tool-native sessions
3. the board status-bin's `gate open` verb, rebased to call `gate:ask`
   (board-db bookkeeping stays in the status-bin; `presentationFor` and
   `FORM_OPTION_CAP` in `apps/board/src/gates/verbs.ts` are deleted)

Answer-shape validation gets one canonical home in rt-client; the daemon's
`validateAnswers` and gate-kit's `gateAnswerPayload` both consume it.

The MCP server is `rt mcp serve` (stdio), declared by the mattstack
plugin. Verified 2026-09-14: a plugin stdio MCP server inherits
CLAUDE_CODE_SESSION_ID, HERDR_ENV, HERDR_PANE_ID, HERDR_WORKSPACE_ID (and,
on rt-agent-launched sessions, RT_GATE_SUBJECT / RT_DAEMON_SOCK). It does
NOT see RT_RUN_DB (exported per bash call) and its cwd freezes at session
start, so session-id resolution is the primitive, never cwd. Plugin caches
are cswap-shared, so worker panes get the server. MCP tools defer in the
tool list (name-only until loaded), so resident context cost is one line
per tool.

Tool roster: gate_ask, gate_answer, gate_list; chat_post, chat_dm,
chat_ack, chat_claim; mr_reply_thread, mr_comment_inline; herd_gates,
herd_ask, herd_answer, herd_report; mr_map.

`gate wait` stays CLI in every context: the park-and-be-reinvoked contract
(background bash task completion re-invokes the pane) is harness-level and
a synchronous tool call cannot express it.

## Phases

### Phase 0: quick wins (mattstack-skills, independent of all code)

- cswap-accounts: replace the stale Quirk section ("share settings and
  skills but not plugin caches") with the true fact: plugins ARE shared
  (claude-swap session.py SHARED_ITEMS); missing-plugin symptoms are real
  and worth chasing.
- The six engines' resume recipe: replace the manual
  `~/.mattstack/runs/<repo>/` directory walk with
  `rt runs --repo <name> --json` plus a work_type/status filter sentence.
- Collapse the sixteen "each tool call is a fresh shell: prefix every rt
  runs command with RT_RUN_DB" sentences to one line about resolveRunDb's
  automatic session resolution; keep the export only for driving a
  different run.
- Ships via the editing-skills pipeline: certify, bump, sync, recompile
  claimview and mattstack packs.

### Phase 1: the seam (repo-tools)

- rt-client: canonical answer-shape module; new `gate:ask` entry in the
  Commands map and COMMAND_NAMES. No gates.db schema change, so no
  SCHEMA_VERSION coordination.
- daemon: `gate:ask` handler per the architecture above; shared
  presentation helper; `herd:ask` rebased onto it.
- rt-client version bump, published from main only; consumers refresh
  their file-dep copies.

### Phase 2: projections

- `rt gate ask` CLI: reads HERDR_PANE_ID / CLAUDE_CODE_SESSION_ID, passes
  facts, `--json`, non-TTY safe, picker-conformance exempt (agent-facing).
- `rt mcp serve`: new command module (module-registry entry; lazy imports
  per the startup bench gate), stdio MCP over the typed Commands map.
- mattstack plugin declares the server (`command: rt`, `args: [mcp,
  serve]`).
- gate-fork hook coverage extension: board- and shepherd-launched panes
  also get RT_GATE_SUBJECT stamped and the hook injected.

### Phase 3: satellites

- chat tools: handle resolved from the session file by session id; body as
  a typed param (kills the heredoc/backtick/--as-is class).
- mr_reply_thread projects `discussions:reply`. mr_comment_inline is a NEW
  daemon command via glance: fetch diff_refs, POST positioned discussion,
  verify the response type is DiffNote, delete and re-post on silent
  degrade. The retry loop lives in code.
- `mr map`: open MRs joined to local worktrees from project-mrs:read plus
  worktree:list (which already attaches `mr` per tree).
- `rt herd brief`: assemble a job brief from job-template.md, the strategy
  body, and fills; replaces the two-verbatim-copies discipline.
- herd_gates / herd_ask / herd_answer / herd_report tools: verbatim
  projections.

### Phase 4: skill consumers

- gate-protocol rewritten around `rt gate ask` / gate_ask: the Publish,
  Presentation, option-membership, and Runs-integration recipe sections
  (~1,500 of 2,474 words) collapse; doorbell semantics, closed-gate
  policy, and fallback judgment stay.
- rt-chat posting section trimmed onto the chat tools; channel/wake/claim
  etiquette stays.
- gitlab-mr-threads absorbed into the MR tools' descriptions and deleted.
- shepherdr: the "exactly `rt herd gates --json`" block trimmed to name
  the tool; brief-assembly section rewritten onto `rt herd brief`; the
  bare-form red flag notes the gate-fork hook.
- Both packs recompiled and synced.

### Phase 5: board convergence (mattstack-apps)

- status-bin `gate open` calls daemon `gate:ask`; verbs.ts presentation
  logic deleted; bookkeeping (state rows, report ingest) unchanged.
- The three wrappers' duplicated form/wait/CAS blocks collapse to short
  shared references.
- Board vitest suites updated.

## Parallel lanes (approved swarm structure)

Wave 1, independent:

| Lane | Work | Repo |
|---|---|---|
| L1 | Phase 0 skill fixes | mattstack-skills |
| L2 | gate:ask handler + presentation helper + herd:ask change | repo-tools |
| L3 | answer-shape canonicalization into rt-client | repo-tools |
| L4 | rt mcp serve scaffold + tools over existing commands + plugin wiring | repo-tools + mattstack-skills |
| L5 | mr:comment-inline daemon command | repo-tools |
| L6 | mr map verb | repo-tools |
| L7 | rt herd brief | repo-tools + shepherdr engine |
| L8 | gate-fork hook coverage extension | repo-tools |

Wave 2, after L2+L3 merge and a daemon restart: L9 `rt gate ask` CLI; L10
gate_ask tool into the L4 server; L11 board convergence.

Wave 3, as each mechanism goes live: L12 gate-protocol rewrite +
recompiles (needs L9/L10); L13 rt-chat trim (needs L4 live); L14
gitlab-mr-threads absorption (needs L5); L15 board wrapper skill text
(needs L11).

Merge-collision surfaces, managed by sequencing: L2/L3 both touch
rt-client and handlers/gate.ts (merge L3 first). commands.ts /
COMMAND_NAMES / module-registry get trivial conflicts across L2/L4/L5/L6;
announce before merge per repo convention. SCHEMA_VERSION untouched by
every lane.

## Testing

- Unit: gate:ask handler (resolution ladder, presentation rule, refusals),
  presentation helper (shared by herd:ask), answer-shape module.
- e2e (repo-tools e2e suite, which `bun run test` does NOT run; use
  `bun run test:all`): `rt gate ask` JSON envelope; MCP server spawn +
  tools/list + a gate_ask round trip against a test daemon under isolated
  HOME.
- Skill changes: certify per edited file; full recompile check; the
  compiled outputs read in full per the editing-skills validation rule.
- Board: existing vitest suites plus a presentation-parity test asserting
  the CLI-visible behavior did not change.

## Operational risks

- A merged daemon verb is not live until a daemon restart.
- Plugin MCP wiring needs session restarts to take effect.
- rt-client dist/ staleness in file-dep consumers after every rt-client
  change; run its build and the freshness test.
- rt-client publishes are release-class: from main only, announced.
- The herd:ask cap change alters live shepherd behavior; announce in #rt
  before the daemon restart that makes it live.

## Out of scope

- Any tool for `gate wait` or the runs verbs (deliberate; see findings
  section 4).
- Moving the ci scripts or attendant lease into the daemon (teammates
  without rt depend on the script form).
- Judgment prose (review cluster, tiering, domain skills) stays prose.
