# MCP MR write tools (RT-315)

## Problem

Board-launched panes (review, respond, doctor) and the pipeline verbs (ship,
watch-ci) write to MRs. Only two of those writes have an MCP tool today
(`mr_comment_inline`, `mr_reply_thread`). Every other write falls back to
improvised shell such as `cd … && glab mr note … -m "$(cat …)" | tail`, which
matches no `Bash(glab *)` allow rule once it is compound. Auto mode then sends
it to the classifier, which blocks it as an external write and does not count
a board gate answer as consent. A review the human already approved on the
board sits unposted until they type approval in the pane.

MCP calls on the mattstack server skip the classifier:
`mcp__plugin_mattstack_mattstack` is in `lib/setup/base-permissions.ts`, so it
is allowed on every estate machine.

## Goal

Every MR write a board pane or pipeline verb performs on GitLab goes through a
named MCP tool, and the skills that perform it name that tool. Success: a
board review whose gate is answered on the board posts end to end (inline
threads, summary, disposition) with no classifier denial and no in-pane
prompt. GitHub reaches the same state in phase 2.

## Non-goals

- **Merge.** It stays outside MCP on purpose, so it keeps the classifier (or a
  human) in front of it.
- **Reads** (`glab mr view`, `mr list`, `api user`). The classifier passes
  them.
- **`rt-release`'s `gh release` / `gh workflow run` steps.** They run in
  Matt's own sessions, not board panes.
- **`glab mr create --fill` parity.** `mr_create` takes an explicit title and
  body; the agent composes them from the branch's commits.
- **Reviewers, assignees, labels on create.** No skill sets them.

## Tool surface

One tool per action, each a thin wrapper over a daemon verb in
`lib/mcp/tools.ts`. A generic `mr_action` tool was rejected: merge would be one
argument away and skills could not cite a specific action. `rt_verb` leaves
were rejected: `agentSafe` is reserved for verbs that write only what the
calling agent already owns.

Every tool takes `repoName` (the serialized identity, same as the existing mr
tools) and, except `mr_create`, `iid`.

| Tool | Daemon verb | Extra input | Result body |
|---|---|---|---|
| `mr_comment` | new `mr:comment` | `body`, `resolvable?` (default `true`) | `{noteId, discussionId, resolvable, url, mrUrl}` |
| `mr_approve` | `mr:action` approve / unapprove | `approved?` (default `true`) | `{approved}` |
| `mr_resolve_thread` | `discussions:resolve` | `discussionId`, `resolved?` (default `true`) | `{discussionId, resolved}` |
| `mr_ready` | `mr:action` toggleDraft | `ready?` (default `true`) | `{ready}` |
| `mr_retry` | `mr:action` retryJob / retryPipeline | exactly one of `jobId`, `pipelineId` | `{jobId}` or `{pipelineId}` |
| `mr_rebase` | `mr:action` rebase | none | `{rebased: true}` |
| `mr_create` | new `mr:create` | `sourceBranch`, `targetBranch`, `title`, `description?`, `draft?` (default `true`) | `{iid, url}` |

Per-tool notes:

- **`mr_comment`.** `resolvable: true` creates a new discussion
  (`NoteMutator.createDiscussion`), which a human can resolve. `false` creates
  a plain note (`createNote`). `url` anchors the note
  (`<mrUrl>#note_<noteId>`). `mrUrl` is
  `<provider baseURL>/<projectPath>/-/merge_requests/<iid>`. `discussionId` is
  null for a plain note.
- **`mr_ready`.** `ready: true` sends `toggleDraft` with `draft: false`.
- **`mr_retry`.** Passing both ids, or neither, is an input error. `iid` is
  still required because `mr:action` refreshes the MR after the retry.
- **`mr_create`.** `targetBranch` is required, not defaulted: the skill reads
  the default branch from git (`refs/remotes/origin/HEAD`), so the daemon
  never guesses. The source branch must already be pushed.

Descriptions state the forge in phase 1 ("GitLab only") the way
`mr_comment_inline`'s does.

## Daemon

Two new verbs. Everything else reuses verbs that already exist.

