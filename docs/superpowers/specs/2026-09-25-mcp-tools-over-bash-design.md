# Skills run on MCP tools, not Bash (RT-326)

## Goal

A teammate installs mattstack on a fresh Mac. Claude Code runs in its
default permission mode, so any shell command it cannot prove safe asks for
a click. They run the normal workflows (work, review, receive-review, ship,
watch-ci, sync-open-mrs, rebase-worktree, shepherdr and its workers) and
see **no permission prompt**. The design is for that worst case. Auto mode
gets the same result for free: no classifier wait on any routine call.

## Why today fails

The skills tell agents to run about 760 shell commands. A shell command runs
unprompted only when it matches an allow rule (`BASE_PERMISSIONS`, or the
loaded skill's `allowed-tools`). Those rules are prefix text matches, and
agents wrap commands (`cd x && ...`, `VAR=$(...)`, pipes, `-C <tree>`), so
about two thirds of the calls miss. Details and row-level data: RT-326 and
`repo-tools/.local-dev/bash-call-audit/`.

## The rule

**If a skill does it as part of its normal flow, it is an MCP tool on the
mattstack server, and it runs unprompted.** The skill's own gates (the
operator's go at ship, the wrap-up form) are the human check. Claude Code's
prompt is left for things no skill routinely does.

The mattstack MCP server is already in `BASE_PERMISSIONS` whole
(`mcp__plugin_mattstack_mattstack`), so a new tool needs no permission
edit. A tool takes structured arguments, so there is nothing to wrap and no
rule to miss.

Three tool shapes, all existing:

- **Daemon tools** call a daemon command through `rtCommand` (the `mr_*`
  pattern). Used where the daemon already owns the work.
- **In-process tools** call rt library code directly inside the MCP server.
  Used for `rt runs`, whose writes are pure SQLite through
  `runWriteVerb`.
- **`rt_verb`** stays for CLI-only verbs; it spawns `rt <verb> --json`.

The server's environment is fixed at session start (the working directory
and `CLAUDE_CODE_SESSION_ID` do not follow `cd`, `EnterWorktree` or
`/clear`). So every tool that depends on a directory or a run takes it as
an argument, never from the server's own environment.

## What rt adds

### 1. Run bookkeeping tools (replaces every `rt runs` write)

`run_start`, `run_stage`, `run_field_set`, `run_field_get`,
`run_decision`, `run_status`, `run_snapshot`, `run_list`.

- In-process over `commands/runs-write.ts`'s `runWriteVerb`, which gains a
  `cwd` parameter in place of `process.cwd()`.
- `run_start` takes the compiled run-start flag string verbatim (the
  `{{run-start.flags}}` fill), plus `skillDir` (the loaded skill's base
  directory), `ticket` and `spawnedBy`. The tool derives the pack root from
  `skillDir` (`realpath(skillDir/../..)`), which replaces the skill's
  `PACK_DIRS="$(cd ... && pwd -P)"` line. The flag string is split on
  whitespace and refused if it holds a quote.
- `run_start` returns `runDb`. Every other run tool takes `runDb`, and the
  skills always pass it. Omitted, the tool falls back to the existing
  resolution (session, then a worktree given as `cwd`). This retires
  `export RT_RUN_DB` and `unset RT_RUN_DB` from every skill.
- `run_stage` takes `action`: `start`, `done`, `fail` (with `reason`,
  `detailPath`) or `redirect` (with `to`, `reason`).
- `run_decision` takes `selection` as JSON (object, array or string), and
  the tool serializes it. This retires the quoted inline JSON.
- `run_list` wraps the daemon's `runs:list` (the Resume step's
  `rt runs --repo <repo> --json`).

### 2. GitLab read tools

`mr_view`, `mr_list`, `mr_threads`, `mr_for_branch`, `mr_job_trace`,
`mr_pipeline`.

- Daemon tools over `project-mrs:read`, `discussions:read` (with
  `refresh: true` running `discussions:refresh` first), `mr:by-branch`,
  `mr:fetch-job-trace` and `mr:fetch-job-detail`.
- Same targeting as the write tools (`lib/mcp/mr-target.ts`): `repoName`
  as identity, path or label, or `mrUrl`.
