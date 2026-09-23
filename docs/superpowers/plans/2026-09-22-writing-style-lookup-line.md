# Writing-style lookup line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every skill edit goes through superpowers:writing-skills and is released per mattstack:editing-skills.

**Goal:** Make every skill that drafts posted prose resolve the writing style the same way: the RT-244 `rt_verb` tool, then the `preferences.md` line, then the conversational preset.

**Architecture:** One mattstack include, `writing-style-lookup`, carries the instruction. The `review` engine includes it before `review-posting` (which, as an include target, cannot hold a placeholder), and `receive-review` includes it in place of its Voice bullet. The operator's compiled team pack drops its duplicate Voice sections and includes the lookup in its ship fill. The board wrappers' generic path carries the same text by hand.

**Tech Stack:** Markdown skills, `rt skills compile/check/sync`, `tests/certify.sh`.

**Spec:** `docs/superpowers/specs/2026-09-22-writing-style-presets-design.md` section 7.

## Global Constraints

- **Start only after** an rt release carrying both `rt skills writing-style show` (agent-safe) and the `rt_verb` tool has shipped, and after the presets are in the mattstack plugin.
- The instruction text is exactly the block in Task 1 Step 2; the board copy in Task 3 is the same words.
- The team pack is visible to the operator's employer: no mattstack ticket ids (`RT-`, `SKILLS-`, `BOARD-`, `MAT-`) in its files or its commit messages. Its path is `~/.mattstack/teams/<team>/mattstack/packs/<pack>/`; get `<team>` and `<pack>` from the operator.
- Other sections of `preferences.md` (dev process runner, standing rules) are untouched, and so are the skills that read them.
- No em or en dashes. mattstack-skills is public: `tests/repo-purity.sh` and `tests/certify.sh` stay green.
- Read every compiled output in full after compiling (mattstack:editing-skills "Final Validation").

## Review Focus

- The `rt_verb` tool deferred in the session (not yet loaded): the instruction must still lead the agent to call it (it names the full tool id, which is what ToolSearch selects).
- A session where the mattstack MCP server failed to connect: the agent falls to the `preferences.md` line, then conversational, without stalling (Task 1 GREEN run B).
- A team pack compile after the Voice sections are removed: `receive-review` and `review` still carry exactly one lookup, not two and not zero (Task 2 Step 4 read-through).
- The ship path: the MR description still keeps the repo's MR template sections.
- A default-mode pane reading `preferences.md` on the failure path may prompt; a denied read must fall through to conversational.

---

### Task 1: The mattstack include and engine wiring

**Files (mattstack-skills worktree):**
- Create: `attachments/writing-style-lookup/SKILL.md`
- Modify: `attachments/review/review/SKILL.md` (include before `{{include:review-posting}}`)
- Modify: `attachments/review-posting/SKILL.md` (delete `## Writing style`)
- Modify: `attachments/review/receive-review/SKILL.md` (Voice bullet becomes the include)
- Modify: `.claude-plugin/plugin.json` (minor bump)

- [ ] **Step 1: RED: record today's behavior**

Dispatch a fresh subagent with only the current `receive-review` Voice bullet text and this task: "You authored a PR; reply to the reviewer comment 'Should this be a Record<Status, string>?' (you agree and changed it). Say which skill, if any, you loaded to set your voice, then give the reply." Record the answer in the PR description as the baseline (expected: no lookup mechanism named, or a guessed skill).

- [ ] **Step 2: Write the include**

`attachments/writing-style-lookup/SKILL.md`:

```markdown
---
name: writing-style-lookup
description: "The one writing-style lookup every drafting skill carries: which skill sets the voice of prose posted under the operator's name. Not for direct invocation; engines include it."
---

## Writing style

Before drafting, call `mcp__plugin_mattstack_mattstack__rt_verb` with
`{"args": ["skills", "writing-style", "show"]}` and load the skill its
`skill` names. That load is step one: compose in that voice from the first
word, never as a pass over a finished draft. If the tool is unavailable,
refused, or fails, load the skill named on the `writing-style:` line of
`~/.mattstack/user/skills/preferences.md` if there is one. If that is missing
too, or the skill will not load, load `mattstack:writing-style-conversational`.
```

Run: `sh tests/certify.sh attachments/writing-style-lookup`
Expected: all `ok`.

- [ ] **Step 3: Wire the engines**

- `attachments/review/review/SKILL.md`: on the line before `{{include:review-posting}}`, add `{{include:writing-style-lookup}}` alone on its line (a blank line between them).
- `attachments/review-posting/SKILL.md`: delete the whole `## Writing style` section (heading and paragraph).
- `attachments/review/receive-review/SKILL.md`: replace the `- **Voice.** ...` bullet in step 3 with a blank line and `{{include:writing-style-lookup}}` alone on its line, directly after the bullet list it sat in.

