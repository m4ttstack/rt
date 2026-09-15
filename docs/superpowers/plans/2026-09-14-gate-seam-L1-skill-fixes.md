# L1: phase-0 skill fixes (SKILLS-65)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This lane edits SKILLS, so each task ALSO requires superpowers:writing-skills (baseline, edit, certify) and ships via the mattstack:editing-skills pipeline.

**Goal:** Delete the three classes of stale/redundant prose the inventory registered: the false cswap plugin-cache line, the manual runs-directory resume walk, and the sixteen RT_RUN_DB fresh-shell sentences.

**Architecture:** Text-only edits in ~/Documents/GitHub/mattstack-skills, recompiled into both packs via rt skills sync. No code changes anywhere.

**Tech Stack:** mattstack-skills checkout; `sh tests/certify.sh`; `rt skills sync --pack mattstack` and `--pack claimview`.

**Spec:** `docs/superpowers/specs/2026-09-14-gate-seam-mcp-epic-design.md` (Phase 0)

## Global Constraints

- No em dashes or en dashes in any text written.
- Facts only: the replacement sentences below are pre-verified against code (claude-swap session.py:84-92; repo-tools commands/runs.ts:164-178; commands/runs-write.ts:191-204; lib/runs/resolve-db.ts:66-77). Do not re-derive or embellish them.
- Engine edits require the mattstack plugin version bump in the SAME commit (editing-skills pipeline), then `rt skills sync --pack mattstack` and `rt skills sync --pack claimview`, then reading the compiled outputs IN FULL.
- The mattstack-skills checkout must be clean and on main before sync.

---

### Task 1: cswap-accounts stale Quirk

**Files:**
- Modify: `~/Documents/GitHub/mattstack-skills/attachments/cswap-accounts/SKILL.md:71-74` (the `## Quirk` section)

- [ ] **Step 1 (writing-skills baseline):** note the current section text as the RED state.
- [ ] **Step 2: Replace the section** with:

```markdown
## Quirk

cswap sessions share plugins along with settings and skills (the plugin
cache is a shared symlink), so a worker pane missing a plugin's tools is a
real failure: check the pane's plugin list and the shared cache instead of
dismissing it.
```

- [ ] **Step 3:** `sh tests/certify.sh attachments/cswap-accounts` (from the mattstack-skills root). Expected: pass.
- [ ] **Step 4: Commit** (mattstack-skills): `cswap-accounts: plugins ARE shared; missing-plugin symptoms are real`.

### Task 2: the seven resume recipes

**Files:**
- Modify (same block in each, the `## Run` resume paragraph): `attachments/pipeline/work/SKILL.md`, `attachments/pipeline/ship/SKILL.md`, `attachments/pipeline/watch-ci/SKILL.md`, `attachments/forge/sync-open-mrs/SKILL.md`, `attachments/review/review/SKILL.md`, `attachments/review/self-review/SKILL.md`, `attachments/review/receive-review/SKILL.md`

- [ ] **Step 1:** In each file, replace the sentence span
`list ~/.mattstack/runs/<repo>/ (the --repo value ...) for runs whose snapshot shows run.status = running and run.work_type = <verb> (read each with RT_RUN_DB pointed at its state.db; never raw sqlite)`
(wording varies slightly per file; match each file's actual text) with:

```markdown
run `rt runs --repo <repo> --json` (the `--repo` value in the flags block
below) and keep the runs whose `status` is `running` and `work_type` is
`<verb>`; never read the run dbs by hand
```

where `<verb>` stays each file's own work type (work keeps its slightly different Resume framing; preserve its surrounding sentences and swap only the discovery mechanism).

- [ ] **Step 2:** `sh tests/certify.sh` on each edited directory. **Step 3: Commit**: `engines: resume discovery via rt runs list, not a directory walk`.

### Task 3: collapse the fresh-shell RT_RUN_DB sentences

**Files:**
- Modify: the same seven engine files ONLY. Note: `attachments/gate-protocol/SKILL.md` also matches a grep for "fresh shell", but its sentence ("Each tool call is a fresh shell: capture values in the same call that uses them") is about capturing gate ids, is still true, and is NOT this task's target... leave it untouched.

- [ ] **Step 1:** Replace every occurrence of the sentence
`each tool call is a fresh shell: prefix every rt runs command with RT_RUN_DB=<runDb>` (and its `RT_RUN_DB=<its state.db>` variant) with, at its FIRST occurrence per file:

```markdown
rt runs verbs resolve your run automatically (env RT_RUN_DB first, else
the run this session started, else the newest running run in this
worktree; ambiguity errors loudly). Export RT_RUN_DB only to drive a
different run than yours.
```

and DELETE the later occurrences in the same file outright (the comment inside each `export RT_RUN_DB=...` code fence included; keep the export line itself in run-start blocks, since driving a JUST-CREATED run before stage-start records the session is the one case env genuinely covers... run-start output still prints runDb).

- [ ] **Step 2:** certify each edited dir. **Step 3: Commit**: `engines: one resolveRunDb sentence replaces sixteen fresh-shell warnings`.

### Task 4: bump, sync, verify compiled output

- [ ] **Step 1:** Bump mattstack's `.claude-plugin/plugin.json` version (same-commit convention: amend into a final `chore: bump for phase-0 skill fixes` commit if the pipeline expects one commit; follow editing-skills).
- [ ] **Step 2:** Push mattstack-skills main (the commit on main is what sync clones).
- [ ] **Step 3:** `rt skills sync --pack mattstack`, then `rt skills sync --pack claimview` (canonical checkouts, clean, on main; sync handles patch-bump + recompile + cache update; act on `restartNeeded`).
- [ ] **Step 4 (REQUIRED, editing-skills final validation):** read the compiled outputs IN FULL for: claimview `skills/work`, `skills/ship`, `skills/watch-ci`, `attachments/sync-open-mrs`, `attachments/self-review`, `attachments/receive-review`, mattstack `skills/shepherdr` (accounts slot carries the cswap fix). Confirm the new sentences render, the old ones are gone everywhere, and no `{{` markers leaked.
- [ ] **Step 5:** Report per-file word deltas in the lane report (expected: roughly minus 100-150 words per engine copy).
