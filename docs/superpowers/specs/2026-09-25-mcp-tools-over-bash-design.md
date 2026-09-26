# Skills run on MCP tools, not Bash (RT-326)

## Goal

A teammate runs mattstack in Claude Code's auto mode (setup seeds it).
Every call no allow rule covers waits on the auto-mode classifier: seconds
each, and it blocks some outright (git pushes, merges, fast-forwards and
rebases most often). They run the normal workflows (work, review,
receive-review, ship, watch-ci, sync-open-mrs, rebase-worktree, shepherdr
and its workers) and **no routine rt, forge or git-write call waits on the
classifier, and entering or leaving an rt worktree asks nothing**.

Default permission mode (a click per call) is out of scope.

## Why today fails

The skills tell agents to run about 760 shell commands. A shell command
skips the classifier only when it matches an allow rule (`BASE_PERMISSIONS`,
or the loaded skill's `allowed-tools`). Those rules are prefix text
matches, and agents wrap commands (`cd x && ...`, `VAR=$(...)`, pipes,
`-C <tree>`), so about two thirds of the calls miss. A headless probe
added two more:

- **`$(...)` is never covered.** Claude Code cannot statically analyze a
  command substitution, so `IID=$(glab ...)` is judged whatever the rules
  say.
- **Rules arrive only with Install.** A `BASE_PERMISSIONS` rule reaches a
  machine only when Install runs, so a machine installed before a rule was
  added never gets it (this Mac lacks `Bash(glab *)`, `Bash(rt runs *)`
  and `Bash(rt gate *)`). A tool on the allowed server arrives with rt
  itself.

Separately, `EnterWorktree` and `ExitWorktree` into an rt pool tree raise
Claude Code's "permission-root relocation" dialog. Per the Claude Code docs,
no allow rule, setting or hook suppresses it (only `bypassPermissions`
does), and it fires for any target outside the repo's `.claude/worktrees/`,
which every rt pool tree is.

Row-level audit data: RT-326 and `repo-tools/.local-dev/bash-call-audit/`.

## The rule

**If a skill does it as part of its normal flow and it is an rt call, a
forge call or a git write the classifier blocks, it is an MCP tool on the
mattstack server.** The server is already allowed whole in
`BASE_PERMISSIONS` (`mcp__plugin_mattstack_mattstack`), so a new tool
needs no permission edit, and structured arguments leave nothing to wrap.
The skill's own gates (the operator's go at ship, the wrap-up form) stay
the human check. The classifier is left for project tooling, `git commit`
and `git add`, and anything no skill routinely does.

Three tool shapes, all existing:

- **Daemon tools** call a daemon command through `rtCommand` (the `mr_*`
  pattern).
- **In-process tools** call rt library code inside the MCP server (used for
  `rt runs`, whose writes are pure SQLite through `runWriteVerb`, and for
  the git tools).
- **`rt_verb`** runs CLI-only verbs as `rt <verb> --json`.

The server's environment is fixed at session start: its working directory
and `CLAUDE_CODE_SESSION_ID` do not follow `cd`, `EnterWorktree` or
`/clear`. So every tool that depends on a directory or a run takes it as an
argument.

## New tools (32)

### Run tracking (replaces `rt runs ...`)

`run_start`, `run_stage`, `run_field_set`, `run_field_get`,
`run_decision`, `run_status`, `run_snapshot`, `run_list`.

- In-process over `commands/runs-write.ts`'s `runWriteVerb`, which gains a
  `cwd` parameter in place of `process.cwd()`.
- `run_start` takes the compiled run-start flag string verbatim (the
  `{{run-start.flags}}` fill), plus `skillDir` (the loaded skill's base
  directory), `ticket` and `spawnedBy`. The tool derives the pack root as
  `realpath(skillDir/../..)`, replacing the skill's
  `PACK_DIRS="$(cd ... && pwd -P)"` line. The flag string is split on
  whitespace and refused if it holds a quote.
- `run_start` returns `runDb`. Every other run tool takes `runDb`, and the
  skills always pass it. Omitted, the tool falls back to the existing
  resolution (session, then a worktree given as `cwd`). This retires
  `export RT_RUN_DB` and `unset RT_RUN_DB`.
- `run_stage` takes `action`: `start`, `done`, `fail` (with `reason`,
  `detailPath`) or `redirect` (with `to`, `reason`).
- `run_decision` takes `selection` as JSON and serializes it itself.
- `run_list` wraps the daemon's `runs:list` (the Resume step).

### GitLab reads (replaces `glab mr view/list`, `glab api`)

`mr_view`, `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`,
`mr_job_trace`.