- **`mr:comment`** in `lib/daemon/handlers/discussions.ts`, next to
  `mr:comment-inline`. It reuses the `DiscussionHandlerSeams` (`repoContext`,
  `gitlabToken`, `mutator`, `refresh`), with `CommentInlineMutator` widened to
  include `createDiscussion` and `createNote`. It validates a non-blank body,
  posts once, then awaits a discussions refresh whose failure is logged at
  `warn` and never turns a landed post into `ok: false`. This is the same
  rule `mr:comment-inline` follows, for the same reason: a failure there
  invites a retry that duplicates the comment.
- **`mr:create`** in `lib/daemon/handlers/mr.ts`. It calls
  `provider.createPullRequest` through the existing `getContext` override
  seam, then `applyMRWriteback` with the returned PR so the board sees the new
  MR without waiting for a sweep. It uses the same `decodeIndexedRepo` guard
  as `mr:action`. glance reads a created MR back and can throw
  `ReadBackFailedError` with `writeApplied` after the MR exists; that case
  returns `ok` with the error's `iid` and a null `url`, never `ok: false`,
  which would invite a duplicate create.
- Both are added to rt-client's `Commands`, `COMMAND_NAMES`, and
  `lib/daemon/__tests__/rt-client-commands.test.ts`. `packages/rt-client`
  gets a `bun run build`, and `dist-freshness` guards that.

Shared tool behavior:

- **One timeout for every write tool.** They share `MR_WRITE_TIMEOUT_MS`
  (30s). The comment above it is updated to cover the whole family.
