# Writing-style presets (mattstack-skills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every skill file in this plan is written under superpowers:writing-skills (RED baseline, minimal text, GREEN retest, close loopholes) and released per mattstack:editing-skills.

**Goal:** Ship three writing-style presets (sparse, conversational, structured) and one shared rules include in the public mattstack plugin, each proven against a no-style baseline and against the operator's own style skill.

**Architecture:** The presets are compiled verbs of the mattstack pack itself: an engine per preset under `attachments/writing-style/writing-style-<preset>/` (the compiler matches an engine by directory name one group level down) that `{{include:writing-style-floor}}`s the shared rules, rostered in `pack/stubs.jsonc`, compiled to `skills/writing-style-<preset>/` with a vendored `pr-description.md` beside each. Includes resolve only at compile time and cannot nest, which is why the floor is an include and the presets are compiled rather than hand-written.

**Tech Stack:** Markdown skills, `rt skills compile/check/sync`, `tests/certify.sh`, `tests/repo-purity.sh`.

**Spec:** `docs/superpowers/specs/2026-09-22-writing-style-presets-design.md` in repo-tools (section 6).

## Global Constraints

- The repo is public. No personal names, employer or customer names, internal repo names, named colleagues, or internal ticket prefixes (`RT-`, `SKILLS-`, `BOARD-`, `MAT-`) anywhere, including fixtures and test outputs. Neutral placeholders: `acme`, `ABC-123`.
- No em or en dashes in any file (`tests/certify.sh` checks the bytes).
- Skill ids: `mattstack:writing-style-sparse`, `mattstack:writing-style-conversational`, `mattstack:writing-style-structured`. Fallback preset: conversational.
- Include name `writing-style-floor`. An include line is `{{include:writing-style-floor}}` alone on its line.
- Each preset's description says to load it only when the writing-style lookup names it.
- Every `pr-description.md` keeps a repo's own PR/MR template sections when one exists.
- The reference skill is `~/Documents/GitHub/matt-skills/skills/workflow/matts-writing-style/` (`SKILL.md` and `mr-writing-style.md`). Read it in full before writing any preset. Nothing from it that names a person, employer or repo may be copied.
- Work in a worktree of `~/Documents/GitHub/mattstack-skills`: `rt worktree provision` if `rt worktree list` knows the repo, else `git worktree add .claude/worktrees/writing-style-presets -b writing-style-presets`. Never edit the canonical checkout.

## Review Focus