Run: `sh tests/certify.sh attachments/review/review`, `sh tests/certify.sh attachments/review-posting`, `sh tests/certify.sh attachments/review/receive-review`
Expected: all `ok` (`review-posting` must stay placeholder-free).

- [ ] **Step 4: Bump, commit, PR, release**

Bump `.claude-plugin/plugin.json` one minor.

```bash
git add attachments/writing-style-lookup attachments/review attachments/review-posting .claude-plugin/plugin.json
git commit -m "writing-style lookup: one include for review and receive-review"
git push -u origin HEAD
gh pr create --title "writing-style lookup include for review and receive-review" --body "<the include text, where it goes and why review-posting cannot hold it, the RED baseline>"
```

Wait for CodeRabbit and CI; merge with the operator's confirmation. Then from the canonical checkout on `main`: `rt skills sync --pack mattstack`.

- [ ] **Step 5: GREEN**

Compile a team pack's verbs against the new plugin (Task 2 does this for the operator's pack). With the compiled `receive-review` in hand, dispatch two fresh subagents with the same fixture as Step 1 and the compiled lookup section:

- Run A (normal session): expected to call `rt_verb`, report the skill that `rt skills writing-style show --json` returns on this machine right now (the controller runs that command first to know the answer; it changes no state), and reply in that voice.
- Run B (told the tool call failed): expected to read the `preferences.md` line or fall to conversational, and say which.

Any deviation is a loophole: tighten the include text, recompile, rerun.

---

### Task 2: The operator's team pack

**Files (team pack checkout, path from the operator):**
- Modify: `attachments/review-criteria/SKILL.md` (delete its `## Voice` section)
- Modify: `attachments/reply-rules/SKILL.md` (delete its `## Voice` section)
- Modify: `attachments/ship-domain/SKILL.md` (step 10's writing-style sentence)

- [ ] **Step 1: Re-read the files**

Read all three in full; confirm the `## Voice` sections and step 10's sentence are the only writing-style lookups, and that the files' other `preferences.md` reads (standing rules, dev process runner) stay.

- [ ] **Step 2: Edit**

- `review-criteria` and `reply-rules`: delete the `## Voice` section. The engine now carries the lookup on both paths.
- `ship-domain` step 10: replace the "load the writing-style skill named in `preferences.md` ... follow the repo MR template directly" sentence with `{{include:writing-style-lookup}}` alone on its line, followed by: "Compose the description in that voice. Keep every section of the repo's MR template, filling each in that voice."

- [ ] **Step 3: Compile and check**

Run: `rt skills compile --pack <pack>` then `rt skills check --pack <pack>`
Expected: no drift after compile.

- [ ] **Step 4: Read the compiled output in full**

Read the compiled `review`, `self-review`, `receive-review`, `ship` and `stage-ship` in full. Expected: `review` and `receive-review` carry the lookup exactly once; `self-review` carries none (it never posts); `ship` and `stage-ship` carry it once, in step 10; no `{{` anywhere; no Voice section left behind.

- [ ] **Step 5: Commit and publish**

Commit message without any mattstack ticket id, for example `writing style: use the shared lookup; drop duplicate voice sections`. Push (for a team pack, push is the publish), then `rt skills sync --pack <pack>` and restart the sessions it reports.

---

### Task 3: Board wrappers' generic path

**Files (`~/Documents/GitHub/mattstack-apps`):**
- Modify: `apps/board/skills/review/SKILL.md`
- Modify: `apps/board/skills/respond/SKILL.md`

- [ ] **Step 1: Find the generic path**

In each file, find the step that drafts or posts text when no domain skill resolved (the "generic no-domain-skill path").

- [ ] **Step 2: Add the lookup**

Insert, as the first thing that path does before drafting, the exact `## Writing style` paragraph from Task 1 Step 2 (the body text, as a paragraph or a sub-step matching the file's structure). The domain-skill path needs nothing: the domain skill carries the engine include.

- [ ] **Step 3: Verify and ship**

Run the board app's skill tests or lint if the repo has them (`rg -l "skills/review" apps/board --glob '*test*'`). Commit, push, open a PR, wait for CodeRabbit and CI, merge with the operator's confirmation. The wrappers are symlinked into place, so deploy is merge plus a pull of the canonical mattstack-apps checkout.

- [ ] **Step 4: End-to-end check**

On the operator's machine, have the board launch one review on a test MR in one of the operator's test repos (ask which) with no domain skill bound, and confirm the posted comments read in the configured style: no em dashes, no praise opener, the preset's shape.