- **No retries.** No tool retries on its own. A timeout error from
  `mr_comment` or `mr_create` says the write may still land and names how to
  check (the MR's discussions, or `mr_map`) before trying again.
- **Compact results.** `mr:action` replies with a flat `{ok: true}` and
  `discussions:resolve` returns the whole discussions list, so each tool
  builds its own small result body. `mr_reply_thread` keeps its current body;
  changing it is out of scope.
- **Error mapping.** Errors pass through `fromResponse`, so `explainError`
  applies. `mr:action`'s `repo-unknown` reaches the caller as prose.

## Skill changes

Each changed skill names the tool on GitLab and keeps its current `gh` line on
GitHub until phase 2. Edits go through `mattstack:editing-skills` and
`superpowers:writing-skills` (RED baseline, then GREEN).

**mattstack-skills**

- `attachments/review/review/SKILL.md`, the "Posting mechanics" line. The
  summary is one `mr_comment`. review-posting keeps an unanchored selected
  finding in the summary's issue list and nowhere else, so the summary is
  what carries it. A summary with such a finding posts resolvable (the
  default), so the author can resolve it once addressed. A summary with none
  posts `resolvable: false`. The Approve disposition is `mr_approve`, after
  the findings post.
- `attachments/review-posting/SKILL.md`, the Close HARD-GATE. It also accepts
  the `mrUrl` a tool returned as "read from the forge", so closing needs no
  extra `glab mr view`.
- `attachments/review/receive-review/SKILL.md`. "Posting mechanics belong to
  the forge CLI and the adapter" becomes: on GitLab, replies are
  `mr_reply_thread`, resolves are `mr_resolve_thread`.
- `attachments/pipeline/ship/SKILL.md` and `stage-ship/SKILL.md`: `mr_create`
  on the generic path, `mr_ready` for Mark ready.
- `attachments/pipeline/watch-ci/SKILL.md` and `stage-watch-ci/SKILL.md`:
  `mr_ready` for mark-ready, and `mr_retry` with the job id triage printed for
  the Retry answer. `ci-triage.sh` and the `ci-forge-gitlab` adapter's
  `retry-job` stay unchanged, because the ci-forge@1 contract is shared: the
  skill text is what routes a GitLab retry to the tool.

**mattstack-apps**

- `apps/board/skills/doctor/SKILL.md`. The generic path ("retry obviously-flaky
  pipelines", "attempt a mechanical rebase") and the API tier's allowed
  mutations name `mr_retry` and `mr_rebase`. Board wrapper skills are
  symlinked, so deploying them is a merge plus a pull in mattstack-apps.

Team-pack domain skills (a `slot-doctor-api` filler, for example) are not
edited here. Pack authors adopt the tools on their own schedule. Compiled
packs pick up engine changes on their next compile, since compile vendors
from the installed plugin.

## Guardrails

- Merge is excluded (see Non-goals).
- AGENTS.md, "Gates and the `rt_verb` MCP tool", gains one rule. Every
  `mr_*` tool is a classifier bypass on every estate machine, because the
  server is in `BASE_PERMISSIONS`, so adding one is a permission grant. Merge
  and anything equally irreversible stay out.
- `website/docs/guides/mcp.mdx` lists the new tools, plus the phase 1
  forge note.

## Testing and verification

- **Unit, tools.** `lib/mcp/__tests__/tools.test.ts` gets the roster `NAMES`
  plus, per tool: required-field validation, schema forbids extras, the
  payload it sends (the `mr:action` name and args, the defaults for
  `resolvable`, `approved`, `resolved`, `ready`, `draft`), the
  `jobId`/`pipelineId` exclusivity, and the compact result.
- **Unit, handlers.** Handler tests for `mr:comment` (both resolvable paths,
  blank body, refresh failure still `ok`, URL shape) and `mr:create`
  (write-back called, `repo-unknown`), through the existing seams.
- **Suites.** `e2e/tests/mcp-serve.test.ts`'s `EXPECTED_TOOL_NAMES` roster is
  updated. `bun run test:all`, plus `bun run picker:check`, which is
  unaffected but cheap.
- **Pre-merge API smoke.** A scratch script (not committed) drives the new
  handlers through their seams with real credentials against a GitLab test MR
  in the harness test project. It proves the `resolvable` split and the URL
  shape on real GitLab. It never touches an employer project, and it never
  starts a second daemon.
- **Post-merge acceptance.** Once the dev checkout is synced and the daemon
  restarted, each tool is called once from a fresh Claude session against
  that test MR. Then a board review of a GitLab MR is answered on the board
  and posts with no classifier denial and no in-pane prompt (RT-315
  acceptance).

## Rollout

1. **rt PR.** Tools, verbs, rt-client, docs, AGENTS.md. Wait for CodeRabbit
   and green CI, then merge on Matt's confirmation.
2. **Dev machine.** Check the main checkout's branch, pull, rebuild rt-client
   `dist`, restart the daemon. New Claude sessions spawn the MCP server with
   the new tools.
3. **Skills PRs** (mattstack-skills, mattstack-apps). These merge after step
   2 on the dev machine. The mattstack-skills plugin publishes to teammates
   only in or after an rt release that carries the tools, because a skill
   naming a missing tool strands the pane.
4. **Acceptance run** (above), then RT-315 closes.

## Phase 2: GitHub

A second PR, planned separately once phase 1 lands. Today every daemon MR
write resolves its provider through `getRepoContext` in
`lib/daemon/freshness.ts`, which builds only a `GitLabProvider` from
`gitlabToken`. glance's `GitHubProvider` already implements approve, unapprove,
draft toggle, job and pipeline retry, thread resolve, create, and
`restRequest`. `lib/enrich.ts` already builds one per call.

- **Forge router.** A daemon-side resolver maps a repo identity to either the
  existing GitLab context or a `GitHubProvider` built from `githubToken` and
  the `owner/repo` path. The write verbs call it instead of `getRepoContext`.
  GitHub write-back is skipped wherever the daemon holds no GitHub PR state.
- **Per verb:**
  - `mr:action`: approve, unapprove, toggleDraft and retries work on GitHub.
    `rebase` returns an explicit "not supported on GitHub".
  - `mr:create` works as is through the provider.
  - `mr:comment` posts a PR conversation comment. GitHub has no resolvable
    top-level comment, so an explicit `resolvable: true` is refused, an
    omitted one posts plain, and the result reports `resolvable: false`.
- **Threads.** `discussions:resolve`, `discussions:reply` and
  `mr:comment-inline` need GitHub thread ids, which means `discussions:read`
  must cover GitHub PR review threads first. The reply and inline paths map
  to the review-comment reply and create endpoints.
- **Request changes.** review-posting executes Request changes on `gh`, so
  phase 2 also needs a tool for it (`mr_request_changes`, or an `event`
  input on `mr_approve`; decided in phase 2's plan).
- **Skills.** Each skill drops its `gh pr review`, `gh pr comment`,
  `gh pr ready`, `gh pr create` and `gh run rerun` write lines in favor of the
  tools.
