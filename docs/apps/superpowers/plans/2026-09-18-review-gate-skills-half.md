# Review Gate Redesign Implementation Plan (mattstack-skills half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The review engine emits `report.json` and the posting contract takes finding ids.

**Architecture:** Three text-contract edits in the mattstack-skills repo: the review flow's Deliver tail gains the json emission, review-posting gains the `{findings, disposition}` selection (legacy `{levels}` kept), and the review verb's decision-record line carries the new shape. Certification and a version bump ride each edit. Pack recompiles (`rt skills sync`) are deliberately NOT here: sync refuses non-main checkouts, so it runs post-merge from the canonical checkout.

**Tech Stack:** Markdown skill sources, `tests/certify.sh <skill-dir>`, mattstack plugin versioning.

**Spec:** `docs/superpowers/specs/2026-09-18-review-gate-redesign-design.md` in the mattstack-apps repo (absolute: `/Users/matt/Documents/GitHub/mattstack-apps/docs/superpowers/specs/2026-09-18-review-gate-redesign-design.md`; the executing worktree may also have it at the same relative path in the apps worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-cedar`). Sections 1-2 are the binding contract.

## Global Constraints

- Repo: a worktree of `/Users/matt/Documents/GitHub/mattstack-skills`, provisioned with `rt worktree provision` (never hand-rolled `git worktree add`); branch from main.
- These files compile into employer-visible packs: no ticket references anywhere, no em dashes, no real review content in examples (invented `acme/webapp` examples only).
- REQUIRED SUB-SKILLS: load superpowers:writing-skills AND mattstack:editing-skills before touching any file; both govern every edit in this plan.
- Skill edits follow superpowers:writing-skills discipline: baseline a fresh reader on the current text before editing, verify the edited text changes the behavior, and keep additions in the file's existing voice and density. Every baseline and every verify runs at least 3 fresh-context reps; a verify passes only when the reps converge on the compliant behavior, and each transcript summary lands in the report file.
- Every content change certifies: `sh tests/certify.sh <edited dir>` from the repo root, and the plugin version bumps once in the same commit series (`.claude-plugin/plugin.json`, currently `0.17.18`, one patch bump for the whole plan).
- Fixed vocabulary from the spec, verbatim: readiness `yes | no | with-fixes`; tiers `Critical | Important | Minor`; finding fields `id, tier, kind, title, file, line, fix` (+ `fileLabel` for non-anchorable); optional blocks `depth`, `strengths [{lead, detail}]`, `checks [{tag, text}]`, `notes []`; selection `{findings: [ids], disposition}` with legacy `{levels}` accepted.

## File Structure

- `attachments/review-core-body-tail/SKILL.md` - Deliver tail: draft shape + json emission (Task 1)
- `attachments/review/review/SKILL.md` - Deliver step: severity line, gate intake, decision record (Task 2)
- `attachments/review-posting/SKILL.md` - selection contract + per-finding posting (Task 3)
- `.claude-plugin/plugin.json` - version bump (Task 3, same series)

---

### Task 1: Deliver tail emits `report.json`

**Files:**
- Modify: `attachments/review-core-body-tail/SKILL.md` (the "Assemble the draft" section)

**Interfaces:**
- Consumes: the existing fixed draft shape (Strengths / Issues by tier / Assessment readiness words).
- Produces: instruction text that makes every review that writes a report file also write `<same basename>.json` with the spec's schema. Tasks 2-3 refer to that json by name.

- [ ] **Step 1: Baseline**

Dry-run a fresh subagent on the CURRENT file: give it the section text plus an invented finished review draft and a report path, ask what files it writes. Expected baseline: the md only, no json. Record the transcript summary in the report file.

- [ ] **Step 2: Edit the section**

After the existing draft-shape bullets, add a subsection in the file's voice:

```markdown
## Structured findings file

Whenever the draft is written to a report file, write a sibling
`<same basename>.json` in the same directory, machine-readable, mirroring
the draft exactly (never re-judged):

- Required: `summary` ({`readiness`: `yes` | `no` | `with-fixes`,
  `reasoning`: the assessment's qualifier in one or two sentences; the
  draft's spaced "Ready to merge: with fixes" maps to readiness
  `with-fixes`, hyphenated, never the spaced form) and
  `findings`: one entry per finding, in report order, `id` stable
  (`f1, f2, ...`), with `tier`, `kind` (nitpick / suggestion / thought /
  confirmation / question, or the closest word), `title`, `file` and
  `line` when the finding anchors to the diff (else `fileLabel` with the
  anchor text, e.g. "not inline-anchorable"), and `fix` (one line).
- Optional, include when the draft has the material: `depth` (one line),
  `strengths` (`[{lead, detail}]`, the claim split from its receipts),
  `checks` (`[{tag, text}]`, tag `PASS` | `N/A` | `FAIL`), `notes`
  (observations that are neither strengths nor findings, including
  post-merge follow-ups).
- The markdown report stays the human artifact and does not change; the
  json is the only machine-read path. No terminal run without a report
  path writes either file.
```

Keep the section's existing red-flags table untouched.

- [ ] **Step 3: Verify**

Re-run the Step 1 dry-run against the edited text, with at least one rep whose draft says "Ready to merge: with fixes". Expected: the reader writes both files, json fields match the schema, ids in report order, and the with-fixes rep emits hyphenated readiness `with-fixes`. Iterate the wording until compliant; record the passing transcript summary.

- [ ] **Step 4: Certify and commit**

Run: `sh tests/certify.sh attachments/review-core-body-tail`
Expected: pass. Commit: `review tail: emit the structured findings file beside the report`

### Task 2: Review verb's Deliver step and decision record

**Files:**
- Modify: `attachments/review/review/SKILL.md` (the `## 3. Deliver` section)

**Interfaces:**
- Consumes: Task 1's json (by the sibling-file name).
- Produces: Deliver text whose decided selection is `{findings, outcome}` and whose decision record uses the new shape; the severity line gains the finding count.

- [ ] **Step 1: Baseline**

Dry-run a fresh subagent on the current Deliver text with an invented draft + a decided selection: capture the `rt runs decision record --selection` payload it produces. Expected baseline: `{"levels":[...],"disposition":"..."}`.

- [ ] **Step 2: Edit**

Three surgical changes, keeping everything else byte-identical:
1. The severity example line becomes: `"Findings: Critical (2), Important (1); 3 findings."`
2. Decision intake: callers hand `{findings, outcome}` (finding ids); the terminal-run structured question keeps `tiers` as its own question (a terminal run has no per-finding UI) and maps the answer to ids by tier through the report json before executing posting; hand posting `{findings: <ids>, disposition: <outcome>}`. Explicit fallback in the same breath: a caller that hands a tier-shaped selection (an unmigrated wrapper), or a tiers answer with no report json to map through, passes to posting as legacy `{levels: <tiers>, disposition: <outcome>}`, which posting accepts unchanged.
3. The record line becomes: `rt runs decision record --contract gate@1 --scope post --selection '{"findings":["f1","f3"],"disposition":"comment"}' --decided-by <decider>` with the same decider rules.

- [ ] **Step 3: Verify**

Re-run the dry-run. Expected: selection payload carries finding ids; terminal path still asks one tiers question and maps to ids. Include one rep handing a tier-shaped selection and one rep with no report json: both must pass posting the legacy `{levels, disposition}` form. Iterate until compliant.

- [ ] **Step 4: Certify and commit**

Run: `sh tests/certify.sh attachments/review/review`
Expected: pass. Commit: `review: deliver hands finding ids to posting and the decision record`

### Task 3: Posting takes finding ids; version bump

**Files:**
- Modify: `attachments/review-posting/SKILL.md` (the inputs block and the posting sections)
- Modify: `.claude-plugin/plugin.json` (version `0.17.18` -> `0.17.19`)

**Interfaces:**
- Consumes: Task 1's json schema.
- Produces: the posting contract the board wrapper and review verb name: `{findings: [ids], disposition}`, legacy `{levels}` accepted.

- [ ] **Step 1: Baseline**

Dry-run a fresh subagent on the current file with a decided `{findings: ["f2"], disposition: "comment"}` and an invented draft + json. Expected baseline: it stalls or reinterprets, since the current contract only knows `levels`.

- [ ] **Step 2: Edit**

1. The decided-selection input becomes: `{findings: [ids], disposition: "comment" | "approve" | "request_changes"}`; ids resolve against the report json's `findings` entries, and each selected entry's `file`/`line`/`title`/`fix` feed the inline-thread mechanics directly, never re-parsed from prose. A selected entry with no `file` anchor posts into the review's summary comment instead of an inline thread. Legacy `{levels: [...]}` stays accepted and posts whole tiers, unchanged, for callers not yet migrated.
2. The parked-resume line gains the json: when the draft is not in context, read the report file AND its json sibling; the json's buckets are the execution source.
3. Update the quick-reference table row to name both selection forms.

- [ ] **Step 3: Verify**

Re-run the dry-run. Expected: posts exactly the selected ids, anchors from the json, non-anchorable entry goes to the summary comment, legacy form still described. Iterate until compliant.

- [ ] **Step 4: Certify, bump, commit**

Run: `sh tests/certify.sh attachments/review-posting`
Expected: pass. Bump `.claude-plugin/plugin.json` to `0.17.19` in the same commit: `review posting: selection takes finding ids; bump 0.17.19`

### Task 4: Repo gates

- [ ] **Step 1: Repo checks**

Run from the repo root: `sh tests/repo-purity.sh` and `rt skills check --pack mattstack --pack-dir <this branch worktree>` so check reads the branch's sources rather than canonical main (informational on a branch; sync happens post-merge).
Expected: purity clean; check names exactly the three edited sources as pending.

- [ ] **Step 2: Stop**

Do NOT run `rt skills sync` from the branch. Post-merge, from canonical main: `rt skills sync --pack mattstack`, then `rt skills sync --pack <each compiled pack>`, then restart sessions it names, and per mattstack:editing-skills' Final Validation read the compiled output of every affected verb IN FULL (no grep) against the expected text. That handoff belongs to the operator.

## Self-review notes

- Spec sections 1-2 map to Tasks 1-3; section 6's sync sequencing is honored by Task 4's stop.
- The engine text keeps kind vocabulary identical to the apps-half parser's expectations (` · kind:<word>` is the WRAPPER's encoding; the engine json carries `kind` as a bare field; no coupling here).
- Employer-visible constraint repeated in every task via Global Constraints.