- Reads that must be live (the CI poll) pass a small `maxAgeMs`; the
  daemon fetches when its copy is older.
- `mr_threads` gives receive-review the thread-fetch step it has never had.

### 3. `mr_merge`

Merges an MR the way `glab mr merge` does today (optional `squash`,
`removeSourceBranch`, `whenPipelineSucceeds`). GitLab still enforces
approvals and pipeline rules. This reverses the AGENTS.md line "Merge, and
anything equally irreversible, stays off the server"; that section is
rewritten to state the rule above.

### 4. Git write tools

`git_commit` and `git_push`. Git reads (`status`, `log`, `diff`, `show`)
already run unprompted in every mode and get no tool.

- `git_commit {tree, message, paths?}`: stages exactly `paths` when given
  (else what is already staged) and commits. No `--amend`, no
  `--no-verify`, no `-c` overrides.
- `git_push {tree, forceWithLease?, setUpstream?}`: pushes the current
  branch to its own upstream (or `origin/<branch>` with `setUpstream`).
  It refuses a detached HEAD, the repo's default branch, and `main` or
  `master`. Force is only ever `--force-with-lease`.
- `branch_sync {tree}`: the `rt sync` flow (fetch, rebase onto the target,
  force-with-lease push) as one call, for rebase-worktree and
  sync-open-mrs.
- `tree` must be a checkout or worktree of a repo registered with rt, the
  same check `mr_upload` makes. Anything else is refused.

### 5. `pack_run` (project tooling)

One tool that runs only commands a pack declares, so `pnpm` checks and the
pack's own scripts stop prompting without any text matching.

- Each pack may ship `pack/commands.jsonc`: a map of command name to
  `{ argv, cwd: "tree" | "pack", args?, timeoutMs? }`. `argv` is an exec
  array, never a shell string. A path in `argv` starting `./` resolves
  against the installed pack root. `args` lists the extra arguments a
  caller may append, each as a fixed value or a pattern.
- `pack_run {pack, command, args?, tree?}` finds the pack in the installed
  plugin cache, checks the arguments against the declaration, and execs
  with no shell. `tree` follows the same registered-repo check as the git
  tools.
- Trust: a teammate already runs this pack's skills and scripts, so a
  command the pack declares carries no trust a skill does not already
  have. Only the installed (versioned) cache copy is read, never a working
  checkout.
- The claimview pack declares its checks (`pnpm type-check:cvi`, lint,
  test, prettier) and scripts (`ci-forge.sh`, `ci-watch.sh`,
  `ci-triage.sh`, `ci-attendant.sh`, `gate-ctx.sh`, `pick-account.py`).

### 6. Herd tools

Shepherd side: `herd_start`, `herd_spawn`, `herd_brief`, `herd_close`,
`herd_status`, `herd_list`, `herd_attend`, `herd_wrap_up`, `herd_resume`.
Worker side: `herd_milestone`, added beside the existing `herd_ask`,
`herd_answer` and `herd_report`.

- Daemon tools where a `herd:*` command exists; `herd_brief` (CLI-only
  assembly) goes through `rt_verb`.
- Herd spawn runs unprompted: the shepherd owns its herd.
- `herd_spawn` gets a timeout sized to a real spawn (minutes), not the
  15s daemon default.

### 7. Scoped process stop

`worktree_stop_holders {repoName, tree}` wraps the daemon's
`worktree:stop-holders`, which ends only processes it ties to that
worktree. It replaces shepherdr wrap-up's `lsof` + `kill` step. There is
no general kill tool.

### 8. Wider `rt_verb`

Every read-only leaf, and every leaf a skill routinely runs, is marked
`agentSafe`, after checking it declares its flags and prints `--json`.
Named now: `runs show`, `runs find`, `gate list`, `gate subscriptions`,
`herd gates`, `events list`, `repos status`, `settings get`,
`settings list`, `settings explain`, `daemon status`, `pane list`,
`pane peek`, `endpoint lookup` (already), `worktree list` (already),
`worktree triage` (already), `worktree provision`,
`worktree await-ready`, `worktree dispose`, `skills check`,
`skills compile`, `skills sync`, `skills bind`, `skills surface`,
`setup status`, `team status`, `git status`, `git log`, `git branches`.
A leaf whose normal run outlasts `RT_VERB_TIMEOUT_MS` declares its own
cap on its tree node.