- A preset that auto-triggers on "draft a review" when it is not the configured style: the description must gate on the lookup naming it (checked in each preset task by reading the compiled frontmatter).
- A repo with its own PR template: `pr-description.md` must keep the template's sections (fixture 3b in Task 1 carries a template).
- A reply where the reviewer is wrong: presets must still disagree without a praise opener (fixture 2 second comment).
- A finding with no line anchor: it must become its own top-level comment, not a paragraph in the summary (fixture 1 includes a missing-test finding).
- Code in a suggestion: must land in a fenced block, not inline (fixture 1's main bug has a code fix).

---

### Task 1: Fixtures, floor checker, RED baseline, reference run

**Files:**
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/1-review.md`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/2-replies.md`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/3a-pr.md`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/3b-pr-with-template.md`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/4-commit.md`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/protocol.md`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/check-floor.sh`
- Create: `docs/superpowers/tests/2026-09-22-writing-style-presets/results.md`

**Interfaces:**
- Produces: `check-floor.sh <outputs-dir>` (exit 0 clean, 1 with hits listed); the run protocol every later task repeats; `outputs/baseline/` and `outputs/reference/`.

- [ ] **Step 1: Write fixture 1 (review)**

`fixtures/1-review.md`:

````markdown
# Fixture 1: review a teammate's PR

You are reviewing PR #212 in `acme/storefront`, "cache per-user settings".
Post the review: each inline finding as `path:line` followed by the comment
body, then any finding with no line to anchor to as its own top-level
comment, then the one summary comment.

```diff
--- a/src/settings/cache.ts
+++ b/src/settings/cache.ts
@@ -1,20 +1,31 @@
-import { loadSettings } from "./load";
+import { loadSettings, type Settings } from "./load";
+import { logger } from "../log";

-export async function getSettings(tenantId: string, userId: string) {
-  return loadSettings(tenantId, userId);
+const cache = new Map<string, Settings>();
+
+export async function getSettings(tenantId: string, userId: string): Promise<Settings> {
+  const hit = cache.get(userId);
+  if (hit) return hit;
+  const settings = await loadSettings(tenantId, userId);
+  cache.set(userId, settings);
+  return settings;
 }
+
+export function clearSettings(userId: string) {
+  cache.delete(userId);
+}
```

Facts you verified while reviewing:
- `userId` values are unique only within a tenant (`src/users/ids.ts:14`
  derives them from a per-tenant counter).
- Tenants `t1` and `t2` in the seed data both have a user `u7`; calling
  `getSettings("t1", "u7")` then `getSettings("t2", "u7")` returns t1's
  settings both times.
- `logger` is imported and never used.
- The PR adds no tests.
````

- [ ] **Step 2: Write fixture 2 (replies on your own PR)**

`fixtures/2-replies.md`:

````markdown
# Fixture 2: reply to reviewers on your own PR

You authored PR #219 in `acme/storefront`, which adds a `labels` lookup:

```ts
const labels: { [status: string]: string } = { open: "Open", closed: "Closed" };
```

Reply to each comment below as the author. Post only the reply bodies,
numbered.

1. Reviewer: "Should this be a `Record<Status, string>`? A plain index
   signature lets a typo like `labels.opne` through silently."
   You agree and changed it.
2. Reviewer: "Why not make the lookup async so it can come from the API
   later?"
   You disagree: nothing loads labels from the API today, and making it
   async would ripple through six synchronous callers.
````

- [ ] **Step 3: Write fixtures 3a and 3b (PR descriptions)**

`fixtures/3a-pr.md`:

````markdown
# Fixture 3a: write the PR description

Write the description for your PR in `acme/storefront` (ticket ABC-481). The
repo has no PR template.

What the branch does:
- `src/settings/cache.ts`: per-user settings cache keyed on `(tenantId,
  userId)`; `clearSettings(tenantId, userId)` evicts one entry.
- `src/settings/load.ts`: `loadSettings` now throws `SettingsNotFound`
  instead of returning `undefined`.
- `src/api/settings.ts`: the PATCH handler calls `clearSettings` after a
  write.
- Renamed `getUserPrefs` to `getSettings` in three callers.
- Left for later: cache size limit (ABC-490).

Tests: 9 new tests in `cache.test.ts`; full settings suite 142/142 green.
Checked by hand: settings page for tenant t2 user u7 shows t2's theme after
t1's u7 loads first.
Preview: https://preview-481.storefront.example.com
````

`fixtures/3b-pr-with-template.md`: the same content as 3a, with this line
added after the ticket line:

````markdown
The repo's PR template, which must be kept:

```markdown
## Summary

## Checklist
- [ ] Behind a feature flag, or N/A with a reason
- [ ] Tests added or updated

## Verification
```
````

- [ ] **Step 4: Write fixture 4 (commit)**

`fixtures/4-commit.md`:

```markdown
# Fixture 4: write the commit message

Ticket ABC-481. The staged change keys the settings cache on
(tenantId, userId) instead of userId alone, and makes clearSettings take
both. Before it, two tenants with the same user id read each other's
settings. Write the full commit message.
```

- [ ] **Step 5: Write the floor checker**

`check-floor.sh`:

```sh
#!/bin/sh
# check-floor.sh <outputs-dir> -- mechanical floor violations in preset outputs.
set -u
DIR=${1:?usage: check-floor.sh <outputs-dir>}
HITS=0
report() { echo "$1"; HITS=1; }

if grep -rn "$(printf '\342\200\224')\|$(printf '\342\200\223')" "$DIR"; then report "FAIL: em or en dash"; fi

PHRASES='smoking gun|load-bearing|razor-sharp|money question|nails it|plot thickens|here.s the kicker|dive in|great catch|good catch|nice find|you.re (absolutely )?right|thanks for (flagging|catching|the review)|in order to|facilitate|leverage|please let me know|happy to discuss|worth flagging|one thing i noticed|took a look|i just wanted to'
if grep -rniE "$PHRASES" "$DIR"; then report "FAIL: banned phrase"; fi

if grep -rnE '`(issue|suggestion|question|nitpick|thought)( \(non-blocking\))?:`' "$DIR"; then report "FAIL: label as a code span"; fi

[ "$HITS" -eq 0 ] && echo "ok floor"
exit "$HITS"
```

Note `good call` is deliberately absent: it is allowed when conceding a
reviewer's catch on your own PR.

- [ ] **Step 6: Write the protocol**

`protocol.md`:

````markdown
# Run protocol

One run = one fresh subagent (general-purpose, most capable model tier, no
conversation context) that drafts all five fixtures and writes one file per
fixture to `outputs/<run>/<fixture-file-name>`.

Prompt, verbatim, with `<STYLE>` replaced per run:

> You draft text that a developer will post under their own name. <STYLE>
> Then read each file in `docs/superpowers/tests/2026-09-22-writing-style-presets/fixtures/`
> and write exactly the text you would post, nothing else, to
> `docs/superpowers/tests/2026-09-22-writing-style-presets/outputs/<run>/<same file name>`.

| Run | `<STYLE>` |
| --- | --- |
| baseline | (empty) |
| reference | Before drafting, read `~/Documents/GitHub/matt-skills/skills/workflow/matts-writing-style/SKILL.md` and follow it; read `mr-writing-style.md` beside it before any PR description. |
| sparse / conversational / structured | Before drafting, read `skills/writing-style-<preset>/SKILL.md` in this repo and follow it; read the `pr-description.md` beside it before any PR description. |

After a run: `sh docs/superpowers/tests/2026-09-22-writing-style-presets/check-floor.sh outputs/<run>`
and record the result, word counts per file (`wc -w`), and observations in
`results.md`. The controller, not the subagent, compares runs.
````

- [ ] **Step 7: Run baseline and reference**

Dispatch the baseline run and the reference run per `protocol.md` (two
agents, in parallel).

Then run: `sh docs/superpowers/tests/2026-09-22-writing-style-presets/check-floor.sh docs/superpowers/tests/2026-09-22-writing-style-presets/outputs/baseline`
Expected: FAIL on at least one line (the RED baseline). If it passes clean,
record which tells the baseline still shows by reading it (headings in
comments, findings over 4 sentences, recap in the summary, thanks in
replies) and list them in `results.md`, because the presets must fix what
the baseline actually does.

Run the same check on `outputs/reference`. Expected: ok floor. A hit there is
a real finding about the reference skill; note it, do not fix it.

- [ ] **Step 8: Record results**

`results.md` gets a table per run: fixture, word count, floor result, and one
line of observation. Under the baseline table, list the failures the presets
must fix.

- [ ] **Step 9: Purity and commit**

Run: `sh tests/repo-purity.sh`
Expected: `ok` (outputs are neutral-domain; if a reference output quotes
anything personal, delete that line from the output and note it).

```bash
git add docs/superpowers/tests/2026-09-22-writing-style-presets
git commit -m "writing-style presets: fixtures, floor checker, baseline and reference runs"
```

---

### Task 2: The shared floor include

**Files:**
- Create: `attachments/writing-style-floor/SKILL.md`

**Interfaces:**
- Consumes: Task 1's baseline failures list.
- Produces: include `writing-style-floor`, consumed by Tasks 3 to 5.

- [ ] **Step 1: Write the include**

`attachments/writing-style-floor/SKILL.md`:

```markdown
---
name: writing-style-floor
description: "The rules every mattstack writing-style preset shares, the tells that make posted prose read as machine-written. Not for direct invocation; each preset includes it."
---

## Rules every style shares

These bind anything posted under the operator's name: review findings, the
review summary, replies on their own PR, PR descriptions, commit messages.
The preset sets the voice; these set the floor.

### Never

- **Em or en dashes.** Rephrase, or use parentheses, a colon, or an ellipsis
  ("...").
- **Detective and agent phrasing.** "smoking gun", "load-bearing",
  "razor-sharp", "the money question", "nails it", "the plot thickens",
  "here's the kicker", "let's dive in". Say the plain thing: "the evidence",
  "the key question", "this confirms it".
- **Praise or thanks as an opener.** "Great catch", "Nice find", "You're
  right", "Thanks for flagging", "Absolutely". Open on what the code does or
  what changes.
- **Corporate filler.** "ensure", "facilitate", "leverage", "in order to",
  "please let me know if you have any questions", "happy to discuss".
- **Announcement openers and self-narration.** "Worth flagging:", "One thing I
  noticed:", "Took a look", "I just wanted to". Start with the claim.
- **Invented precision.** "most" beats "~96%" unless the number was measured.

### Always

- **Compress before posting.** The first draft is a rough cut. Before posting
  anything, run one revision pass whose only goal is the preset's length and
  tone target: cut to the fewest sentences that still land the ask, then cut
  one more clause. Posting a first draft means this pass was skipped.
- **One reason, one ask.** Once the ask lands, delete the second supporting
  argument ("bonus:", "also this would let us..."). Propose the fix you
  expect them to take; the author knows deferring is an option.
- **Evidence as output.** If you ran something, paste the result in a code
  block rather than describing it.
- **Stay on the diff.** Comment on the code in front of you. Whether the
  change should exist at all is the author's and PM's call.
- **Code out of prose.** More than a few tokens of code (an expression, a
  suggested function) goes in a fenced block on its own line. Inline
  backticks are for names: `userId`, `cache.ts:42`.
- **Exact locations.** `file.ts:123`, never "around line 120".
- **A one-line review summary.** A verdict plus a pointer to the inline
  notes. It never recaps a finding, lists strengths, or reports what you ran.
  A finding with no line to anchor to is its own top-level comment.
```

- [ ] **Step 2: Certify**

Run: `sh tests/certify.sh attachments/writing-style-floor`
Expected: every check `ok` (purity-domain, purity-personal, no-em-dashes,
no-ticket-ids, fm-open, fm-name, fm-description).

- [ ] **Step 3: Commit**

```bash
git add attachments/writing-style-floor/SKILL.md
git commit -m "writing-style: shared floor include"
```

---

### Task 3: The sparse preset

**Files:**
- Create: `attachments/writing-style/writing-style-sparse/SKILL.md`
- Create: `attachments/writing-style/writing-style-sparse/pr-description.md`
- Modify: `pack/stubs.jsonc` (add the verb)
- Create (compiled): `skills/writing-style-sparse/SKILL.md`, `skills/writing-style-sparse/pr-description.md`

**Interfaces:**
- Consumes: include `writing-style-floor` (Task 2); `outputs/reference/` (Task 1).
- Produces: skill `mattstack:writing-style-sparse`.

- [ ] **Step 1: Write the engine**

`attachments/writing-style/writing-style-sparse/SKILL.md`:

````markdown
---
name: writing-style-sparse
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-sparse. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: terse, lowercase technical prose, one tight paragraph per point."
type: pipeline-step
---

# Sparse

Terse and conversational. The reader is a colleague who can follow a chain
from one sentence. Load this before the first draft and write in it from the
first word; it is not a pass applied to a finished draft.

{{include:writing-style-floor}}

## Voice

- **Lowercase for technical content**: findings, assertions, code talk.
  Proper nouns, code, and short social lines ("Looks good to me! Left a few
  comments.") keep normal case.
- **Casual and direct.** Contractions welcome: "could we just", "wonder if",
  "does this actually".
- **Hedge inside the claim, not in front of it.** "the cache is doing more
  than memoizing, i think", not "one concern: the cache is doing more".
- **No markdown furniture in comments.** No headings, lists, or bold except
  the Conventional Comments label. Code blocks and backticks are fine.
- **One claim per paragraph**, and never restate a fact's downstream
  consequence as a new paragraph.

Compression target: shorter and more conversational. Ask "would a busy
teammate send this as written, or trim it first?" If there is any doubt,
trim.

## Review findings

Open with a bolded Conventional Comments label, never a code span:
`**issue:**`, `**suggestion:**`, `**question:**`, `**nitpick:**`,
`**thought:**`, with `(non-blocking)` when it helps. Pick it by what you ask
the author to do: `question` when they need to check, `issue` when you know
it's broken, `suggestion` for design or style, `nitpick` for trivia,
`thought` when musing.

Most findings are 2 to 4 sentences: the problem, the one-line causal chain,
and the fix asked as a light question. The inline anchor already says where
you are, so don't re-walk the path. The beats a substantive finding may take,
in order (a superset; most use two or three):

1. **Claim, hedged.** `i think this leaks across tenants.`
2. **Mechanism**, cited as `file.ts:line`. When it is a condition or two,
   fold it into the claim instead of its own paragraph.
3. **Impact.** `both t1 and t2 have a u7 in seed data, so it's reachable.`
   Often folds into the claim.
4. **Suggestion, as a question.** Code goes in a fenced block.
5. **Concession, only when real.** Never as a politeness move.

A non-blocking `thought` or `question` is two short paragraphs at most. A
process ask (a missing test, missing evidence) is one or two casual lines:

```
**suggestion:** changes look good. would you mind adding a test for the two-tenant case? 👌
```

Over-built:

```
**issue (non-blocking):** on the retry path this re-reads the stale price. `loadPrice` runs inside `fetchCart().then`, so when `fetchCart()` rejects the price is still the cached one and `total()` returns the old value. for a customer whose price changed, checkout shows the old total... the exact bug this change fixes, reintroduced on the failure path. `usePriceRefresh` can't rescue it since the cache never cleared. it's defensible as fail-closed, but should be a conscious decision.
```

Compressed, same finding and ask:

```
**issue (non-blocking):** if `fetchCart()` rejects here the price is still the cached one, so checkout shows the old total... the same bug this fixes. fine as fail-closed, but can we say that in a comment (or retry once)? right now it reads as harmless.
```

A brief, specific acknowledgment is fine inline when it immediately pivots
into the worry: `**thought (non-blocking):** nice job pinning the version.
only worry: nothing tests the fallback...`. A bare compliment is not.

## Review summary

One line, sentence case: `Looks solid to me, no blockers. Left a few inline
notes.` or `Left a few comments!` Only a blocker may join it: `Left one
blocker inline.`

## Replies on your own PR

Very short. No sign-offs, no thanks unless they thanked first. Soften even
confident claims ("probably", "i think", "seems ok to me") and concede the
limits of your reasoning. Once the point lands, cut the clause defending it.
Praise flows up, not down: `good call. changed to Record<Status, string>.`
is right when conceding a reviewer's catch. Stack single sentences; no
blank-line paragraphs.

- `good call. changed to Record<Status, string>.`
- `honestly not sure. good one to keep an eye on though.`
- `i don't think async buys us anything yet. nothing loads labels from the api, and it'd ripple through six sync callers.`
- `👍`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting. It carries the
length target, the structure, and the anti-patterns.

## Commit messages

- Subject: lowercase, imperative, under 72 characters, prefixed with the
  ticket key when the repo uses them (`ABC-123: key settings cache on tenant`).
- Body, optional: one or two lowercase lines on why, wrapped at 72.
````

- [ ] **Step 2: Write the companion**

`attachments/writing-style/writing-style-sparse/pr-description.md`:

````markdown
# PR descriptions (sparse)

If the repo has a PR or MR template, keep every section of it and fill each
in this voice. Otherwise use the shape below.

## Length

100 to 200 words above any checklist. Past 250, re-read and cut.

## Shape

```markdown
<ticket key>: <lowercase title>

<one or two plain sentences: what this does and why>

**<group label>** (optional path)

- <one-clause bullet>

**Also**

- <orthogonal change worth knowing>

**Follow-up**

- <descope or related ticket>

<one sentence naming a specific case you checked and what you saw>

- <preview link>
```

## Bullets

- One clause each, action-first: `Adds`, `Fixes`, `Removes`, `Renames`.
- Files and symbols in backticks; never paste source.
- Skip the why when the diff shows it.
- Flat by default; nest only when a point cannot fit its parent line.

## Group labels

Named after what they group (`Cache`, `API`, `Callers`), never "Code
changes". Two to four groups; one group needs no label.

## Also and Follow-up

One line each, three at most. Skip the section when empty. A follow-up that a
ticket covers is one line naming it.

## Verification

One sentence with a specific case and the observable result. Test counts,
not logs: "9 new tests; settings suite 142/142 green."

## Don't

- Restate the ticket.
- Frame in more than two sentences.
- Write multi-sentence bullets or parenthetical paragraphs.
- Leave TODO sections or placeholders.
- Paste diffs or test logs.

## Anti-patterns

- A framing paragraph that walks every file. Cut to what and why.
- A compound bullet: "Adds `cache.ts`, which keys on tenant and user and
  evicts on write (so the PATCH path stays fresh) and also renames...". Cut
  to "`cache.ts`: per-user cache keyed on tenant and user."
- A follow-up bullet that restates what its ticket already says.

## Minimal variant

A tiny change whose screenshot says it all: one or two lowercase bullets and
the image, nothing else.
````

- [ ] **Step 3: Roster the verb**

In `pack/stubs.jsonc`, add inside `"verbs"`:

```jsonc
"writing-style-sparse": {
  "engine": "writing-style-sparse",
  "description": "Use only when the mattstack writing-style lookup names mattstack:writing-style-sparse. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: terse, lowercase technical prose, one tight paragraph per point."
}
```

Then add `"writing-style-sparse"` to the `"public"` list in `surface.jsonc`
now, before the first compile. Compile writes a verb missing from that list
to `attachments/<verb>/` as an internal verb (`commands/skills.ts`,
`isPublic: !publicSet || publicSet.has(verb.name)`), and every later compile
would then find that output at the flat `attachments/writing-style-sparse/`
before the engine one group down, and fail on its missing
`type: pipeline-step`.

- [ ] **Step 4: Compile and read the output in full**

Run: `rt skills compile --pack mattstack --pack-dir "$PWD" --verb writing-style-sparse --dry-run --json`
Expected: the row for `writing-style-sparse` has `side: "skills"` and lists
files `SKILL.md` and `pr-description.md` (paths are relative to the verb's
directory; text-mode dry-run prints only `would write 2 files`). If `pr-description.md` is not listed, the
step-file vendoring did not pick it up: stop and report rather than
hand-copying it. If the files land under `attachments/`, the surface entry
above is missing.

Run: `rt skills compile --pack mattstack --pack-dir "$PWD" --verb writing-style-sparse`
Then read `skills/writing-style-sparse/SKILL.md` in full (not grep).
Expected: frontmatter `name` and description from the stub, the floor
rules inlined under a `<!-- part: include:writing-style-floor ... -->`
marker, no `{{` anywhere, and the `pr-description.md` path resolving
beside the compiled file.

- [ ] **Step 5: GREEN run**

Dispatch the sparse run per `protocol.md`.
Run: `sh docs/superpowers/tests/2026-09-22-writing-style-presets/check-floor.sh docs/superpowers/tests/2026-09-22-writing-style-presets/outputs/sparse`
Expected: `ok floor`.

- [ ] **Step 6: Compare with the reference**

Controller reads `outputs/sparse/` and `outputs/reference/` side by side,
fixture by fixture, and records in `results.md`:

- Findings: same label choice, lowercase, 2 to 4 sentences, ask as a
  question, the fix in a fenced block, the missing-test finding as its own
  top-level comment, the summary one line.
- Replies: single stacked sentences, no thanks, `good call` only on the
  conceded one, the disagreement softened.
- PR 3a: within 25% of the reference's word count and the same shape. PR 3b:
  the template's three sections kept.
- Commit: lowercase subject with `ABC-481:`, under 72 characters.

Any miss is a loophole: tighten the engine or companion text (REFACTOR),
recompile, rerun the sparse run, and recheck. Repeat until clean.

- [ ] **Step 7: Certify and commit**

Run: `sh tests/certify.sh attachments/writing-style/writing-style-sparse` then
`sh tests/certify.sh skills/writing-style-sparse`
Expected: all `ok`.

```bash
git add attachments/writing-style/writing-style-sparse pack/stubs.jsonc surface.jsonc skills/writing-style-sparse docs/superpowers/tests/2026-09-22-writing-style-presets
git commit -m "writing-style: sparse preset"
```

---

### Task 4: The conversational preset

**Files:**
- Create: `attachments/writing-style/writing-style-conversational/SKILL.md`
- Create: `attachments/writing-style/writing-style-conversational/pr-description.md`
- Modify: `pack/stubs.jsonc`
- Create (compiled): `skills/writing-style-conversational/`

**Interfaces:**
- Consumes: include `writing-style-floor`.
- Produces: skill `mattstack:writing-style-conversational`, the resolver's fallback.

- [ ] **Step 1: Write the engine**

`attachments/writing-style/writing-style-conversational/SKILL.md`:

`````markdown
---
name: writing-style-conversational
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-conversational. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: short, friendly sentences in sentence case, like talking to a teammate."
type: pipeline-step
---

# Conversational

Short, friendly, and plain, like talking to a teammate across a desk. Load
this before the first draft and write in it from the first word.

{{include:writing-style-floor}}

## Voice

- **Sentence case** everywhere, with contractions.
- **Short paragraphs** of one to three sentences. Plain words over jargon.
- **Warm, not effusive.** A short, specific acknowledgment is fine when it
  pivots straight into the point ("Nice job pinning the version. One worry:
  nothing tests the fallback."). A bare compliment is not.
- **Hedge honestly**, inside the sentence: "I think this leaks across
  tenants."
- **Light formatting.** The bold label and code are fine in comments; skip
  headings and lists there.

Compression target: would this read naturally if you said it out loud to the
author? Cut anything you would not say.

## Review findings

Open with a bolded Conventional Comments label, never a code span
(`**issue:**`, `**suggestion:**`, `**question:**`, `**nitpick:**`,
`**thought:**`, `(non-blocking)` when it helps), chosen by what you ask the
author to do.

Two to four sentences: what's wrong, why in one sentence (with
`file.ts:line`), and the fix as a friendly question, code in a fenced block.

````
**issue:** The cache is keyed on `userId` alone, but user ids repeat across tenants (`src/users/ids.ts:14`). So t1's u7 and t2's u7 share an entry and see each other's settings. Could we key on both?

```ts
const key = `${tenantId}:${userId}`;
```
````

A process ask is one line: `**suggestion:** Looks good! Could you add a test
for the two-tenant case?`

## Review summary

One line: `Looks good to me, no blockers. Left a few comments inline.` Only a
blocker joins it.

## Replies on your own PR

One to three short sentences. No sign-offs; thank someone only if they
thanked you. Agree plainly when they're right ("Good call, switched to
`Record<Status, string>`."). Disagree gently with the one reason that
matters.

- `Good call, switched to Record<Status, string>.`
- `I'd hold off on async for now. Nothing loads labels from the API yet, and it would touch six sync callers.`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting.

## Commit messages

- Subject: imperative, sentence case, under 72 characters, with the ticket
  key when the repo uses them (`ABC-123: Key settings cache on tenant`).
- Body, optional: one or two sentences on why, wrapped at 72.
`````

- [ ] **Step 2: Write the companion**

`attachments/writing-style/writing-style-conversational/pr-description.md`:

````markdown
# PR descriptions (conversational)

If the repo has a PR or MR template, keep every section and fill each in
this voice. Otherwise use the shape below.

## Length

About 150 to 250 words. Past 300, cut.

## Shape

```markdown
<ticket key>: <Title in sentence case>

<Two or three friendly sentences: what this does, why, and anything a
reviewer should look at first.>

**What changed**

- <short sentence per change, files in backticks>

**Testing**

<One or two sentences: what you ran and a specific case you checked.>

<Links, one per line.>
```

## Rules

- One short sentence per bullet; files and symbols in backticks.
- Mention a descope or follow-up ticket in one sentence under What changed.
- Test counts, not logs.
- Never restate the ticket, paste diffs, or leave placeholders.
````

- [ ] **Step 3: Roster, compile, read in full**

Add to `pack/stubs.jsonc`:

```jsonc
"writing-style-conversational": {
  "engine": "writing-style-conversational",
  "description": "Use only when the mattstack writing-style lookup names mattstack:writing-style-conversational. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: short, friendly sentences in sentence case, like talking to a teammate."
}
```

Add `"writing-style-conversational"` to `surface.jsonc`'s `"public"` list
before compiling (same reason as Task 3 Step 3).

Run: `rt skills compile --pack mattstack --pack-dir "$PWD" --verb writing-style-conversational`
Read `skills/writing-style-conversational/SKILL.md` in full. Expected: as in
Task 3 Step 4.

- [ ] **Step 4: GREEN run and review**

Dispatch the conversational run per `protocol.md`, then
`check-floor.sh outputs/conversational`. Expected: `ok floor`.

Controller checks: sentence case; findings two to four sentences with the
fix in a fenced block; the missing-test finding as its own comment; summary
one line; replies one to three sentences with no thanks opener; 3b keeps the
template's sections; commit subject sentence case under 72. Any miss:
tighten, recompile, rerun.

- [ ] **Step 5: Certify and commit**

Run: `sh tests/certify.sh attachments/writing-style/writing-style-conversational` and
`sh tests/certify.sh skills/writing-style-conversational`. Expected: all `ok`.

```bash
git add attachments/writing-style/writing-style-conversational pack/stubs.jsonc surface.jsonc skills/writing-style-conversational docs/superpowers/tests/2026-09-22-writing-style-presets
git commit -m "writing-style: conversational preset"
```

---

### Task 5: The structured preset

**Files:**
- Create: `attachments/writing-style/writing-style-structured/SKILL.md`
- Create: `attachments/writing-style/writing-style-structured/pr-description.md`
- Modify: `pack/stubs.jsonc`
- Create (compiled): `skills/writing-style-structured/`

**Interfaces:**
- Consumes: include `writing-style-floor`.
- Produces: skill `mattstack:writing-style-structured`.

- [ ] **Step 1: Write the engine**

`attachments/writing-style/writing-style-structured/SKILL.md`:

`````markdown
---
name: writing-style-structured
description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-structured. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: labelled lines and short bullets for teams that prefer formal write-ups."
type: pipeline-step
---

# Structured

Clear and scannable, for teams that like formal write-ups. Every point is
labelled so a reader can triage without reading the whole thing. Load this
before the first draft and write in it from the first word.

{{include:writing-style-floor}}

## Voice

- **Sentence case**, complete but short sentences.
- **Labels over prose.** A finding is a few labelled lines, not paragraphs.
- **Neutral and precise.** No hedging filler; state confidence once
  ("Likely", "Confirmed") when it matters.
- **Short bullets allowed** in a comment with more than one point, three at
  most.

Compression target: every line earns its label. Cut any line a reader could
skip without missing the ask.

## Review findings

Open with a bolded Conventional Comments label, never a code span, then
labelled lines:

````
**issue:** Settings leak across tenants.
Why: the cache is keyed on `userId` alone, and user ids repeat across tenants (`src/users/ids.ts:14`).
Impact: confirmed in seed data, t2's u7 gets t1's settings.
Suggestion: key on both ids.

```ts
const key = `${tenantId}:${userId}`;
```
````

Use only the lines that carry something: a `nitpick` is the label and one
line. A process ask is one line.

## Review summary

One line: `No blockers. Inline notes on cache keys and tests.` Only a blocker
joins it: `One blocker inline (tenant leak).`

## Replies on your own PR

One or two sentences, plain and direct. No thanks opener. State the outcome
first.

- `Changed to Record<Status, string>.`
- `Keeping it synchronous: nothing loads labels from the API yet, and async would change six callers.`

## PR descriptions

Read `${CLAUDE_SKILL_DIR}/pr-description.md` before drafting.

## Commit messages

- Subject: imperative, sentence case, under 72 characters, with the ticket
  key when the repo uses them (`ABC-123: Key settings cache on tenant`).
- Body: a blank line, then one to three lines on why, wrapped at 72.
`````

- [ ] **Step 2: Write the companion**

`attachments/writing-style/writing-style-structured/pr-description.md`:

````markdown
# PR descriptions (structured)

If the repo has a PR or MR template, keep every section and fill each in
this voice. Otherwise use the shape below.

## Length

About 200 to 300 words. Past 350, cut.

## Shape

```markdown
<ticket key>: <Title in sentence case>

## Summary

<Two sentences: what and why.>

## Changes

- <Area>: <one clause>

## Testing

- <Tests added or run, with counts>
- <A specific case checked by hand and what was seen>

## Follow-up

- <Descoped item or ticket>
```

## Rules

- Omit Follow-up when empty.
- One clause per bullet, files and symbols in backticks.
- Test counts, not logs; links as a flat list under Testing.
- Never restate the ticket, paste diffs, or leave placeholders.
````

- [ ] **Step 3: Roster, compile, read in full**

Add to `pack/stubs.jsonc`:

```jsonc
"writing-style-structured": {
  "engine": "writing-style-structured",
  "description": "Use only when the mattstack writing-style lookup names mattstack:writing-style-structured. The voice for review comments, replies, PR descriptions and commit messages posted under the operator's name: labelled lines and short bullets for teams that prefer formal write-ups."
}
```

Add `"writing-style-structured"` to `surface.jsonc`'s `"public"` list before
compiling (same reason as Task 3 Step 3).

Run: `rt skills compile --pack mattstack --pack-dir "$PWD" --verb writing-style-structured`
Read `skills/writing-style-structured/SKILL.md` in full. Expected: as in Task 3
Step 4.

- [ ] **Step 4: GREEN run and review**

Dispatch the structured run per `protocol.md`, then
`check-floor.sh outputs/structured`. Expected: `ok floor`.

Controller checks: labelled finding lines; nitpick one line; missing-test
finding its own comment; summary one line; replies lead with the outcome;
3b keeps the template's sections; 3a uses Summary, Changes, Testing and
Follow-up. Any miss: tighten, recompile, rerun.

- [ ] **Step 5: Certify and commit**

Run: `sh tests/certify.sh attachments/writing-style/writing-style-structured` and
`sh tests/certify.sh skills/writing-style-structured`. Expected: all `ok`.

```bash
git add attachments/writing-style/writing-style-structured pack/stubs.jsonc surface.jsonc skills/writing-style-structured docs/superpowers/tests/2026-09-22-writing-style-presets
git commit -m "writing-style: structured preset"
```

---

### Task 6: Surface, version, gates, PR, release

**Files:**
- Modify: `surface.jsonc`
- Modify: `.claude-plugin/plugin.json` (version bump)
- Modify: `CERTIFICATION.md` (ledger rows)

- [ ] **Step 1: Confirm the surface**

`surface.jsonc`'s `"public"` list already holds `"writing-style-sparse"`,
`"writing-style-conversational"` and `"writing-style-structured"` (added in
Tasks 3 to 5), and `attachments/` holds no compiled `writing-style-*`
directory at the top level.

- [ ] **Step 2: Rebase, then bump the plugin**

Another lane (the respond-post-per-thread work) bumps `plugin.json` and adds
`CERTIFICATION.md` rows on `main` first. Run `git fetch origin && git rebase
origin/main`, keep both sides' ledger rows on conflict, then bump
`.claude-plugin/plugin.json` `version` one minor above what `main` carries
(for example `0.17.22` to `0.18.0`).

- [ ] **Step 3: Recompile and check**

Run: `rt skills compile --pack mattstack --pack-dir "$PWD"` then
`rt skills check --pack mattstack --pack-dir "$PWD"`
Expected: check reports no drift. Read all three compiled presets in full one
last time.

- [ ] **Step 4: Gates**

Run: `sh tests/repo-purity.sh`, then `sh tests/certify.sh` on each of
`attachments/writing-style-floor`, the three engines, and the three compiled
skills.
Expected: all `ok`. Add ledger rows to `CERTIFICATION.md` in the table's
existing format.

- [ ] **Step 5: Commit, push, PR**

```bash
git add surface.jsonc .claude-plugin/plugin.json CERTIFICATION.md skills
git commit -m "writing-style: publish presets, bump plugin"
git push -u origin writing-style-presets
gh pr create --title "writing-style presets: sparse, conversational, structured" --body "<summary of the three presets, the floor include, the fixture results table, and the plugin bump>"
```

Wait for CodeRabbit's review and address every actionable finding, and wait
for CI to go green. Merge only with the operator's confirmation.

- [ ] **Step 6: Release to the cache**

After merge, from the canonical checkout on `main`:
Run: `rt skills sync --pack mattstack`
Expected: the engine cache update runs and reports `restartNeeded`.
Run: `ls ~/.claude/plugins/cache/mattstack/mattstack/`
Expected: the new version is listed, and its `skills/` holds the three
`writing-style-*` directories, each with `pr-description.md`.