- Daemon tools over `project-mrs:read`, `mr:by-branch`,
  `discussions:read` (with `refresh: true` running `discussions:refresh`
  first), `mr:fetch-job-detail` and `mr:fetch-job-trace`.
- Same targeting as the write tools (`lib/mcp/mr-target.ts`).
- A live read (the CI poll) passes a small `maxAgeMs`.
- `mr_threads` gives receive-review the thread-fetch step it never had.

### Merge

`mr_merge`: merges an MR as `glab mr merge` does (optional `squash`,
`removeSourceBranch`, `whenPipelineSucceeds`). GitLab still enforces
approvals and pipeline rules. This reverses the AGENTS.md line "Merge, and
anything equally irreversible, stays off the server"; that section is
rewritten to state the rule above.

### Git writes

In-process, each on a `tree` that must be a checkout or worktree of a repo
registered with rt (the check `mr_upload` makes).

- `git_push {tree, forceWithLease?, setUpstream?}`: pushes the current
  branch to its upstream (or `origin/<branch>` with `setUpstream`). Force
  is only ever `--force-with-lease`. It refuses a detached HEAD, the repo's
  default branch, `main` and `master`.
- `git_pull {tree}`: fast-forward only (`--ff-only`); a diverged branch is
  an error, never a merge or rebase.
- `git_rebase {tree, onto | abort}`: rebases the current branch onto a
  named branch; on a conflict it stops and returns the conflicted files,
  leaving the tree mid-rebase for the agent to resolve; `abort: true`
  aborts one in progress.
- `branch_sync {tree}`: the `rt sync` flow (fetch, rebase onto the target,
  force-with-lease push) in one call, for rebase-worktree and
  sync-open-mrs.

`git commit` and `git add` stay on Bash; the classifier approves them.
Git reads need nothing.

### Worktrees

- `worktree_provision`: claims a tree for a ticket or branch (on-deck pool
  or fresh), returns its path. The agent then enters it with
  `EnterWorktree` path mode.
- `worktree_dispose`: disposes a tree the session is not in (wrap-up,
  triage); it goes to the restorable trash.
- `worktree_stop_holders {repoName, tree}`: wraps the daemon's
  `worktree:stop-holders`, which ends only processes it ties to that tree.
  It replaces shepherdr wrap-up's `lsof` + `kill` step. There is no general
  kill tool.

### Herd

Shepherd side: `herd_start`, `herd_spawn`, `herd_brief`, `herd_close`,
`herd_status`, `herd_list`, `herd_attend`, `herd_wrap_up`, `herd_resume`.
Worker side: `herd_milestone`, beside the existing `herd_ask`,
`herd_answer` and `herd_report`.

- Daemon tools where a `herd:*` command exists; `herd_brief` (CLI-only
  assembly) goes through `rt_verb`.
- `herd_spawn` runs with no check: the shepherd owns its herd. Its timeout
  is sized to a real spawn (minutes).

## Wider `rt_verb`

These leaves get `agentSafe`, after checking each declares its flags and
prints `--json`:

- **Reads:** `runs show`, `runs find`, `gate list`, `gate subscriptions`,
  `herd gates`, `events list`, `repos status`, `settings get`,
  `settings list`, `settings explain`, `daemon status`, `pane list`,
  `pane peek`, `setup status`, `team status`, `git status`, `git log`,
  `git branches`.
- **Routine writes:** `worktree await-ready`, `skills check`,
  `skills compile`, `skills sync`, `skills bind`, `skills surface`.

A leaf whose normal run outlasts `RT_VERB_TIMEOUT_MS` declares its own cap
on its tree node. AGENTS.md's `agentSafe` definition changes from "writes
nothing the caller does not own" to the rule above.

## Worktree relocation dialog

rt already auto-accepts the relocation dialog for unattended panes
(`lib/daemon/trust-dialog.ts`, RT-200, RT-257), parsing it from real
captured screens with the spoof fixtures. That widens to attended herdr
panes, scoped to rt's own trees:

- A `PreToolUse` hook on `EnterWorktree` and `ExitWorktree` tells the
  daemon "this pane is about to relocate to <path>".