The `agentSafe` definition in AGENTS.md changes from "writes nothing the
caller does not own" to the rule above.

## What the skills change

All three sources move to the tools:

- mattstack-skills engines and includes (`attachments/`), the
  hand-authored skills (`plugin/skills/`, `skills/`), and the compiled
  shepherdr.
- The claimview pack's own fills and PACK.md, then a recompile.

Plus the fixes the audit found:

- **Cloud lane deleted.** `rt sandbox` does not exist in rt. Delete
  `references/cloud-lane.md` and every mention in shepherdr (source,
  fills, compiled copies).
- **Worker brief.** `job-template.md` stops telling workers to type
  `rt herd ask`; it names the `herd_*` tools.
- **Review gates.** review and receive-review use `gate_ask` instead of
  `rt gate ask --questions "$(jq ...)"`.
- **Existing coverage.** Skills stop shelling out for `rt worktree list`,
  `rt herd status` and `rt endpoint lookup`.
- **Sibling worktree.** checkout's `git worktree add <sibling-path>`
  fallback goes away (rt worktree provision is the path).
- **Doorbell hook.** `herdr-doorbell.sh` gets registered in `hooks.json`,
  or is deleted if nothing needs it.
- **Pasted comments.** extending-a-pack's code blocks lose the trailing
  `# ...` comments.
- **Trust-modal step.** shepherdr's trust-modal step names what to run, or
  is cut.
- **Shell state.** Shell state no longer carries between code blocks
  (`$IID`, `$PACK_DIRS`, `read_token`): each value comes back from a tool
  and is passed on explicitly.

Kept on purpose: `rt gate answer --by shepherd` stays CLI-only, per
shepherdr's existing note. It is the one remaining rt Bash call, and it
runs only in the shepherd pane. GitHub (`gh`) flows are RT-321.

## Order and releases

1. **rt**, in reviewable PRs:
   - (a) runs tools;
   - (b) GitLab read tools and `mr_merge`;
   - (c) git tools and `branch_sync`;
   - (d) herd tools, `worktree_stop_holders` and the wider `rt_verb`;
   - (e) `pack_run`.
   Each is merged, deployed to the dev daemon, and smoke-tested against the
   glance harness project.
2. **mattstack-skills**: rewrite, certify, bump, `rt skills sync --pack
   mattstack`.
3. **claimview pack**: fills, `pack/commands.jsonc`, recompile,
   `rt skills sync --pack claimview`. The pack is employer-visible: no
   mattstack ticket ids in it.
4. **Cleanup**: drop `Bash(rt runs *)`, `Bash(rt gate *)`,
   `Bash(rt skills sync *)` and the three `glab` rules from
   `BASE_PERMISSIONS`. The classifier refuses edits to that list, so Matt
   applies the lines.
5. **Release**: teammates get the tools with the next mattstack.app
   release. The skills and the pack must not reach a teammate before the
   rt that serves their tools; the release carries both.

## Testing

- **Unit.** Each tool gets tests in `lib/mcp/__tests__/` on the existing
  pattern: argument checks, targeting, and daemon error mapping. The git
  and `pack_run` refusals each get a test: default branch, unregistered
  tree, undeclared command, bad argument and shell metacharacters.
- **Smoke.** Every new tool is called once for real against the glance
  harness project, as the `mr_*` tools were.
- **Audit re-run.** The three audit agents run again over the rewritten
  skills and pack. Pass means no rt or glab Bash call remains outside the
  kept list, and no `export`/`unset RT_RUN_DB`.
- **Default-mode run.** One real `work` run and one shepherdr herd on the
  harness repo under a Claude config dir set to default mode, counting
  prompts. Pass means zero, apart from anything the run did outside a
  skill.

## Not in this spec

- GitHub tools (RT-321).
- A gated sibling of `rt_verb` for verbs no skill runs.
- Changing what Claude Code auto-approves on its own (read-only git).