- The daemon accepts only when that path is a worktree in rt's registry
  (or, for `ExitWorktree`, the session's recorded original directory), and
  only for a dialog that appears on that pane within a few seconds and
  whose parsed target matches the announced path.
- Any other relocation still waits for the person.
- Outside herdr (a plain terminal) nothing changes.

The trust-dialog rules in AGENTS.md apply unchanged: every fixture is a
captured screen, and the Bash-spoof, MCP-spoof and painted-dialog fixtures
keep passing.

## What the skills change

All three sources move to the tools:

- mattstack-skills engines and includes (`attachments/`), hand-authored
  skills (`plugin/skills/`, `skills/`) and the compiled shepherdr;
- the claimview pack's own fills and PACK.md, then a recompile.

Plus the fixes the audit found:

- **Cloud lane deleted.** rt has no `sandbox` command. Delete
  `references/cloud-lane.md` and every mention in shepherdr (source, fills,
  compiled copies).
- **Worker brief.** `job-template.md` names the `herd_*` tools instead of
  telling workers to type `rt herd ask`.
- **Review gates.** review and receive-review use `gate_ask` instead of
  `rt gate ask --questions "$(jq ...)"`.
- **Existing coverage.** Skills stop shelling out for `rt worktree list`,
  `rt herd status` and `rt endpoint lookup`.
- **Sibling worktree.** checkout's `git worktree add <sibling-path>`
  fallback goes; `worktree_provision` is the path.
- **Doorbell hook.** `herdr-doorbell.sh` gets registered in `hooks.json`,
  or is deleted if nothing needs it.
- **Pasted comments.** extending-a-pack's code blocks lose their trailing
  `# ...` comments.
- **Trust-modal step.** shepherdr's trust-modal step names what to run, or
  is cut.
- **Shell state.** Nothing relies on shell state carrying between code
  blocks (`$IID`, `$PACK_DIRS`, `read_token`): each value comes back from a
  tool and is passed on explicitly.

Kept on Bash on purpose:

- `rt gate answer --by shepherd` (CLI-only per shepherdr's note; shepherd
  pane only).
- Long waits under `Monitor` (`rt chat tail`, `rt gate wait`,
  `rt events wait`), which block past any tool timeout.
- Project tooling (`pnpm` checks, the pack's scripts), `git commit`,
  `git add`.
- GitHub (`gh`) flows (RT-321).

## Order and releases

1. **rt**, in reviewable PRs, each merged, deployed to the dev daemon and
   smoke-tested on the glance harness project:
   - (a) run tools;
   - (b) GitLab reads and `mr_merge`;
   - (c) git tools;
   - (d) worktree and herd tools, and the wider `rt_verb`;
   - (e) the relocation auto-accept.
2. **mattstack-skills**: rewrite, certify, bump, `rt skills sync --pack
   mattstack`.
3. **claimview pack**: fills, recompile, `rt skills sync --pack
   claimview`. The pack is employer-visible: no mattstack ticket ids in it.
4. **Cleanup**: drop `Bash(rt runs *)`, `Bash(rt gate *)`,
   `Bash(rt skills sync *)` and the three `glab` rules from
   `BASE_PERMISSIONS`, and update AGENTS.md ("Gates and the `rt_verb` MCP
   tool", the relocation parser section) and the rt.cool MCP docs page. The
   classifier refuses edits to `BASE_PERMISSIONS`, so Matt applies those
   lines.
5. **Release**: teammates get it all in the next mattstack.app release.
   Skills and the pack must not reach a teammate before the rt that serves
   their tools; the release carries both.

## Testing

- **Unit.** Each tool gets tests in `lib/mcp/__tests__/` on the existing
  pattern: argument checks, targeting, daemon error mapping. Every git-tool
  refusal gets its own test:
  - push to the default branch, `main` or `master`;
  - a detached HEAD;
  - an unregistered tree;
  - a pull on a diverged branch;
  - a rebase conflict, which returns its files.
- **Relocation.** Hook-to-daemon tests: the dialog is accepted for a
  registered tree, left alone for an unregistered path, and left alone for
  a dialog whose target differs from the announced path. Captured-screen
  fixtures for attended panes.
- **Smoke.** Every new tool is called once for real against the glance
  harness project.
- **Audit re-run.** The three audit agents run again over the rewritten
  skills and pack. Pass means no rt, glab or git-write Bash call remains
  outside the kept list, and no `export` or `unset RT_RUN_DB`.
- **Auto-mode run.** One real `work` run and one shepherdr herd on the
  harness repo, including an EnterWorktree and ExitWorktree. Pass means
  every rt, forge and git-write call went through a tool, and the
  relocation dialog never waited on the person.

## Not in this spec

- GitHub tools (RT-321).
- Default permission mode: file edits, reads outside the project and other
  MCP servers all prompt there.
- `pack_run`, a tool running only commands a pack declares, for `pnpm`
  checks and pack scripts.
- `git_commit` / `git_add` tools.
- A gated sibling of `rt_verb` for verbs no skill runs.
