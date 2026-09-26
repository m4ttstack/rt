# Review Gate Shapes (apps side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `board:review` opens the emitter's handed-back structured `review-post` open, and the board renders review gates only from `review@1`/`findings@1` structured context, with both regex parsers (`gate-context.ts`, `finding-option.ts`) deleted; plus a scope addition, the queue modal's one-row head and a step nav pinned to its footer.

**Architecture:** The wrapper skill vendors `board:respond`'s `open-gate.sh` and gains the same hand-back branch, pane-form prose flatten, and degraded-mode rule. On the renderer side, `parseGateCtx` (string-only) grows two union members; a new `review-gate.ts` owns the one-to-one join against options and is the routing predicate; `ReviewGateSheet` reads rows and header from the joined shapes; every other surface renders a non-structured context as plain markdown and never pours structured JSON out raw.

**Tech Stack:** React 19, `@mattstack/tui-kit` (Markdown, Chip, Modal, ScrollPane), `@mattstack/gate-kit` (collapseChunks, optionValue, optionDisplayFor), bun:test + happy-dom DOM tests, Playwright capture harness, POSIX sh + jq for the skill script.

**Spec:** `docs/superpowers/specs/2026-09-22-review-gate-shapes-design.md`, which extends `docs/superpowers/specs/2026-09-21-respond-gate-context-design.md` (the base spec, amendments included). Read both before any task. Where this plan and the spec disagree, the spec wins.

## Global Constraints

- Write fence: only `apps/board/**`, `docs/superpowers/plans/**`, `.superpowers/**`. No gate-kit, tui-kit, rt-client, daemon, or board-server change.
- `parseGateCtx` stays string-only: it never sees options. The one-to-one join lives in the routing predicate.
- All base-spec parse rules apply to the new shapes: unknown keys ignored, a missing or wrong-typed required field fails the whole parse to `null`, no partial parses.
- Routing (verbatim from the spec): a gate reaches the ReviewGateSheet if and only if its kind is `review-post`, its gate context parses as `review@1`, and EVERY `findings-*` question's context parses as `findings@1` AND joins one-to-one by `id` == option value. Anything else renders in the generic modal.
- A context that is not valid gate-ctx renders as plain markdown: no enrichment guessing, anywhere, for any gate kind, and no option-label parsing.
- The degraded option recipe is pinned: label `[Severity] title`, description `anchor · fix gist · kind:<word>`, exactly as `board:review` emits it today. Nothing here reshapes it.
- This repo is PUBLIC. Every name, path, MR title, and finding text in tests, stories, and fixtures is invented. No real-gate text (`rt gate list --json` is read-only reference, never pasted). `./scripts/repo-purity.sh` must pass.
- Clean-code comments: a comment states a constraint the code cannot show. No narration, no task numbers, no review history, no ticket ids in source.
- No em dashes or en dashes anywhere (code, comments, CSS, skill text, commit messages). Use "..." or rephrase. Existing dashes in untouched lines stay as they are.
- UI colour and type follow `docs/ui-authoring.md`: tokens by role (the board aliases `--text-1..4`, `--text-<hue>-small`, `--fill-<hue>`), no raw colour values, font weights 400/500/700 only in new CSS.
- `bun run tui-kit:build` must run before any board gate (board consumes tui-kit's `dist/`).
- Gates, from the repo root: `bun run board:typecheck && bun run board:test && bun run lint && bun run board:build && bun run format:check && ./scripts/repo-purity.sh`.
- Run `bunx prettier --write <files you touched>` before each commit (the root has an import-sorting plugin).
- Commit at the end of every task, more often when a task has several commit steps. Never push.

## Derived decisions (the spec leaves these open)

1. **`findings-*` membership.** A question is a findings question when its id starts with `findings-` (spec-literal). Duplicate option values in a question, duplicate entry ids, or the same id in two chunks all fail the join. Non-findings questions' contexts are not checked.
2. **Routing lives in a new `review-gate.ts`**, beside the helpers the sheet and the generic modal share. `isReviewSheetGate` moves there from `ReviewGateSheet.tsx`.
3. **Wire names kept verbatim in the TS types** (`re_review`, `prior.still_open`): no mapping layer, matching the verdict-vocabulary precedent.
4. **Strictness** mirrors the base parser: required strings non-empty; counts non-negative integers; `round` an integer of at least 1; `re_review` a boolean when present; optional strings (`reviewer`, `file`, `fix`, `evidence`) are strings when present, and an empty one renders as absent.
5. **The sheet's decision card reads `review@1` only** (readiness, summary, severity counts). `report.json` keeps feeding the record cluster (strengths, depth, notes) and the checks card; its `summary` is no longer read.
6. **Severity display.** Groups render in the fixed order critical, important, minor. Display labels `Critical`/`Important`/`Minor` keep the existing `data-tier` CSS hooks. Group heads count the joined entries; the rail pills count `review@1.findings` (zero severities omitted).
7. **Row anatomy (the rows grow within the approved layout):** line 1 is the title plus the disposition pill (the slot the kind chip held); then accent `file`; then the full `body` through Markdown in ink (`--text-1`); then `fix` on the existing muted line. The kind chip and the no-anchor label go: neither exists in `findings@1`. `evidence` is parsed but not rendered, because the spec's row list omits it. Flag at the plan milestone.
8. **Disposition pill** reuses `.tui-respond-pill` (the board's small uppercase tag): `new` accent "new", `still-open` amber "still open", `addressed-check` green "confirm fix". It renders whenever the entry carries a disposition. Flag the wording at the plan milestone.
9. **Re-review header data:** one muted meta line in the decision card under the summary: `<reviewer> · round <n> · <a> addressed, <s> still open`, each part present only when its field is; `re-review` stands in for the tally when `re_review` is true with no `prior`. Flag at the plan milestone.
10. **Parsed but unrouted review shapes in the generic modal.** Answered and stuck review-post gates take the generic modal every time (the sheet only hosts actionable gates), and a join failure lands there too. There, a gate-level `review@1` renders as flattened markdown (`reviewProse`) in the existing Decision context pane, never raw JSON; a question context that parses as any gate-ctx shape with no card on that surface (`findings@1` included) renders nothing, and the options' pinned labels and descriptions carry the findings. GateForm's bare-host fallback follows the same rule.
11. **Vendored `open-gate.sh`.** `board:review` gets a byte-identical copy of `board:respond`'s script (the vendoring convention `resolve-args.sh` already follows), header comment generalized in both copies, and a test pins the identity.
12. **Source-file derivation for the pane form:** the fitted open file's name with `.open.json` swapped for `.source.json`, the pairing `receive-review` already uses (`respond-plan.open.json` / `respond-plan.source.json`).
13. **Fixture and captures.** `!1271`'s review-post gate becomes the structured one (round 2 re-review, five findings across two chunks, every disposition) and gets a new `reviewsheet-{light,dark}` shot. `!1235`'s legacy review-post gate (prose context, tier options) is the prose-fallback shot, `queue-{light,dark}`. `queuegroups-*` is dropped with the grouping.
14. **Scope addition (Matt, via the shepherd, 2026-09-22): the queue modal's chrome.** (a) The step nav (previous / reset / next / submit, plus its error lines) leaves the scrolling body and pins into the modal's fixed footer beside the pips, for every face GateForm renders in the queue (respond faces, legacy and unrouted review-post gates, everything questionnaire-shaped). (b) The two top bands (title row, then the focus pane / skip gate row) fold into ONE head row: "decision queue" left; focus pane, skip gate, the parked/escalated chips, and close right; the action buttons drop from `size="lg"` to `size="sm"`.
15. **How the nav leaves the form.** `GateForm` takes an optional `actionsSlot` and renders its actions row through `createPortal` into it. React context survives a portal, so Previous / Next / Skip (context callbacks) keep working; the two native buttons that need the `<form>` (submit, reset) carry `form={formId}`, and `Questionnaire.Root` gets `id={formId}`. `actionsSlot` undefined means an inline row (bare hosts, stories, tests); `null` means the host's footer has not mounted yet, so nothing renders for that one pass.
16. **Footer layout.** One wrapping flex row: pips + "gate N of M" left, the next-gate peek in the middle (flexes, wraps, muted), the nav right. Faces with no step nav (answered chip, delivery card, attention card, the lost face) keep their one action inline: it is part of their message, and the ruling names the step nav.
17. **The review sheet already complies**: its head is one row and its verdict block sits below the rail's scroll region. Task 7 adds a real-layout guard that its submit stays on screen at the short viewport.

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `apps/board/skills/respond/scripts/open-gate.sh` | Modify | header comment generalized (line 2 only) |
| `apps/board/skills/review/scripts/open-gate.sh` | Create | byte-identical vendored copy |
| `apps/board/skills/review/scripts/open-gate.test.ts` | Create | identity + SKILL.md wiring tests |
| `apps/board/skills/review/SKILL.md` | Modify | hand-back branch, delegation, pane-form flatten, degraded mode, deleted-parser references reworded |
| `apps/board/src/client/board/gate-ctx.ts` | Modify | `review@1`, `findings@1` types and readers |
| `apps/board/src/client/board/__tests__/gate-ctx.test.ts` | Modify | parser tests for both shapes |
| `apps/board/src/client/board/review-gate.ts` | Create | `readReviewGate`, `isReviewSheetGate`, severity helpers, `readinessProse`, `reviewMeta`, `reviewProse`, `paneContext` |
| `apps/board/src/client/board/__tests__/review-gate.test.ts` | Create | join, routing, prose helpers |
| `apps/board/src/client/board/__tests__/review-routing-dom.test.tsx` | Create | DecisionQueueModal routes sheet vs generic modal |
| `apps/board/src/client/board/ReviewGateSheet.tsx` | Modify | rows and header from parsed shapes |
| `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx` | Modify | structured fixtures; row, pill, header tests |
| `apps/board/src/client/board/ReviewGateSheet.stories.tsx` | Modify | structured fixtures, a re-review story |
| `apps/board/src/client/board/finding-option.ts` + `__tests__/finding-option.test.ts` | Delete | |
| `apps/board/src/client/board/icons.tsx` | Modify | drop `NoAnchorIcon` (its only consumer goes) |
| `apps/board/src/client/board/GateForm.tsx` | Modify | QuestionContext and every sectioned branch deleted; structured question contexts never raw |
| `apps/board/src/client/board/DecisionQueueModal.tsx` | Modify | GroupedContext, OverviewStrip, sectioned/grouped branches deleted; `paneContext` |
| `apps/board/src/client/board/gate-context.ts`, `src/__tests__/gate-context.test.ts`, `src/__tests__/gate-context-groups.test.ts` | Delete | |
| `apps/board/src/client/board/__tests__/plain-context-dom.test.tsx` | Create | plain-markdown fallback tests |
| `apps/board/src/client/board/__tests__/decision-queue-dom.test.tsx` | Modify | drop the three sectioned/grouped tests |
| `apps/board/src/client/board/__tests__/respond-header-dom.test.tsx` | Modify | drop the `.tui-triage-overview` assertion |
| `apps/board/src/client/board/__tests__/gate-form-context-fallback-dom.test.tsx` | Modify | comment; `review@1` fallback case |
| `apps/board/src/style.css` | Modify | new row/meta CSS; dead CSS removed |
| `apps/board/src/client/board/GateForm.tsx` (again, Task 6) | Modify | `actionsSlot` prop: the step nav portals into the host's footer; form id for the portaled submit/reset |
| `apps/board/src/client/board/DecisionQueueModal.tsx` (again, Task 6) | Modify | one-row head (title + compact actions + close); footer nav slot |
| `apps/board/src/client/board/__tests__/triage-chrome-dom.test.tsx` | Create | nav lives in the footer and still drives the form; one-row head |
| `apps/board/tests/decision-queue-context-layout.test.ts` | Modify | real-layout laws: nav pinned on a short viewport, head one row; the sheet's submit on screen (Task 7) |
| `apps/board/tests/fixture/data.json`, `tests/fixture/README.md` | Modify | structured `!1271` gate |
| `apps/board/tests/capture.ts`, `tests/baselines/*.png` | Modify | `reviewsheet-*`, retargeted `queue-*`, `queuegroups-*` dropped, all re-pinned |

---

### Task 0: Baseline (controller, already done)

Recorded before planning: `bun install` (no changes), `bun run tui-kit:build`, `bun run board:typecheck` exit 0, `bun run board:test` 1909 pass / 1 skip / 0 fail. Capture baselines are known stale on main (every view predates the theme work), which Task 7 addresses by re-pinning.

---

### Task 1: board:review opens the handed-back structured open

**Files:**
- Modify: `apps/board/skills/respond/scripts/open-gate.sh:2`
- Create: `apps/board/skills/review/scripts/open-gate.sh`
- Create: `apps/board/skills/review/scripts/open-gate.test.ts`
- Modify: `apps/board/skills/review/SKILL.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `"${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> review-post <open-file>` as the wrapper's open path for a handed-back file.

This task edits a skill. REQUIRED SUB-SKILLS before touching SKILL.md: superpowers:writing-skills (RED-GREEN for skills) and mattstack:editing-skills (how board skills reach an installed surface). The pressure-scenario results go in your task report, never in the skill text.

- [ ] **Step 1: RED for the skill text (baseline behaviour)**

Save the current skill: `git show HEAD:apps/board/skills/review/SKILL.md > <scratchpad>/review-SKILL.before.md`.

Dispatch three fresh subagents (general-purpose, same model as you) with this prompt, `<skill>` being the saved file's path:

```
Read <skill>. You are the agent running that wrapper skill, mid-run, on a
fresh review (no --resumed-gate, no --re-review). You invoked the domain
skill; it wrote the report to /tmp/rv-demo/report.md and handed back:
"severity levels present: important, minor. Fitted review-post open file:
/tmp/rv-demo/review-post.open.json (fits: true)."
The status-bin is /tmp/bin/board-status; the state handle is
/board/review/31.json; CLAUDE_SKILL_DIR is /skills/review.
Do NOT run anything. Reply with exactly two numbered answers:
(1) the exact shell command(s) you run next to open the gate;
(2) if that open prints presentation "form", exactly what you show in the
pane and what each form question's text is.
```

Record each reply. Expected baseline failure: (1) builds questions from the report's `.json` and runs its own `gate open --questions ...` (or reads the open file ad hoc with jq, skipping the budget rule); (2) has no rule for the structured contexts, so the form shows JSON or drops the finding text. If all three already comply, stop and report: there is nothing to fix in the text.

- [ ] **Step 2: Write the failing wiring test**

Create `apps/board/skills/review/scripts/open-gate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

test("the vendored open-gate.sh is byte-identical to board:respond's", () => {
  const review = readFileSync(here('./open-gate.sh'));
  const respond = readFileSync(here('../../respond/scripts/open-gate.sh'));
  expect(review.equals(respond)).toBe(true);
});

test('board:review allows and names its vendored open-gate.sh', () => {
  const skill = readFileSync(here('../SKILL.md'), 'utf8');
  expect(skill).toContain('Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)');
  expect(skill).toContain(
    '"${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> review-post <open-file>'
  );
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/board && bun test skills/review/scripts/open-gate.test.ts`
Expected: FAIL (ENOENT on `./open-gate.sh`, and the SKILL.md strings are absent).

- [ ] **Step 4: Vendor the script**

In `apps/board/skills/respond/scripts/open-gate.sh`, change line 2 only:

```sh
# open-gate.sh -- open a board gate from a domain skill's fitted open file.
```

Then copy it: `cp apps/board/skills/respond/scripts/open-gate.sh apps/board/skills/review/scripts/open-gate.sh && chmod +x apps/board/skills/review/scripts/open-gate.sh`.

- [ ] **Step 5: GREEN: edit `apps/board/skills/review/SKILL.md`**

(a) Frontmatter, replace the `allowed-tools` line with:

```yaml
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*), Bash(${CLAUDE_SKILL_DIR}/scripts/open-gate.sh:*)
```

(b) Step 2's domain-skill bullet: replace its three lines from `slot per "Resolving the domain skill"): invoke that skill with the MR url and the` through `the severity levels present in its findings. It never presents posting` (the two in between carry the file's existing em dashes; the rewrite drops them) with

```
     slot per "Resolving the domain skill"): invoke that skill with the MR url and the
     `--report <path>`, telling it that this wrapper owns the gate, so it
     opens nothing: it hands back instead, including the absolute path of
     the fitted `review-post` open file when it builds one. It owns the
     actual review (resolving the MR/ticket, producing the draft, and
     writing the report), then reports back to you the severity levels
     present in its findings, plus that open file's path when it built
     one. It never presents posting
```

(c) Step 4, insert this bullet immediately BEFORE the `- **Build the questions.**` bullet:

````
   - **Handed a fitted open file?** Then that file IS this gate:
     `gate-ctx.sh fit` output whose `.context` carries the review's
     structured summary and whose `findings-N` questions each carry their
     findings' structured context, with options already in the recipe
     below. Open it with:

     ```bash
     "${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" <status-bin> <state> review-post <open-file>
     ```

     It prints the same one-line `{"gateId": ..., "presentation": ...}` as
     `gate open` and exits with its status. A `fits: false` file is still
     over the shared context budget; the script drops whole question
     contexts, largest first, until it fits, so the file goes in untouched:
     never rebuilt, re-ordered, trimmed, or hand-edited. Skip "Build the
     questions" and "Open the gate" below and go to the presentation
     branches.
````

(d) Rename the next bullet's lead from `- **Build the questions.**` to `- **Otherwise, build the questions yourself.**` (the rest of that bullet stays).

(e) In the **Option shape** paragraph, replace

```
       the report's `kind` value verbatim. `<word>` must be lowercase and
       hyphens only -- `finding-option.ts`'s `KIND_RE` is the parser's whole
       vocabulary for it, so normalize anything else (case, spaces,
       underscores) to that shape before it rides the description.
```

with

```
       the report's `kind` value verbatim. `<word>` must be lowercase and
       hyphens only, the pinned format's whole vocabulary for it, so
       normalize anything else (case, spaces, underscores) to that shape
       before it rides the description.
```

and replace

```
       anchor and never the trailing kind suffix -- `finding-option.ts`'s
       parser reads the kind suffix off the literal end of the string.
```

with

```
       anchor and never the trailing kind suffix, which the pinned format
       keeps at the literal end of the string. This option recipe is pinned:
       a fitted open's options carry the same one, and surfaces without a
       card renderer read it, so it never changes shape.
```

(f) At the end of the **presentation "form"** bullet (after "...which the daemon records."), append:

```
     A gate opened from a fitted file never shows its JSON in the form:
     run the `gate-ctx.sh` the domain skill fitted it with in `prose` mode
     on the source file beside it (the open file's name with `.open.json`
     swapped for `.source.json`: `sh <gate-ctx.sh> prose <
     <dir>/review-post.source.json`), print its `.context` as one pane line
     before the form call, and make each `findings-N` question's form text
     its label, a newline, then its prose `context`. Options keep the
     gate's labels and descriptions.
```

(g) In the **Degraded mode** bullet, after "rendered by the same mechanical rules as presentation "form" above", insert ", a fitted file flattened to prose exactly as that branch describes,".

Run `wc -w apps/board/skills/review/SKILL.md` and note the growth in your report.

- [ ] **Step 6: Run the wiring test and the skills suite**

Run: `cd apps/board && bun test skills/ src/__tests__/skills-resolve.test.ts`
Expected: PASS (both new tests, respond's `open-gate.test.ts` unchanged and green, slot-resolution tests green).

- [ ] **Step 7: GREEN for the skill text (same scenario, edited skill)**

Re-run Step 1's prompt with `<skill>` = `apps/board/skills/review/SKILL.md`, three fresh subagents. Pass criteria, every rep: (1) the command is `"${CLAUDE_SKILL_DIR}/scripts/open-gate.sh" /tmp/bin/board-status /board/review/31.json review-post /tmp/rv-demo/review-post.open.json` (or the same with `/skills/review` expanded), with no rebuild from the report; (2) runs `gate-ctx.sh prose` on `/tmp/rv-demo/review-post.source.json`, prints its `.context` as one line, and each findings question's text is label, newline, prose context. Then one control rep with the handed-back line removed from the prompt: it must still build the questions from the report's `.json` per the unchanged recipe. Any failure: tighten the wording (recipe form, not prohibitions; see writing-skills "Match the Form to the Failure"), re-run all reps.

- [ ] **Step 8: Commit**

```bash
bunx prettier --write apps/board/skills/review/scripts/open-gate.test.ts apps/board/skills/review/SKILL.md
git add apps/board/skills/respond/scripts/open-gate.sh apps/board/skills/review/scripts/open-gate.sh apps/board/skills/review/scripts/open-gate.test.ts apps/board/skills/review/SKILL.md
git commit -m "board:review: open handed-back review-post files through a vendored open-gate.sh"
```

(If prettier reflows SKILL.md prose, check the diff reads cleanly before committing.)

---

### Task 2: parseGateCtx grows review@1 and findings@1

**Files:**
- Modify: `apps/board/src/client/board/gate-ctx.ts`
- Test: `apps/board/src/client/board/__tests__/gate-ctx.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `gate-ctx.ts`):

```ts
export type Readiness = 'yes' | 'no' | 'with-fixes';
export type FindingSeverity = 'critical' | 'important' | 'minor';
export type Disposition = 'new' | 'still-open' | 'addressed-check';
export interface ReviewCtx {
  shape: 'review@1';
  reviewer?: string;
  readiness: Readiness;
  summary: string;
  findings: Record<FindingSeverity, number>;
  round?: number;
  re_review: boolean;
  prior?: { addressed: number; still_open: number };
}
export interface FindingEntry {
  id: string;
  severity: FindingSeverity;
  title: string;
  body: string;
  file?: string;
  fix?: string;
  evidence?: string;
  disposition?: Disposition;
}
export interface FindingsCtx { shape: 'findings@1'; findings: FindingEntry[] }
export type GateCtx = PlanCtx | PostCtx | ThreadCtx | RepliesCtx | ReviewCtx | FindingsCtx;
```

- [ ] **Step 1: Write the failing tests**

In `gate-ctx.test.ts`, after the `REPLIES` constant add:

```ts
const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary:
    'mechanism verified against the pinned deps; tests substantiate both criteria.',
  findings: { critical: 0, important: 1, minor: 4 },
  round: 2,
  re_review: true,
  prior: { addressed: 3, still_open: 1 },
} as const;

const FINDING = {
  id: 'f1',
  severity: 'important',
  title: 'retry fix is parity wiring, not a live fix',
  file: 'queue/enqueue.ts:81',
  body: 'the guard only runs on the parity path; the live path still re-enqueues.',
  fix: 'note it is parity wiring in the doc comment',
  evidence: 'enqueue.test.ts: 4 pass, 0 fail',
  disposition: 'new',
} as const;

const FINDINGS = {
  'gate-ctx': 'findings@1',
  findings: [
    FINDING,
    {
      id: 'f2',
      severity: 'minor',
      title: 'test over-specifies the ordering',
      body: 'asserts exact call order where the contract only promises the set.',
    },
  ],
} as const;
```

Inside `describe('valid shapes', ...)` add:

```ts
  test('review@1', () => {
    expect(parseGateCtx(j(REVIEW))).toEqual({
      shape: 'review@1',
      reviewer: 'renee',
      readiness: 'with-fixes',
      summary: REVIEW.summary,
      findings: { critical: 0, important: 1, minor: 4 },
      round: 2,
      re_review: true,
      prior: { addressed: 3, still_open: 1 },
    });
  });

  test('review@1 minimal: absent severities read 0, re_review reads false, no optional keys', () => {
    expect(
      parseGateCtx(
        j({
          'gate-ctx': 'review@1',
          readiness: 'yes',
          summary: 'clean.',
          findings: {},
        })
      )
    ).toEqual({
      shape: 'review@1',
      readiness: 'yes',
      summary: 'clean.',
      findings: { critical: 0, important: 0, minor: 0 },
      re_review: false,
    });
  });

  test('review@1 accepts every readiness in the engine vocabulary', () => {
    for (const readiness of ['yes', 'no', 'with-fixes'])
      expect(parseGateCtx(j({ ...REVIEW, readiness }))).toMatchObject({
        readiness,
      });
  });

  test('findings@1', () => {
    expect(parseGateCtx(j(FINDINGS))).toEqual({
      shape: 'findings@1',
      findings: [
        { ...FINDING },
        {
          id: 'f2',
          severity: 'minor',
          title: 'test over-specifies the ordering',
          body: 'asserts exact call order where the contract only promises the set.',
        },
      ],
    });
  });

  test('findings@1 accepts every severity and disposition', () => {
    for (const severity of ['critical', 'important', 'minor'])
      for (const disposition of ['new', 'still-open', 'addressed-check'])
        expect(
          parseGateCtx(
            j({ ...FINDINGS, findings: [{ ...FINDING, severity, disposition }] })
          )
        ).toMatchObject({ findings: [{ severity, disposition }] });
  });

  test('findings@1 with an empty list', () => {
    expect(
      parseGateCtx(j({ 'gate-ctx': 'findings@1', findings: [] }))
    ).toEqual({ shape: 'findings@1', findings: [] });
  });
```

Inside `describe('unknown extra keys are accepted and dropped', ...)` add:

```ts
  test('review@1 top level, counts, and prior', () => {
    const parsed = parseGateCtx(
      j({
        ...REVIEW,
        extra: 1,
        findings: { ...REVIEW.findings, nit: 2 },
        prior: { ...REVIEW.prior, extra: true },
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('extra');
    expect((parsed as { findings: object }).findings).not.toHaveProperty('nit');
    expect((parsed as { prior: object }).prior).not.toHaveProperty('extra');
  });

  test('inside a finding entry', () => {
    const parsed = parseGateCtx(
      j({ ...FINDINGS, findings: [{ ...FINDING, extra: 'x' }] })
    );
    expect(
      (parsed as { findings: object[] }).findings[0]
    ).not.toHaveProperty('extra');
  });
```

Append to the `cases` array in `describe('everything non-conforming returns null', ...)`:

```ts
    // review@1
    ['review: missing readiness', j({ ...REVIEW, readiness: undefined })],
    ['review: readiness outside the vocabulary', j({ ...REVIEW, readiness: 'ready' })],
    ['review: readiness a boolean', j({ ...REVIEW, readiness: true })],
    ['review: missing summary', j({ ...REVIEW, summary: undefined })],
    ['review: empty summary', j({ ...REVIEW, summary: ' ' })],
    ['review: missing findings', j({ ...REVIEW, findings: undefined })],
    ['review: findings an array', j({ ...REVIEW, findings: [1, 4] })],
    ['review: a count as a string', j({ ...REVIEW, findings: { minor: '4' } })],
    ['review: a negative count', j({ ...REVIEW, findings: { minor: -1 } })],
    ['review: a fractional count', j({ ...REVIEW, findings: { minor: 1.5 } })],
    ['review: reviewer not a string', j({ ...REVIEW, reviewer: 7 })],
    ['review: round zero', j({ ...REVIEW, round: 0 })],
    ['review: re_review a string', j({ ...REVIEW, re_review: 'true' })],
    ['review: prior null', j({ ...REVIEW, prior: null })],
    ['review: prior missing still_open', j({ ...REVIEW, prior: { addressed: 3 } })],
    ['review: prior.addressed negative', j({ ...REVIEW, prior: { addressed: -1, still_open: 1 } })],
    // findings@1
    ['findings: missing list', j({ 'gate-ctx': 'findings@1' })],
    ['findings: list not an array', j({ 'gate-ctx': 'findings@1', findings: {} })],
    ['findings: entry not an object', j({ ...FINDINGS, findings: ['f1'] })],
    ['findings: entry missing id', j({ ...FINDINGS, findings: [{ ...FINDING, id: undefined }] })],
    ['findings: entry missing title', j({ ...FINDINGS, findings: [{ ...FINDING, title: undefined }] })],
    ['findings: entry missing body', j({ ...FINDINGS, findings: [{ ...FINDING, body: undefined }] })],
    ['findings: entry empty body', j({ ...FINDINGS, findings: [{ ...FINDING, body: '' }] })],
    ['findings: severity outside the vocabulary', j({ ...FINDINGS, findings: [{ ...FINDING, severity: 'nit' }] })],
    ['findings: severity in the label casing', j({ ...FINDINGS, findings: [{ ...FINDING, severity: 'Important' }] })],
    ['findings: file not a string', j({ ...FINDINGS, findings: [{ ...FINDING, file: 81 }] })],
    ['findings: fix null', j({ ...FINDINGS, findings: [{ ...FINDING, fix: null }] })],
    ['findings: evidence not a string', j({ ...FINDINGS, findings: [{ ...FINDING, evidence: 7 }] })],
    ['findings: unknown disposition', j({ ...FINDINGS, findings: [{ ...FINDING, disposition: 'fixed' }] })],
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/gate-ctx.test.ts`
Expected: FAIL (the valid-shape tests get `null`; the null cases already pass because unknown tags are rejected today).

- [ ] **Step 3: Implement**

In `gate-ctx.ts`: add the exported types from **Interfaces** after `RepliesCtx`, and widen `GateCtx`. Add the vocabularies beside the existing ones:

```ts
const READINESS = ['yes', 'no', 'with-fixes'] as const;
const FINDING_SEVERITIES = ['critical', 'important', 'minor'] as const;
const DISPOSITIONS = ['new', 'still-open', 'addressed-check'] as const;
```

Add these helpers after `optRound`:

```ts
function optCount(v: unknown): number {
  return v === undefined ? 0 : count(v);
}

function optFlag(v: unknown): boolean {
  if (v === undefined) return false;
  return typeof v === 'boolean' ? v : reject();
}
```

Add the readers after `readReplies`:

```ts
function readReview(o: Obj): ReviewCtx {
  const findings = obj(o.findings);
  const reviewer = optStr(o.reviewer);
  const round = optRound(o.round);
  const prior = o.prior === undefined ? undefined : obj(o.prior);
  return {
    shape: 'review@1',
    ...(reviewer !== undefined ? { reviewer } : {}),
    readiness: oneOf(o.readiness, READINESS),
    summary: str(o.summary),
    findings: {
      critical: optCount(findings.critical),
      important: optCount(findings.important),
      minor: optCount(findings.minor),
    },
    ...(round !== undefined ? { round } : {}),
    re_review: optFlag(o.re_review),
    ...(prior
      ? {
          prior: {
            addressed: count(prior.addressed),
            still_open: count(prior.still_open),
          },
        }
      : {}),
  };
}

function readFinding(v: unknown): FindingEntry {
  const e = obj(v);
  const file = optStr(e.file);
  const fix = optStr(e.fix);
  const evidence = optStr(e.evidence);
  const disposition =
    e.disposition === undefined ? undefined : oneOf(e.disposition, DISPOSITIONS);
  return {
    id: str(e.id),
    severity: oneOf(e.severity, FINDING_SEVERITIES),
    title: str(e.title),
    body: str(e.body),
    ...(file !== undefined ? { file } : {}),
    ...(fix !== undefined ? { fix } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    ...(disposition !== undefined ? { disposition } : {}),
  };
}

function readFindings(o: Obj): FindingsCtx {
  const findings = o.findings;
  if (!Array.isArray(findings)) reject();
  return { shape: 'findings@1', findings: findings.map(readFinding) };
}
```

Register both in `READERS`:

```ts
  ['review@1', readReview],
  ['findings@1', readFindings],
```

Update the file's header comment only if it names the four shapes (it does not today; leave it).

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/gate-ctx.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
bunx prettier --write apps/board/src/client/board/gate-ctx.ts apps/board/src/client/board/__tests__/gate-ctx.test.ts
git add apps/board/src/client/board/gate-ctx.ts apps/board/src/client/board/__tests__/gate-ctx.test.ts
git commit -m "board: parse review@1 and findings@1 gate contexts"
```

---

### Task 3: The routing predicate

**Files:**
- Create: `apps/board/src/client/board/review-gate.ts`
- Create: `apps/board/src/client/board/__tests__/review-gate.test.ts`
- Create: `apps/board/src/client/board/__tests__/review-routing-dom.test.tsx`
- Modify: `apps/board/src/client/board/ReviewGateSheet.tsx` (remove `isReviewSheetGate` and its doc comment, lines 99-111)
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx:25` (import)
- Modify: `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx` (drop the moved routing test)

**Interfaces:**
- Consumes: Task 2's `parseGateCtx`, `ReviewCtx`, `FindingEntry`, `FindingSeverity`, `Readiness`.
- Produces (exported from `review-gate.ts`):

```ts
export const SEVERITY_ORDER: readonly FindingSeverity[];      // critical, important, minor
export const SEVERITY_LABEL: Record<FindingSeverity, string>; // Critical, Important, Minor
export interface ReviewGate { review: ReviewCtx; findings: Map<string, FindingEntry> }
export function isFindingsQuestion(q: { id: string }): boolean;
export function readReviewGate(gate: Pick<GateRow, 'kind' | 'context' | 'questions'>): ReviewGate | null;
export function isReviewSheetGate(gate: Pick<GateRow, 'kind' | 'context' | 'questions'>): boolean;
export function readinessProse(readiness: Readiness): string;      // "Ready to merge: with fixes"
export function severityTally(counts: Record<FindingSeverity, number>): string; // "1 important, 4 minor" | "no findings"
export function reviewMeta(review: ReviewCtx): string;             // "renee · round 2 · 3 addressed, 1 still open" | ""
export function reviewProse(review: ReviewCtx): string;            // markdown for the generic modal
export function paneContext(context: string | undefined): string | undefined;
```

- [ ] **Step 1: Write the failing unit tests**

Create `apps/board/src/client/board/__tests__/review-gate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { GateQuestion } from '@mattstack/gate-kit';
import type { GateRow } from '../../../gates/store.ts';
import type { ReviewCtx } from '../gate-ctx.ts';
import {
  isReviewSheetGate,
  paneContext,
  readReviewGate,
  reviewMeta,
  reviewProse,
  severityTally,
} from '../review-gate.ts';

const j = (v: unknown) => JSON.stringify(v);

const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary: 'the guard only covers the parity path.',
  findings: { important: 1, minor: 2 },
};

const entry = (id: string, severity: string) => ({
  id,
  severity,
  title: `title ${id}`,
  body: `body ${id}`,
});
const findingsCtx = (...entries: object[]) =>
  j({ 'gate-ctx': 'findings@1', findings: entries });
const option = (value: string) => ({
  value,
  label: `[Minor] title ${value}`,
  description: `lib/a.ts:1 · fix ${value}`,
});

function gate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-9',
    subject: 'mr:https://gitlab.example.com/acme/app/-/merge_requests/9',
    kind: 'review-post',
    label: 'review',
    status: 'open',
    openedAt: 1,
    context: j(REVIEW),
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings to !9?',
        multi: true,
        context: findingsCtx(entry('f1', 'important'), entry('f2', 'minor')),
        options: [option('f1'), option('f2')],
      },
      {
        id: 'findings-2',
        label: 'Post which findings to !9?',
        multi: true,
        context: findingsCtx(entry('f3', 'minor')),
        options: [option('f3')],
      },
      {
        id: 'outcome',
        label: 'Verdict on !9',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    ...overrides,
  };
}

function withQuestion(at: number, patch: Partial<GateQuestion>): GateRow {
  const g = gate();
  return {
    ...g,
    questions: g.questions.map((q, i) => (i === at ? { ...q, ...patch } : q)),
  };
}

describe('readReviewGate', () => {
  test('joins every findings chunk to its options by id', () => {
    const read = readReviewGate(gate());
    expect(read?.review.shape).toBe('review@1');
    expect([...read!.findings.keys()]).toEqual(['f1', 'f2', 'f3']);
    expect(read!.findings.get('f3')?.body).toBe('body f3');
  });

  test('a clean review (outcome alone) routes', () => {
    expect(
      isReviewSheetGate(gate({ questions: [gate().questions[2]!] }))
    ).toBe(true);
  });

  test('a non-findings question context is never checked', () => {
    expect(
      isReviewSheetGate(withQuestion(2, { context: 'plain prose' }))
    ).toBe(true);
  });
});

describe('everything else stays in the generic modal', () => {
  const cases: [string, GateRow][] = [
    ['another gate kind', gate({ kind: 'respond-plan' })],
    [
      'a legacy prose gate context over pinned-format options',
      gate({ context: 'Findings: Important (1), Minor (2)' }),
    ],
    ['no gate context', gate({ context: undefined })],
    [
      'a gate context of another shape',
      gate({
        context: j({ 'gate-ctx': 'plan@1', reviewer: 'r', threads: { total: 1 } }),
      }),
    ],
    ['a findings chunk with prose context', withQuestion(1, { context: 'f3 prose' })],
    ['a findings chunk with no context', withQuestion(1, { context: undefined })],
    [
      'a findings chunk of another shape',
      withQuestion(1, { context: j({ 'gate-ctx': 'replies@1', replies: [] }) }),
    ],
    [
      'an entry with no option',
      withQuestion(1, {
        context: findingsCtx(entry('f3', 'minor'), entry('f9', 'minor')),
      }),
    ],
    [
      'an option with no entry',
      withQuestion(1, { options: [option('f3'), option('f4')] }),
    ],
    [
      'a duplicate entry id in one chunk',
      withQuestion(0, {
        context: findingsCtx(entry('f1', 'important'), entry('f1', 'minor')),
      }),
    ],
    [
      'the same id in two chunks',
      withQuestion(1, {
        context: findingsCtx(entry('f1', 'minor')),
        options: [option('f1')],
      }),
    ],
  ];
  for (const [name, row] of cases)
    test(name, () => {
      expect(readReviewGate(row)).toBeNull();
      expect(isReviewSheetGate(row)).toBe(false);
    });
});

describe('prose helpers', () => {
  const review: ReviewCtx = {
    shape: 'review@1',
    reviewer: 'renee',
    readiness: 'with-fixes',
    summary: 'the guard only covers the parity path.',
    findings: { critical: 0, important: 1, minor: 4 },
    round: 2,
    re_review: true,
    prior: { addressed: 3, still_open: 1 },
  };
  const bare: ReviewCtx = {
    shape: 'review@1',
    readiness: 'yes',
    summary: 'clean.',
    findings: { critical: 0, important: 0, minor: 0 },
    re_review: false,
  };

  test('severityTally names the non-zero severities in order', () => {
    expect(severityTally(review.findings)).toBe('1 important, 4 minor');
    expect(severityTally(bare.findings)).toBe('no findings');
  });

  test('reviewMeta carries reviewer, round, and the prior tally', () => {
    expect(reviewMeta(review)).toBe(
      'renee · round 2 · 3 addressed, 1 still open'
    );
    expect(reviewMeta({ ...review, prior: undefined })).toBe(
      'renee · round 2 · re-review'
    );
    expect(reviewMeta(bare)).toBe('');
  });

  test('reviewProse flattens the summary for a surface with no sheet', () => {
    expect(reviewProse(review)).toBe(
      '**Ready to merge: with fixes** · 1 important, 4 minor\n\n' +
        'renee · round 2 · 3 addressed, 1 still open\n\n' +
        'the guard only covers the parity path.'
    );
    expect(reviewProse(bare)).toBe(
      '**Ready to merge: yes** · no findings\n\nclean.'
    );
  });

  test('paneContext: prose as written, review@1 flattened, other shapes nothing', () => {
    expect(paneContext(undefined)).toBeUndefined();
    expect(paneContext('=== a ===\nprose')).toBe('=== a ===\nprose');
    expect(paneContext(j(REVIEW))).toContain('Ready to merge: with fixes');
    expect(
      paneContext(
        j({ 'gate-ctx': 'plan@1', reviewer: 'r', threads: { total: 1 } })
      )
    ).toBeUndefined();
    expect(paneContext(findingsCtx(entry('f1', 'minor')))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/review-gate.test.ts`
Expected: FAIL (cannot resolve `../review-gate.ts`).

- [ ] **Step 3: Implement `review-gate.ts`**

```ts
import { optionValue } from '@mattstack/gate-kit';
import type { GateRow } from '../../gates/store.ts';
import {
  parseGateCtx,
  type FindingEntry,
  type FindingSeverity,
  type Readiness,
  type ReviewCtx,
} from './gate-ctx.ts';

export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  'critical',
  'important',
  'minor',
];

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: 'Critical',
  important: 'Important',
  minor: 'Minor',
};

export interface ReviewGate {
  review: ReviewCtx;
  /** Every findings chunk's entries, keyed by the option value each joins. */
  findings: Map<string, FindingEntry>;
}

type ReviewGateInput = Pick<GateRow, 'kind' | 'context' | 'questions'>;

export function isFindingsQuestion(q: { id: string }): boolean {
  return q.id.startsWith('findings-');
}

/** The review sheet's whole input, or null when the gate is not a
    review-post whose gate context is review@1 and whose every findings
    chunk is findings@1 joined one-to-one to its own options. There is no
    half-joined sheet: any mismatch routes the whole gate elsewhere. */
export function readReviewGate(gate: ReviewGateInput): ReviewGate | null {
  if (gate.kind !== 'review-post') return null;
  const review = parseGateCtx(gate.context);
  if (review?.shape !== 'review@1') return null;
  const findings = new Map<string, FindingEntry>();
  for (const q of gate.questions) {
    if (!isFindingsQuestion(q)) continue;
    const ctx = parseGateCtx(q.context);
    if (ctx?.shape !== 'findings@1') return null;
    const values = new Set(q.options.map(optionValue));
    if (values.size !== q.options.length) return null;
    if (ctx.findings.length !== values.size) return null;
    for (const entry of ctx.findings) {
      if (!values.has(entry.id) || findings.has(entry.id)) return null;
      findings.set(entry.id, entry);
    }
  }
  return { review, findings };
}

export function isReviewSheetGate(gate: ReviewGateInput): boolean {
  return readReviewGate(gate) !== null;
}

export function readinessProse(readiness: Readiness): string {
  return `Ready to merge: ${readiness.replace(/-/g, ' ')}`;
}

export function severityTally(
  counts: Record<FindingSeverity, number>
): string {
  const parts = SEVERITY_ORDER.filter(s => counts[s] > 0).map(
    s => `${counts[s]} ${s}`
  );
  return parts.length > 0 ? parts.join(', ') : 'no findings';
}

export function reviewMeta(review: ReviewCtx): string {
  const { reviewer, round, re_review, prior } = review;
  return [
    reviewer,
    round !== undefined ? `round ${round}` : undefined,
    prior
      ? `${prior.addressed} addressed, ${prior.still_open} still open`
      : re_review
        ? 're-review'
        : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function reviewProse(review: ReviewCtx): string {
  const meta = reviewMeta(review);
  return [
    `**${readinessProse(review.readiness)}** · ${severityTally(review.findings)}`,
    ...(meta ? [meta] : []),
    review.summary,
  ].join('\n\n');
}

/** A gate-level context as a pane without a structured card shows it:
    prose exactly as written, a review@1 flattened, and nothing for any
    other shape, whose card lives elsewhere. Structured JSON never reaches
    a reader raw. */
export function paneContext(context: string | undefined): string | undefined {
  const ctx = parseGateCtx(context);
  if (ctx === null) return context;
  return ctx.shape === 'review@1' ? reviewProse(ctx) : undefined;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/board && bun test src/client/board/__tests__/review-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing routing DOM test**

Create `apps/board/src/client/board/__tests__/review-routing-dom.test.tsx`, reusing the direct-mount harness from `respond-header-dom.test.tsx` (copy its GlobalRegistrator setup, `beforeEach`/`afterEach`, `renderModal`, and `$` helper verbatim), with these fixtures and tests:

```tsx
const j = (v: unknown) => JSON.stringify(v);
const REVIEW = j({
  'gate-ctx': 'review@1',
  readiness: 'with-fixes',
  summary: 'one real defect, one missing case.',
  findings: { important: 1, minor: 1 },
});
const entry = (id: string, severity: string) => ({
  id,
  severity,
  title: `finding ${id}`,
  body: `the full text of ${id}.`,
});
const option = (value: string, tier: string) => ({
  value,
  label: `[${tier}] finding ${value}`,
  description: `lib/${value}.ts:1 · fix ${value}`,
});

function reviewGate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-rv',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/12',
    kind: 'review-post',
    label: 'review',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: REVIEW,
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings to !12?',
        multi: true,
        context: j({
          'gate-ctx': 'findings@1',
          findings: [entry('f1', 'important'), entry('f2', 'minor')],
        }),
        options: [option('f1', 'Important'), option('f2', 'Minor')],
      },
      {
        id: 'outcome',
        label: 'Verdict on !12',
        multi: false,
        options: ['comment', 'approve'],
      },
    ],
    ...overrides,
  };
}

function withFindings(patch: Partial<GateQuestion>): GateRow {
  const g = reviewGate();
  return { ...g, questions: [{ ...g.questions[0]!, ...patch }, g.questions[1]!] };
}

test('a structured review-post gate opens the review sheet', async () => {
  await renderModal(reviewGate());
  expect($('.tui-review-sheet')).not.toBeNull();
  expect($('.tui-triage-modal')).toBeNull();
});

test('an entry with no option routes the whole gate to the generic modal', async () => {
  await renderModal(
    withFindings({
      context: j({
        'gate-ctx': 'findings@1',
        findings: [entry('f1', 'important'), entry('f2', 'minor'), entry('f3', 'minor')],
      }),
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect($('.tui-triage-modal')).not.toBeNull();
});

test('an option with no entry routes the whole gate to the generic modal', async () => {
  await renderModal(
    withFindings({
      options: [option('f1', 'Important'), option('f2', 'Minor'), option('f3', 'Minor')],
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect($('.tui-triage-modal')).not.toBeNull();
});

test('a legacy review-post gate (prose context, pinned-format options) renders in the generic modal', async () => {
  await renderModal(
    reviewGate({
      context: 'Findings: Important (1), Minor (1)',
      questions: reviewGate().questions.map(q => ({ ...q, context: undefined })),
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect($('.tui-triage-modal')).not.toBeNull();
});
```

(Imports: `GateQuestion` from `@mattstack/gate-kit`; `GateRow` from `../../../gates/store.ts`; `DecisionQueueModal` from `../DecisionQueueModal.tsx`. No `mr` is passed, so the sheet never fetches `/review/report.json`.)

- [ ] **Step 6: Run to verify the DOM test fails**

Run: `cd apps/board && bun test src/client/board/__tests__/review-routing-dom.test.tsx`
Expected: FAIL: the structured gate's options parse through the old predicate, but the mismatch cases also open the sheet (the old predicate never reads contexts), and the legacy gate opens the sheet too.

- [ ] **Step 7: Switch routing**

- `DecisionQueueModal.tsx`: replace `import { isReviewSheetGate, ReviewGateSheet } from './ReviewGateSheet.tsx';` with `import { ReviewGateSheet } from './ReviewGateSheet.tsx';` and add `import { isReviewSheetGate } from './review-gate.ts';`.
- `ReviewGateSheet.tsx`: delete `isReviewSheetGate` and the doc comment above it (lines 99-111). The sheet still reads rows through `parseFindingOption` until Task 4; the pinned labels keep that working meanwhile.
- `review-gate-sheet-dom.test.tsx`: delete the test `'isReviewSheetGate is true for a finding-shaped gate and an outcome-only gate, false for a tier-option gate or a respond-plan gate'`, drop `isReviewSheetGate` from its import, and delete `TIER_GATE` and `RESPOND_GATE` if nothing else uses them (`rg -n "TIER_GATE|RESPOND_GATE"` in the file).

- [ ] **Step 8: Run to verify everything passes**

Run: `cd apps/board && bun test src/client/board/__tests__/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
bunx prettier --write apps/board/src/client/board/review-gate.ts apps/board/src/client/board/__tests__/review-gate.test.ts apps/board/src/client/board/__tests__/review-routing-dom.test.tsx apps/board/src/client/board/ReviewGateSheet.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx
git add apps/board/src/client/board/review-gate.ts apps/board/src/client/board/__tests__/review-gate.test.ts apps/board/src/client/board/__tests__/review-routing-dom.test.tsx apps/board/src/client/board/ReviewGateSheet.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx
git commit -m "board: route review-post gates to the sheet only on joined review@1/findings@1"
```

---

### Task 4: The sheet renders from the parsed shapes

**Files:**
- Modify: `apps/board/src/client/board/ReviewGateSheet.tsx`
- Modify: `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
- Modify: `apps/board/src/client/board/ReviewGateSheet.stories.tsx`
- Modify: `apps/board/src/client/board/icons.tsx` (delete `NoAnchorIcon`)
- Modify: `apps/board/src/style.css` (review-sheet block, ~lines 4232-4290 and the decision card ~4357-4395; `.tui-respond-pill` comment ~2331)
- Delete: `apps/board/src/client/board/finding-option.ts`, `apps/board/src/client/board/__tests__/finding-option.test.ts`

**Interfaces:**
- Consumes: Task 2's `FindingEntry`, `FindingSeverity`, `Disposition`; Task 3's `readReviewGate`, `SEVERITY_ORDER`, `SEVERITY_LABEL`, `readinessProse`, `reviewMeta`.
- Produces: `ReviewGateSheet` with unchanged props; it renders `null` for a gate `readReviewGate` rejects. DOM hooks later tasks and captures rely on: `.tui-review-finding-text` (body), `[data-disposition]` on the pill, `.tui-review-decision-meta`.

- [ ] **Step 1: Convert the sheet test fixtures to structured context**

In `review-gate-sheet-dom.test.tsx`, add above `const GATE`:

```ts
const j = (v: unknown) => JSON.stringify(v);

function entry(
  id: string,
  severity: 'critical' | 'important' | 'minor',
  title: string,
  file: string | undefined,
  fix: string | undefined,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    severity,
    title,
    body: `${title}: the full finding text, never truncated.`,
    ...(file !== undefined ? { file } : {}),
    ...(fix !== undefined ? { fix } : {}),
    ...extra,
  };
}

const E = {
  f1: entry('f1', 'critical', 'SQL built from unsanitized input', 'lib/db/query.ts:42', 'parameterize the query'),
  f2: entry('f2', 'important', 'Missing null check on response', 'lib/api/client.ts:88', 'guard before dereferencing'),
  f3: entry('f3', 'important', 'Inconsistent error wording', 'lib/errors.ts:15', 'align with the style guide'),
  f4: entry('f4', 'minor', 'Unused import', 'lib/utils.ts:3', 'drop the dead import'),
  f5: entry('f5', 'important', 'Retry loop lacks backoff', 'lib/retry.ts:41', 'add exponential backoff'),
  f6: entry('f6', 'minor', 'Inconsistent spacing', 'lib/format.ts:9', 'run prettier'),
};

const findingsCtx = (...entries: object[]) =>
  j({ 'gate-ctx': 'findings@1', findings: entries });

const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary: 'One critical injection path; the rest are cleanups.',
  findings: { critical: 1, important: 3, minor: 2 },
};
```

Then in `GATE`: add `context: j(REVIEW),` after `openedAt: 1,`; add `context: findingsCtx(E.f1, E.f2, E.f3, E.f4),` to the `findings-1` question and `context: findingsCtx(E.f5, E.f6),` to `findings-2`. Options stay exactly as they are (the pinned recipe). `CLEAN_GATE` gets `context: j({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'Nothing worth a thread.', findings: {} }),`.

Delete: `CONTEXT_GATE` and its test (`'a verdict recommendation carried in gate.context drives ...'`), `MALFORMED_OPTION_GATE` and its test (`'one malformed option in a findings question does not hide the rest ...'`; routing owns that case now), and the test `'a report whose summary fields are not strings renders without throwing and shows no context lead'` (the sheet no longer reads `report.summary`). Update the file's header comment to say the fixtures carry review@1/findings@1 contexts.

- [ ] **Step 2: Add the failing tests**

Append to `review-gate-sheet-dom.test.tsx`:

```tsx
const RE_REVIEW_GATE: GateRow = {
  ...GATE,
  gateId: 'g-re-review',
  context: j({
    ...REVIEW,
    findings: { critical: 0, important: 1, minor: 2 },
    round: 2,
    re_review: true,
    prior: { addressed: 3, still_open: 1 },
  }),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(
        { ...E.f2, disposition: 'still-open' },
        { ...E.f4, disposition: 'new' },
        entry('f7', 'minor', 'Changelog entry missing', undefined, undefined, {
          disposition: 'addressed-check',
        })
      ),
      options: [
        GATE.questions[0]!.options[1]!,
        GATE.questions[0]!.options[3]!,
        { value: 'f7', label: '[Minor] Changelog entry missing', description: 'not inline-anchorable' },
      ],
    },
    GATE.questions[2]!,
  ],
};

test('a row reads title, accent file:line, the full body, and the fix line, in that order', async () => {
  await render();
  const row = container.querySelector('.tui-review-finding-row')!;
  const parts = [...row.querySelectorAll('.tui-review-finding-title, .tui-review-finding-anchor, .tui-review-finding-text, .tui-review-finding-fix')].map(el => el.className);
  expect(parts).toEqual([
    'tui-review-finding-title',
    'tui-review-finding-anchor',
    'tui-review-finding-text',
    'tui-review-finding-fix',
  ]);
  expect(row.querySelector('.tui-review-finding-title')!.textContent).toBe('SQL built from unsanitized input');
  expect(row.querySelector('.tui-review-finding-anchor')!.textContent).toBe('lib/db/query.ts:42');
  expect(row.querySelector('.tui-review-finding-text')!.textContent).toContain('SQL built from unsanitized input: the full finding text, never truncated.');
  expect(row.querySelector('.tui-review-finding-fix')!.textContent).toBe('parameterize the query');
});

test('groups follow the severity order, whatever order the options arrive in', async () => {
  await render();
  const groups = [...container.querySelectorAll('.tui-review-tier-group .tui-review-tier-pill')].map(p => p.textContent);
  expect(groups).toEqual(['Critical (1)', 'Important (3)', 'Minor (2)']);
});

test('a row with no file shows no anchor line, and no pill without a disposition', async () => {
  await render(RE_REVIEW_GATE);
  const rows = [...container.querySelectorAll('.tui-review-finding-row')];
  const changelog = rows.find(r => r.textContent?.includes('Changelog entry missing'))!;
  expect(changelog.querySelector('.tui-review-finding-anchor')).toBeNull();
  await render();
  expect(container.querySelector('.tui-review-finding-row [data-disposition]')).toBeNull();
});

test('a disposition renders as a small state pill on its row', async () => {
  await render(RE_REVIEW_GATE);
  const pills = Object.fromEntries(
    [...container.querySelectorAll('.tui-review-finding-row [data-disposition]')].map(p => [
      p.getAttribute('data-disposition'),
      [p.textContent, p.getAttribute('data-hue')],
    ])
  );
  expect(pills).toEqual({
    'still-open': ['still open', 'amber'],
    new: ['new', 'accent'],
    'addressed-check': ['confirm fix', 'green'],
  });
});

test('the decision card reads readiness, summary, counts, and the re-review line from review@1', async () => {
  await render(RE_REVIEW_GATE);
  expect(container.querySelector('.tui-review-decision-lead')!.textContent).toBe('Ready to merge: with fixes');
  expect(container.querySelector('.tui-review-decision-reasoning')!.textContent).toContain('One critical injection path; the rest are cleanups.');
  expect(container.querySelector('.tui-review-decision-meta')!.textContent).toBe('renee · round 2 · 3 addressed, 1 still open');
  const railPills = [...container.querySelectorAll('.tui-review-decision-card .tui-review-tier-pill')].map(p => p.textContent);
  expect(railPills).toEqual(['Important (1)', 'Minor (2)']);
});

test('a first-round review has no meta line beyond the reviewer', async () => {
  await render();
  expect(container.querySelector('.tui-review-decision-meta')!.textContent).toBe('renee');
});

test("report.json's summary never reaches the decision card", async () => {
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response(
        JSON.stringify({ summary: { readiness: 'no', reasoning: 'from the report file' }, depth: 'verify. suite green' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await render();
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(container.querySelector('.tui-review-decision-lead')!.textContent).toBe('Ready to merge: with fixes');
  expect(container.textContent).not.toContain('from the report file');
  expect(container.textContent).toContain('verify. suite green');
});

test('a gate the join rejects renders nothing', async () => {
  await render({ ...GATE, context: 'prose' });
  expect(container.querySelector('.tui-review-sheet')).toBeNull();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
Expected: FAIL on every new test (no `.tui-review-finding-text`, no pills, the decision card reads nothing from the gate, the rejected gate still renders).

- [ ] **Step 4: Rewrite the sheet's data path**

In `ReviewGateSheet.tsx`:

(a) Imports: delete `parseFindingOption, type ParsedFinding` (finding-option), `parseGateContext, sectionFor` (gate-context), and `NoAnchorIcon`. Add:

```ts
import type { Disposition, FindingEntry, FindingSeverity } from './gate-ctx.ts';
import {
  readinessProse,
  readReviewGate,
  reviewMeta,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
} from './review-gate.ts';
```

(b) Delete `READINESS_VALUES` and the local `readinessProse` with its comment (lines 44-54). In `ReviewReportJson` delete the `summary` field; in `sanitizeReport` delete the whole `summary` block (the `const s = ...` through its `else` branch) so the function only guards `depth`; update its doc comment to "report.json arrives from disk unvalidated; the record arrays each have their own safe* guard at render, and `depth` lands in JSX directly, so a non-string one is dropped here."

(c) Replace `tierGroupsOf` with:

```ts
const DISPOSITION: Record<
  Disposition,
  { text: string; hue: 'accent' | 'amber' | 'green' }
> = {
  new: { text: 'new', hue: 'accent' },
  'still-open': { text: 'still open', hue: 'amber' },
  'addressed-check': { text: 'confirm fix', hue: 'green' },
};

function severityGroups(
  findings: FindingEntry[]
): Array<[FindingSeverity, FindingEntry[]]> {
  return SEVERITY_ORDER.map(
    s => [s, findings.filter(f => f.severity === s)] as [FindingSeverity, FindingEntry[]]
  ).filter(([, items]) => items.length > 0);
}
```

(d) In the component, replace the `findingsQuestion`, `findings`, `tierGroups`, `parsedContext`, `outcomeSection`, and `isRecommended` blocks with:

```ts
  const data = useMemo(() => readReviewGate(gate), [gate]);
  const findingsQuestion = useMemo<GateQuestion | undefined>(
    () => questions.find(q => q.multi && q.id === 'findings'),
    [questions]
  );
```

(keep `outcomeQuestion`, `findingsName`, `outcomeName` as they are), then:

```ts
  const findings = useMemo<FindingEntry[]>(
    () =>
      (findingsQuestion?.options ?? []).flatMap(o => {
        const f = data?.findings.get(optionValue(o));
        return f ? [f] : [];
      }),
    [findingsQuestion, data]
  );
  const tierGroups = useMemo(() => severityGroups(findings), [findings]);
  const isRecommended = (o: GateOption) =>
    Boolean(optionDisplayFor(o).recommended);
```

`collapseChunks` merges `findings-1..N` into one question with id `findings`; that is why the lookup is by that id. `toggleTier`'s parameter type becomes `FindingEntry[]`.

(e) Directly before the component's `return (`, add `if (!data) return null;` then `const { review } = data;` and `const meta = reviewMeta(review);` (every hook above stays unconditional).

(f) The group head: `data-tier={SEVERITY_LABEL[tier]}` and text `{SEVERITY_LABEL[tier]} ({items.length})`; its `key={tier}` stays.

(g) The row body becomes:

```tsx
                            <span className="tui-review-finding-body">
                              <span className="tui-review-finding-line1">
                                <span className="tui-review-finding-title">
                                  {f.title}
                                </span>
                                {f.disposition && (
                                  <span
                                    className="tui-respond-pill"
                                    data-hue={DISPOSITION[f.disposition].hue}
                                    data-disposition={f.disposition}
                                  >
                                    {DISPOSITION[f.disposition].text}
                                  </span>
                                )}
                              </span>
                              {f.file && (
                                <span className="tui-review-finding-anchor">
                                  {f.file}
                                </span>
                              )}
                              <span className="tui-review-finding-text">
                                <Markdown unstyled linkTargetBlank>
                                  {f.body}
                                </Markdown>
                              </span>
                              {f.fix && (
                                <span className="tui-review-finding-fix">
                                  {f.fix}
                                </span>
                              )}
                            </span>
```

(h) The decision card's contents (between its label and the checks card) become:

```tsx
                  <p className="tui-review-decision-lead">
                    {readinessProse(review.readiness)}
                  </p>
                  <div className="tui-review-decision-reasoning">
                    <Markdown unstyled linkTargetBlank>
                      {review.summary}
                    </Markdown>
                  </div>
                  {meta && (
                    <p className="tui-review-decision-meta">{meta}</p>
                  )}
                  {SEVERITY_ORDER.some(s => review.findings[s] > 0) && (
                    <div className="tui-review-tier-pills">
                      {SEVERITY_ORDER.filter(s => review.findings[s] > 0).map(
                        s => (
                          <span
                            className="tui-review-tier-pill"
                            data-tier={SEVERITY_LABEL[s]}
                            key={s}
                          >
                            {SEVERITY_LABEL[s]} ({review.findings[s]})
                          </span>
                        )
                      )}
                    </div>
                  )}
```

(i) Update the sheet's stale comments: the one above the gate-context parse is gone with it; the component doc comment keeps its selection-state explanation.

Run `rg -n "parseFindingOption|ParsedFinding|parseGateContext|sectionFor|NoAnchorIcon|anchorLabel|\\.kind\\b" apps/board/src/client/board/ReviewGateSheet.tsx`: expect no hits.

- [ ] **Step 5: CSS**

In `apps/board/src/style.css`:

- Delete `.tui-review-finding-kind` and `.tui-review-finding-anchor-label` (+ its `svg` rule) with the comment above the latter.
- Replace the comment above `.tui-review-finding-line1` with: `/* Line 1 is the title and its disposition pill alone; the anchor, the body, and the fix each get their own line below it. */`
- After `.tui-review-finding-anchor`, add:

```css
/* The finding's full text is the decision material itself, so it reads in
   ink; only the fix line below it stays on the muted token. */
.tui-review-finding-text {
  color: var(--text-1);
  font-size: var(--gate-font-meta);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.tui-review-finding-text [data-part='markdown'] > * {
  margin: 0;
}
.tui-review-finding-text [data-part='markdown'] > * + * {
  margin-top: 6px;
}
```

- After `.tui-review-decision-reasoning`, add:

```css
.tui-review-decision-meta {
  margin: 0;
  color: var(--text-3);
  font-size: var(--gate-font-meta);
}
```

- The comment above `.tui-respond-pill` becomes: `/* The small uppercase tags: a thread's severity, a reply's verb, a finding's disposition. Grey unless a hue names what needs the eye. */`

- [ ] **Step 6: Delete the option parser**

```bash
git rm apps/board/src/client/board/finding-option.ts apps/board/src/client/board/__tests__/finding-option.test.ts
```

Delete `NoAnchorIcon` from `icons.tsx` (its only consumer is gone; `rg -n NoAnchorIcon apps/board` must return nothing).

- [ ] **Step 7: Stories**

In `ReviewGateSheet.stories.tsx`, keep every option label and description exactly as it is and add structured context beside them. Above `findingsQuestions`, add:

```ts
const ctx = (v: unknown) => JSON.stringify(v);
const findingsCtx = (...findings: object[]) =>
  ctx({ 'gate-ctx': 'findings@1', findings });
const F = {
  f1: { id: 'f1', severity: 'critical', title: 'SQL built from unsanitized input', file: 'lib/db/query.ts:42', fix: 'parameterize the query', body: 'The search handler interpolates the raw `q` parameter into the WHERE clause, so a crafted query string reaches the database as SQL.' },
  f2: { id: 'f2', severity: 'important', title: 'Missing null check on response', file: 'lib/api/client.ts:88', fix: 'guard before dereferencing', body: 'A 204 from the upstream returns no body, and `data.items` is read before anything checks that `data` exists.' },
  f3: { id: 'f3', severity: 'important', title: 'Inconsistent error wording', file: 'lib/errors.ts:15', fix: 'align with the style guide', body: 'Two of the new messages end in a period and one does not; the style guide asks for none.' },
  f4: { id: 'f4', severity: 'minor', title: 'Unused import', file: 'lib/utils.ts:3', fix: 'drop the dead import', body: '`debounce` is imported and never called.' },
  f5: { id: 'f5', severity: 'important', title: 'Retry loop lacks backoff', file: 'lib/retry.ts:41', fix: 'add exponential backoff', body: 'The loop retries immediately up to five times, which turns one upstream blip into a burst of six requests.' },
  f6: { id: 'f6', severity: 'minor', title: 'Inconsistent spacing', file: 'lib/format.ts:9', fix: 'run prettier', body: 'The new block mixes two- and four-space indents.' },
};
```

Give `findings-1` `context: findingsCtx(F.f1, F.f2, F.f3, F.f4)` and `findings-2` `context: findingsCtx(F.f5, F.f6)` (extend the local `question(...)` helper with an optional fifth `context` argument, or spread the context onto its result). `sixFindingGate` gets `context: ctx({ 'gate-ctx': 'review@1', reviewer: 'renee', readiness: 'with-fixes', summary: 'One critical injection risk; everything else is polish.', findings: { critical: 1, important: 3, minor: 2 } })`; `cleanGate` gets `context: ctx({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'Nothing flagged worth a thread.', findings: {} })`. Drop `summary` from `reportJson`. Add a `ReReview` story over a gate whose context adds `round: 2, re_review: true, prior: { addressed: 3, still_open: 1 }` with counts `{ important: 2, minor: 1 }`, one findings chunk of `{ ...F.f2, disposition: 'still-open' }`, `{ ...F.f5, disposition: 'new' }`, `{ ...F.f6, disposition: 'addressed-check' }` over those three findings' existing options, plus the outcome question, and the same 404 `fetchStub` `UnselectedSome` uses. Update the file's doc comment to say the fixtures carry review@1/findings@1 contexts.

- [ ] **Step 8: Run to verify**

Run: `cd apps/board && bun test src/client/board/__tests__/ && bun run typecheck`
Expected: PASS. Then from the repo root `bun run lint` (the CSS lint) passes.

- [ ] **Step 9: Commit**

```bash
bunx prettier --write apps/board/src/client/board/ReviewGateSheet.tsx apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx apps/board/src/client/board/ReviewGateSheet.stories.tsx apps/board/src/client/board/icons.tsx apps/board/src/style.css
git add -A apps/board/src/client/board apps/board/src/style.css
git commit -m "board: review sheet renders rows and header from review@1/findings@1; finding-option.ts deleted"
```

---

### Task 5: Delete gate-context.ts and every enrichment branch

**Files:**
- Modify: `apps/board/src/client/board/GateForm.tsx`
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx`
- Delete: `apps/board/src/client/board/gate-context.ts`, `apps/board/src/__tests__/gate-context.test.ts`, `apps/board/src/__tests__/gate-context-groups.test.ts`
- Create: `apps/board/src/client/board/__tests__/plain-context-dom.test.tsx`
- Modify: `apps/board/src/client/board/__tests__/decision-queue-dom.test.tsx`
- Modify: `apps/board/src/client/board/__tests__/respond-header-dom.test.tsx:146`
- Modify: `apps/board/src/client/board/__tests__/gate-form-context-fallback-dom.test.tsx`
- Modify: `apps/board/src/style.css`

**Interfaces:**
- Consumes: Task 3's `paneContext`, `isReviewSheetGate`.
- Produces: nothing new; the generic modal's context pane is always `<ScrollPane title="Decision context">` over `paneContext(gate.context)`.

- [ ] **Step 1: Write the failing fallback tests**

Create `apps/board/src/client/board/__tests__/plain-context-dom.test.tsx` with the same direct-mount harness as `respond-header-dom.test.tsx` (GlobalRegistrator, `beforeEach`/`afterEach`, `renderModal`, `$`), and:

```tsx
const j = (v: unknown) => JSON.stringify(v);

function proseGate(context: string, overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-prose',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/40',
    kind: 'clarify',
    label: 'clarify !40',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context,
    questions: [
      {
        id: 'finding-1',
        label: 'lib/a.ts:1',
        multi: false,
        options: ['post', 'skip'],
      },
    ],
    ...overrides,
  };
}

const paneText = () =>
  $('.tui-triage-modal [data-part="scrollpane-body"]')?.textContent ?? '';

test('section markers render verbatim in the pane: nothing is lifted onto a question', async () => {
  await renderModal(
    proseGate(
      'Two findings.\n\n=== finding-1 lib/a.ts:1 (verdict: valid, recommend post) ===\nreviewer: "a stray dot renders"\nAdjudication: correct.'
    )
  );
  expect(paneText()).toContain('=== finding-1 lib/a.ts:1 (verdict: valid, recommend post) ===');
  expect(paneText()).toContain('Adjudication: correct.');
  const question = $('.tui-gate-question')!;
  expect(question.textContent).not.toContain('Adjudication');
  expect($('[data-gate="recommended"]')).toBeNull();
});

test('bracketed lines render as written, with no grouping and no toggle', async () => {
  await renderModal(
    proseGate('Findings: Important (1), Minor (1)\n[Important] a guard is missing\n[Minor] an import is unused')
  );
  expect(paneText()).toContain('[Important] a guard is missing');
  expect(paneText()).toContain('[Minor] an import is unused');
  expect([...document.body.querySelectorAll('button')].some(b => b.textContent === 'as written')).toBe(false);
});

test('an answered structured review-post gate shows its summary as prose, never raw JSON', async () => {
  await renderModal(
    proseGate(
      j({
        'gate-ctx': 'review@1',
        readiness: 'with-fixes',
        summary: 'one real defect remains.',
        findings: { important: 1 },
      }),
      {
        kind: 'review-post',
        status: 'answered',
        answers: { outcome: 'comment' },
        questions: [{ id: 'outcome', label: 'Verdict', multi: false, options: ['comment', 'approve'] }],
      }
    )
  );
  expect(paneText()).toContain('Ready to merge: with fixes');
  expect(paneText()).toContain('one real defect remains.');
  expect(document.body.textContent).not.toContain('gate-ctx');
});

test('a findings@1 question context in the generic modal never renders raw; the pinned options carry it', async () => {
  const findings = j({
    'gate-ctx': 'findings@1',
    findings: [{ id: 'f1', severity: 'minor', title: 'unused import', body: 'the import is dead.' }],
  });
  await renderModal(
    proseGate(j({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'fine.', findings: { minor: 1 } }), {
      kind: 'review-post',
      questions: [
        {
          id: 'findings-1',
          label: 'Post which findings to !40?',
          multi: true,
          context: findings,
          options: [
            { value: 'f1', label: '[Minor] unused import', description: 'lib/a.ts:3 · drop it' },
            { value: 'f2', label: '[Minor] no entry for this one', description: 'lib/b.ts:1 · fix it' },
          ],
        },
        { id: 'outcome', label: 'Verdict', multi: false, options: ['comment', 'approve'] },
      ],
    })
  );
  expect($('.tui-review-sheet')).toBeNull();
  expect(document.body.textContent).not.toContain('gate-ctx');
  expect(document.body.textContent).toContain('[Minor] unused import');
  expect(document.body.textContent).toContain('lib/a.ts:3 · drop it');
});
```

In `gate-form-context-fallback-dom.test.tsx`, replace the header comment with:

```ts
/** A bare GateForm host (no Decision context pane above it) renders the
    gate context itself: prose as plain markdown, a review@1 flattened,
    never raw JSON. */
```

rename the existing test to `'a plain-prose context renders as plain markdown'`, make `Host` take the gate as a prop (`function Host({ gate = GATE }: { gate?: GateRow })`, passing `gate` to both `useGateForm` and `GateForm`), and add:

```tsx
test('a review@1 context renders flattened, never as raw JSON', async () => {
  const gate: GateRow = {
    ...GATE,
    gateId: 'g-review',
    context: JSON.stringify({
      'gate-ctx': 'review@1',
      readiness: 'yes',
      summary: 'nothing worth a thread.',
      findings: {},
    }),
  };
  await React.act(async () => {
    root.render(<Host gate={gate} />);
  });
  expect(container.textContent).toContain('Ready to merge: yes');
  expect(container.textContent).toContain('nothing worth a thread.');
  expect(container.textContent).not.toContain('gate-ctx');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/plain-context-dom.test.tsx src/client/board/__tests__/gate-form-context-fallback-dom.test.tsx`
Expected: FAIL: the sectioned gate collapses to an overview strip with the adjudication lifted onto the question and a recommended badge; the bracketed gate groups with an "as written" toggle; the review@1 gate context shows raw JSON in the pane; the findings@1 context renders raw under its question.

- [ ] **Step 3: GateForm**

In `GateForm.tsx`:

- Delete the `gate-context.ts` import, `QuestionContext` and its doc comment, and the `context`, `threadKeys`, and `sectioned` memos. The stray doc comment above `QuestionContext` that actually describes `GateForm` (it begins "The questionnaire form the triage modal renders") moves down to sit directly above `function GateForm`.
- Replace `const gateCtx = useMemo(() => parseGateCtx(gate.context), [gate.context]);` with `const fallbackContext = useMemo(() => paneContext(gate.context), [gate.context]);` (import `paneContext` from `./review-gate.ts`; `parseGateCtx` stays imported for `questionCtx`).
- The fallback block becomes `{showContextFallback && fallbackContext && (<div className="tui-gate-context-raw"><Markdown unstyled linkTargetBlank>{fallbackContext}</Markdown></div>)}`.
- Per question: delete `section` and `threadAt`, the `data-sectioned` attribute, the `threadAt >= 0` ordinal span, and `{section && <QuestionContext section={section} />}`. The progress text condition becomes `!threadCtx`. The raw question context renders only when nothing parsed: `q.context && qctx === null && (...)` in place of `q.context && !repliesCtx && (...)`.
- `recommended` becomes `choice.recommended === true`.
- Update the `showContextFallback` prop comment to: "DecisionQueueModal renders the gate context in its own Decision context pane above the form; a bare host with no such pane wants this on so the context is not lost."

- [ ] **Step 4: DecisionQueueModal**

In `DecisionQueueModal.tsx`:

- Delete the `gate-context.ts` import, `plural`, `GroupedContext`, `OverviewStrip`, the `sectioned`, `fullContext`, `rawContext`, and `grouped` state/memos, and the `useEffect` that resets them. Drop `useState` from the React import if nothing else uses it.
- Replace `const proseContext = headerCtx ? undefined : gate.context;` and its comment with `const proseContext = useMemo(() => paneContext(gate.context), [gate.context]);` (import `paneContext` from `./review-gate.ts` beside `isReviewSheetGate`).
- The body's context block becomes:

```tsx
            {proseContext && (
              <ScrollPane title="Decision context" maxHeight="46vh">
                <Markdown unstyled linkTargetBlank>
                  {proseContext}
                </Markdown>
              </ScrollPane>
            )}
```

- The comment above it becomes: "The modal exists to give context room: unlike the row card's collapsed disclosure, context renders open, above the form."

- [ ] **Step 5: Delete the parser and its tests; trim the old DOM tests**

```bash
git rm apps/board/src/client/board/gate-context.ts apps/board/src/__tests__/gate-context.test.ts apps/board/src/__tests__/gate-context-groups.test.ts
```

In `decision-queue-dom.test.tsx`, delete the three tests `'a sectioned context: each question carries its slice, the pane collapses to a strip, and the disclosure brings it back'`, `'a bracketed-findings context renders grouped, with a way back to the words as written'`, and `'a context whose sections match no question keeps the pane and adds no strip'`, plus any fixture constant only they used. In `respond-header-dom.test.tsx`, delete `expect($('.tui-triage-overview')).toBeNull();`.

- [ ] **Step 6: Dead CSS**

In `apps/board/src/style.css`, delete the rules for these selectors and the comments that introduce them: `.tui-gate-groups`, `.tui-gate-groups-total`, `.tui-gate-groups-preamble` (+ markdown child rules), `.tui-gate-groups-raw` (+ `:hover`), `.tui-gate-group` and every `.tui-gate-group-*` rule, `.tui-gate-question[data-sectioned] .tui-gate-question-label`, `.tui-gate-context` (exactly that class; `.tui-gate-context-raw` is a different, live hook), `.tui-gate-quote*`, `.tui-gate-verdict*`, `.tui-gate-lead` / `.tui-gate-adjudication` (+ markdown and list child rules), `.tui-triage-overview*`. Then verify each is gone from code too:

```bash
for c in tui-gate-groups tui-gate-group- 'tui-gate-group[ {]' data-sectioned "tui-gate-context[ {'\"]" tui-gate-quote tui-gate-verdict tui-gate-recommends tui-gate-lead tui-gate-adjudication tui-triage-overview; do echo "== $c"; rg -n "$c" apps/board/src apps/board/tests; done
```

Expected: no hits, except `data-sectioned` and `.tui-gate-groups` in `apps/board/tests/capture.ts` (Task 7 rewrites those scenes). Keep `.tui-gate-question-ord` (the thread ordinal still uses it).

- [ ] **Step 7: Run to verify**

Run: `cd apps/board && bun test && bun run typecheck && cd ../.. && bun run lint`
Expected: PASS everywhere; `rg -n "gate-context|parseGateContext|parseLabelledLines|sectionFor" apps/board/src` returns nothing.

- [ ] **Step 8: Commit**

```bash
bunx prettier --write apps/board/src/client/board/GateForm.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/__tests__/plain-context-dom.test.tsx apps/board/src/client/board/__tests__/decision-queue-dom.test.tsx apps/board/src/client/board/__tests__/respond-header-dom.test.tsx apps/board/src/client/board/__tests__/gate-form-context-fallback-dom.test.tsx apps/board/src/style.css
git add -A apps/board/src
git commit -m "board: delete gate-context.ts; non-structured contexts render as plain markdown"
```

---

### Task 6: The queue modal's chrome: one-row head, step nav pinned to the footer

**Superseded.** A later ruling moved the step nav back inline in the gate body (this-gate scope, not the queue-scope footer) and fixed the original defect instead with bounded, internally scrolling context containers plus a scrolling question area inside the form. The one-row head and the footer's queue-only content (pips, gate count) still stand as this task shipped them.

Scope addition from Matt (derived decisions 14-16). Defect: on a short viewport the form's step nav (previous / reset / next) lives inside the scrolling body and scrolls out of reach below the fold; only the pips footer stays visible. And the top spends two bands (title row, then the focus pane / skip gate row) before any content.

**Files:**
- Modify: `apps/board/src/client/board/GateForm.tsx`
- Modify: `apps/board/src/client/board/DecisionQueueModal.tsx`
- Modify: `apps/board/src/style.css` (`.tui-triage-modal [data-part='modal-title']` through `.tui-triage-queue-row` ~2615-2645; the footer block ~2940-2965)
- Create: `apps/board/src/client/board/__tests__/triage-chrome-dom.test.tsx`
- Modify: `apps/board/tests/decision-queue-context-layout.test.ts`

**Interfaces:**
- Consumes: Task 5's GateForm and DecisionQueueModal.
- Produces: `GateForm`'s new optional prop `actionsSlot?: HTMLElement | null`; DOM hooks `.tui-triage-title`, `.tui-triage-where`, `.tui-triage-nav` (the footer slot), with `.tui-triage-head-actions` now inside `[data-part='modal-head']`.

Background you need: `Questionnaire.Previous` / `Next` / `Skip` are `type="button"` and call context callbacks (`goPrevious`, `goNext`, `skipCurrent`), and Skip on the last step calls `form.requestSubmit()` on the form it holds by ref; all of that survives a React portal. `Questionnaire.Submit` is a native `type="submit"` button and the reset control a native `type="reset"` one: outside the `<form>`'s DOM they only reach it through the HTML `form="<id>"` attribute. `Questionnaire.Root` and `Questionnaire.Submit` pass extra props through to their elements. Check that the kit `Button` forwards a `form` prop to its `<button>` (read `packages/tui-kit/src/recipes/Button/Button.tsx`); the Step 1 tests fail loudly if it does not.

- [ ] **Step 1: Write the failing DOM tests**

Create `apps/board/src/client/board/__tests__/triage-chrome-dom.test.tsx` with the direct-mount harness from `respond-header-dom.test.tsx` (GlobalRegistrator, `beforeEach`/`afterEach`, `renderModal`, `$`), plus a fetch stub in `beforeEach` that records posts:

```tsx
let posts: Array<{ url: string; body: unknown }>;
// in beforeEach, after localStorage.clear():
posts = [];
(globalThis as { fetch: unknown }).fetch = async (
  input: RequestInfo | URL,
  init?: { body?: string }
) => {
  const url = typeof input === 'string' ? input : input.toString();
  posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

function stepped(): GateRow {
  return {
    gateId: 'g-steps',
    subject: 'mr:https://gitlab.example.com/demo/app/-/merge_requests/51',
    kind: 'clarify',
    label: 'clarify !51',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: 'Two questions for the author.',
    origin: { paneId: 'pane-51', worktree: '/work/demo' },
    questions: [
      { id: 'first', label: 'Keep the flag?', multi: false, options: ['keep', 'drop'] },
      { id: 'second', label: 'Ship behind it?', multi: false, options: ['yes', 'no'] },
    ],
  };
}

async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const footerButton = (text: string) =>
  [...document.body.querySelectorAll('.tui-triage-footer button')].find(
    b => b.textContent?.trim() === text && !b.hasAttribute('hidden')
  ) ?? null;

test('the step nav renders in the footer, never in the scrolling body', async () => {
  await renderModal(stepped());
  expect($('.tui-triage-footer .tui-gate-actions')).not.toBeNull();
  expect($('.tui-triage-body .tui-gate-actions')).toBeNull();
});

test('the footer nav still drives the form: pick, next, pick, submit posts both answers', async () => {
  await renderModal(stepped());
  await click($('input[value="keep"]'));
  await click(footerButton('next'));
  await click($('input[value="yes"]'));
  await click(footerButton('submit'));
  const answer = posts.find(p => p.url === '/gate/answer');
  expect(answer?.body).toMatchObject({
    gateId: 'g-steps',
    answers: { first: 'keep', second: 'yes' },
  });
});

test('reset in the footer clears the picks', async () => {
  await renderModal(stepped());
  await click($('input[value="keep"]'));
  await click(footerButton('reset'));
  expect(($('input[value="keep"]') as HTMLInputElement).checked).toBe(false);
});

test('the head is one row: title, compact focus pane and skip gate, then close', async () => {
  await renderModal(stepped());
  const head = $('[data-part="modal-head"]')!;
  expect(head.querySelector('.tui-triage-title')?.textContent).toBe('decision queue');
  const actions = [...head.querySelectorAll('.tui-triage-head-actions button')];
  expect(actions.map(b => b.textContent?.trim())).toEqual(['focus pane', 'skip gate']);
  for (const b of actions) expect(b.getAttribute('data-size')).toBe('sm');
  expect($('.tui-triage-queue-row')).toBeNull();
});
```

(If the answer body's shape differs only by keys this form always adds, match what `gate-form-skip-dom.test.tsx` asserts for the same flow rather than loosening the test.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/board && bun test src/client/board/__tests__/triage-chrome-dom.test.tsx`
Expected: FAIL: the actions render inside `.tui-triage-body`, there is no `.tui-triage-title`, and the head carries only the title and close.

- [ ] **Step 3: GateForm renders its nav into a slot**

In `GateForm.tsx`: import `createPortal` from `react-dom` and `useId` from `react`. Add the prop:

```ts
  /** Where the step nav renders. Undefined keeps it inline under the
      questions. An element (the queue modal's footer) takes it out of the
      scrolling body; null holds it back until that element has mounted. */
  actionsSlot?: HTMLElement | null;
```

Inside the component, `const formId = useId();`. Move the whole `<div className="tui-gate-actions">...</div>` element into a `const actions = (...)` above the `return`, unchanged except: the reset `Button` gets `form={formId}`, and `Questionnaire.Submit` gets `form={formId}`. `Questionnaire.Root` gets `id={formId}`. Where the actions row used to be, render:

```tsx
      {actionsSlot === undefined
        ? actions
        : actionsSlot && createPortal(actions, actionsSlot)}
```

A portal outside the `<form>` is why the two native buttons carry `form`: add that as the comment on the `const actions` line, one sentence.

- [ ] **Step 4: DecisionQueueModal: one-row head, footer slot**

In `DecisionQueueModal.tsx`:

- `const [navSlot, setNavSlot] = useState<HTMLDivElement | null>(null);` (keep `useState` in the React import).
- The Modal's `title` becomes the head row, and the `<div className="tui-triage-queue-row">` wrapper is deleted:

```tsx
      title={
        <>
          <span className="tui-triage-title">decision queue</span>
          <span className="tui-triage-head-actions">
            {/* A parked gate has no pane: the board closed it on park, and the
                recorded answer is what brings it back (resumeParkedGate). The
                button stays so the head never rearranges, disabled with the
                reason, as it is when the reconciler reports the pane gone. */}
            {gate.status === 'parked' ? (
              <Button
                type="button"
                variant="light"
                intent="accent"
                size="sm"
                disabled
                title="parked: answering this gate resumes its pane"
              >
                focus pane
              </Button>
            ) : (
              <Button
                type="button"
                variant="light"
                intent="accent"
                size="sm"
                disabled={!form.originFocusable || form.focusBusy || paneGone}
                title={
                  paneGone
                    ? 'pane is gone'
                    : form.originFocusable
                      ? 'jump into the pane behind this gate'
                      : 'no origin on this gate'
                }
                onClick={() => void form.focusGate()}
              >
                focus pane
              </Button>
            )}
            <Button
              type="button"
              variant="light"
              intent="muted"
              size="sm"
              onClick={onSkip}
            >
              skip gate
            </Button>
            {headerCtx && <GateStateChips gate={gate} />}
          </span>
        </>
      }
```

  (The existing JSX, moved; only `size` changes, from `lg` to `sm`.)
- The GateForm face gets `actionsSlot={navSlot}`.
- The footer becomes:

```tsx
      <div className="tui-triage-footer">
        <span className="tui-triage-where">
          <span className="tui-triage-pips">
            {states.map((state, i) => (
              <i key={i} className="tui-triage-pip" data-state={state} />
            ))}
          </span>
          <span className="tui-triage-pos">
            gate {position} of {states.length}
          </span>
        </span>
        <div className="tui-triage-peek">
          {nextPeek && (
            <>
              <span className="tui-triage-peek-k">next:</span>
              <span>{nextPeek}</span>
            </>
          )}
        </div>
        <div className="tui-triage-nav" ref={setNavSlot} />
      </div>
```

- Update the component's doc comment: gate-level actions (focus pane, skip gate) ride the head row beside close; step-level actions (previous / next / submit) ride the footer, pinned below the scrolling body; the two never mix.

- [ ] **Step 5: CSS**

In `apps/board/src/style.css`:

- Replace the comment above `.tui-triage-modal [data-part='modal-title']` with: `/* The head is one row: the recipe's title span is stretched so the gate's own actions and chips ride its right edge, beside close. Everything inside the actions resets the title's voice. */`
- `.tui-triage-head-actions` gains `margin-left: auto; letter-spacing: normal; text-transform: none;` (check the recipe title's computed styles in the browser at Task 8 and reset whatever else leaks, such as the display font size).
- Delete `.tui-triage-queue-row` and replace the comment above `.tui-triage-modal [data-part='modal-head']` with `/* Breathing room between the one-row head and the body. */`.
- The footer block becomes:

```css
/* Footer, pinned below the scrolling body: where the queue stands (pips
   and count) on the left, the next-gate peek in the middle, and the active
   gate's step nav on the right, so the nav never scrolls out of reach. */
.tui-triage-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  border-top: 1px solid var(--border-soft);
  padding: 0.85rem 0 0.35rem;
}
.tui-triage-where {
  display: inline-flex;
  align-items: center;
  gap: var(--gate-gap-row);
}
.tui-triage-nav {
  margin-left: auto;
}
.tui-triage-nav .tui-gate-actions {
  padding: 0;
  min-height: 0;
}
```

  Delete `.tui-triage-footer .tui-triage-pos { justify-self: end; }`. The `.tui-triage-peek` rule gains `flex: 1 1 12rem;` (keep its other declarations and its wrap comment).

- [ ] **Step 6: Run the DOM suites**

Run: `cd apps/board && bun test src/client/board/__tests__/ && bun run typecheck`
Expected: PASS, the new file included. `gate-form-skip-dom.test.tsx` mounts GateForm bare (no slot), so its nav stays inline and it passes unchanged; `respond-header-dom.test.tsx`'s `.tui-triage-head-actions [data-gate=...]` assertions still hold (the class moved into the head).

- [ ] **Step 7: Write the real-layout tests**

Append to `apps/board/tests/decision-queue-context-layout.test.ts`:

```ts
type Scrollable = { scrollTop: number; scrollHeight: number };

test('short: the step nav is pinned in the footer, on screen, and stays put while the body scrolls', async () => {
  const page = await openDecisionQueue(SHORT);
  const nav = page.locator('.tui-triage-footer .tui-gate-actions');
  await nav.waitFor();
  expect(await page.locator('.tui-triage-body .tui-gate-actions').count()).toBe(0);
  const before = (await nav.boundingBox())!;
  expect(before.y + before.height).toBeLessThanOrEqual(SHORT.height);
  await page.evaluate(() => {
    const { document } = globalThis as unknown as PageGlobals;
    const body = document.querySelector('.tui-triage-body') as unknown as Scrollable;
    body.scrollTop = body.scrollHeight;
  });
  const after = (await nav.boundingBox())!;
  expect(after.y).toBe(before.y);
  await page.context().close();
}, 30_000);

test('the head is one row: title, focus pane, skip gate, and close share a line', async () => {
  const page = await openDecisionQueue(ROOMY);
  const middle = async (selector: string) => {
    const box = (await page.locator(selector).first().boundingBox())!;
    return box.y + box.height / 2;
  };
  const title = await middle('.tui-triage-title');
  for (const selector of [
    '.tui-triage-head-actions button:has-text("focus pane")',
    '.tui-triage-head-actions button:has-text("skip gate")',
    '.tui-triage-modal [data-part="modal-close"]',
  ])
    expect(Math.abs((await middle(selector)) - title)).toBeLessThanOrEqual(4);
  expect(await page.locator('.tui-triage-queue-row').count()).toBe(0);
  await page.context().close();
}, 30_000);
```

The two existing pane-law tests must keep passing untouched. If `short:`'s `bodyScrolls` stops being true because the actions row left the body, that is a real change in what the test measures: report it and pick a shorter viewport for that one assertion rather than deleting it.

- [ ] **Step 8: Run the layout tests**

Run: `cd apps/board && bun test tests/decision-queue-context-layout.test.ts`
Expected: PASS, four tests.

- [ ] **Step 9: Commit**

```bash
bunx prettier --write apps/board/src/client/board/GateForm.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/__tests__/triage-chrome-dom.test.tsx apps/board/tests/decision-queue-context-layout.test.ts apps/board/src/style.css
git add apps/board/src/client/board/GateForm.tsx apps/board/src/client/board/DecisionQueueModal.tsx apps/board/src/client/board/__tests__/triage-chrome-dom.test.tsx apps/board/tests/decision-queue-context-layout.test.ts apps/board/src/style.css
git commit -m "board: queue modal head in one row, step nav pinned to the footer"
```

---

### Task 7: Fixture, captures, and re-pinned baselines

**Files:**
- Modify: `apps/board/tests/fixture/data.json` (the `gate-review-post-1271` gate)
- Modify: `apps/board/tests/fixture/README.md` (the `!1271` row)
- Modify: `apps/board/tests/capture.ts` (~lines 213-240, and the `queueplan`/`queuepost` loop's first wait)
- Modify: `apps/board/tests/baselines/*.png`; delete `queuegroups-{light,dark}.png`; add `reviewsheet-{light,dark}.png`

**Interfaces:**
- Consumes: Task 4's sheet (`.tui-review-sheet`), Task 5's plain pane, Task 6's one-row head and footer nav (every queue capture re-pins with them).
- Produces: captures `reviewsheet-*` (structured) and `queue-*` (prose fallback); a real-layout guard on the sheet's submit.
- Also modifies: `apps/board/tests/decision-queue-context-layout.test.ts`.

- [ ] **Step 1: Record the compare state before touching anything**

```bash
cd apps/board && bun run capture && bun run capture:compare; echo "exit $?"
```

Record the result in your report (known: red on main, every view stale).

- [ ] **Step 2: Make `!1271`'s gate structured**

Write this throwaway script to the session scratchpad (NOT the repo), run it with `bun run <path>`, and replace the `context` and `questions` of `gate-review-post-1271` in `apps/board/tests/fixture/data.json` with its printed values (gateId, subject, kind, status, openedAt, domain, origin stay):

```ts
const s = JSON.stringify;
const entries = [
  { id: 'f1', severity: 'important', title: 'separator still renders after an empty label', file: 'src/tabs/TabBar.tsx:58', body: 'The check reads `label !== undefined`, and the label-only tab passes an empty string, so the bullet separator renders before nothing. Keying on a non-empty label fixes both call sites.', fix: 'check label for a non-empty string, not for presence', disposition: 'still-open' },
  { id: 'f2', severity: 'important', title: 'label-only tab has no test', file: 'src/tabs/TabBar.test.tsx', body: 'The suite covers icon-plus-label and icon-only tabs; label-only is the missing third shape, and the separator bug lives in it.', fix: 'add a label-only case to the existing describe block', evidence: 'TabBar.test.tsx: 6 pass, 0 fail, no label-only case', disposition: 'new' },
  { id: 'f3', severity: 'minor', title: 'hover ring width now matches the spec', file: 'src/tabs/TabBar.css:12', body: 'The last round flagged the hover ring as one pixel wide at the 480px breakpoint. The stylesheet now uses the shared ring token; confirm before resolving.', disposition: 'addressed-check' },
  { id: 'f4', severity: 'minor', title: 'stale comment above the separator', file: 'src/tabs/TabBar.tsx:52', body: 'The comment still describes the old icon-first layout.', fix: 'drop the comment or restate the current order', disposition: 'new' },
  { id: 'f5', severity: 'minor', title: 'changelog entry missing', body: 'Tab rendering changed in a way users can see, and the changelog has no entry for it.', fix: 'add a line under Unreleased', disposition: 'new' },
];
const tier = (sev: string) => sev[0]!.toUpperCase() + sev.slice(1);
const option = (e: (typeof entries)[number]) => ({
  value: e.id,
  label: `[${tier(e.severity)}] ${e.title}`,
  description: [e.file ?? 'not inline-anchorable', e.fix].filter(Boolean).join(' · '),
});
const chunk = (n: number, list: typeof entries) => ({
  id: `findings-${n}`,
  label: 'Post which findings to !1271?',
  multi: true,
  context: s({ 'gate-ctx': 'findings@1', findings: list }),
  options: list.map(option),
});
console.log(
  JSON.stringify(
    {
      context: s({
        'gate-ctx': 'review@1',
        reviewer: 'pat',
        readiness: 'with-fixes',
        summary: 'The separator still renders for a label-only tab, and nothing in the suite exercises that shape; the rest is housekeeping.',
        findings: { important: 2, minor: 3 },
        round: 2,
        re_review: true,
        prior: { addressed: 2, still_open: 1 },
      }),
      questions: [
        chunk(1, entries.slice(0, 4)),
        chunk(2, entries.slice(4)),
        {
          id: 'outcome',
          label: 'Verdict on !1271: ready once the separator check is fixed',
          multi: false,
          options: [
            { value: 'comment', label: 'comment (recommended)', description: 'post the picked findings, no merge decision yet' },
            { value: 'approve', label: 'approve', description: 'approve alongside the picked findings' },
          ],
        },
      ],
    },
    null,
    2
  )
);
```

Then `bunx prettier --write apps/board/tests/fixture/data.json` and validate with `bun -e "JSON.parse(await Bun.file('apps/board/tests/fixture/data.json').text())"`.

In `tests/fixture/README.md`, the `!1271` row's gate phrase `an open review-post gate ("Post which findings?")` becomes `an open structured review-post gate (review@1 round 2 re-review, five findings@1 findings across two chunks, one of each disposition; the review sheet shot)`. Append to the `!1235` row: `; its review-post gate is a legacy one (prose context, tier options), the prose-fallback shot`.

- [ ] **Step 3: Rewrite the queue scenes in `tests/capture.ts`**

Replace the block from the comment `// decision queue: the loop below skips gates until it lands on the` through `await shoot(page, \`queuegroups-${theme}\`);` and its following `await page.keyboard.press('Escape');` with:

```ts
  // A legacy review-post gate (prose context, tier options) in the generic
  // modal: its context renders as plain markdown, wherever it sits in the
  // queue. The first gate may be the review sheet, so either face counts
  // as open.
  await page.click('.tui-dq-open');
  await page.waitForSelector('.tui-triage-body, .tui-review-sheet');
  const legacy = page.locator(
    '.tui-triage-modal [data-part="scrollpane-body"]',
    { hasText: '[Important] Dropped guard' }
  );
  for (let i = 0; i < 10 && !(await legacy.count()); i++) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await legacy.waitFor();
  await shoot(page, `queue-${theme}`);
  await page.keyboard.press('Escape');
  // The structured review-post gate: the full-screen review sheet.
  await page.click('.tui-dq-open');
  await page.waitForSelector('.tui-triage-body, .tui-review-sheet');
  const sheet = page.locator('.tui-review-sheet');
  for (let i = 0; i < 10 && !(await sheet.count()); i++) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await sheet.waitFor();
  await shoot(page, `reviewsheet-${theme}`);
  await page.keyboard.press('Escape');
```

In the `queueplan`/`queuepost` loop that follows, change its `await page.waitForSelector('.tui-triage-body');` to `await page.waitForSelector('.tui-triage-body, .tui-review-sheet');` for the same reason.

- [ ] **Step 3b: The layout test survives a sheet-first queue, and guards the sheet's submit**

In `apps/board/tests/decision-queue-context-layout.test.ts`, `openDecisionQueue`'s `await page.waitForSelector('.tui-triage-body');` becomes `await page.waitForSelector('.tui-triage-body, .tui-review-sheet');` (its skip loop already walks past the sheet: the sheet has its own "skip gate" button). Then append:

```ts
test('short: the review sheet keeps its verdict and submit on screen', async () => {
  const ctx = await browser.newContext({ viewport: SHORT });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.abort()
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?member=all`);
  await page.waitForSelector('.tui-row');
  await page.click('.tui-dq-open');
  await page.waitForSelector('.tui-triage-body, .tui-review-sheet');
  const sheet = page.locator('.tui-review-sheet');
  for (let i = 0; i < 10 && !(await sheet.count()); i++) {
    await page.getByRole('button', { name: 'skip gate' }).click();
    await page.waitForTimeout(120);
  }
  await sheet.waitFor();
  const submit = (await page.locator('.tui-review-submit').boundingBox())!;
  expect(submit.y + submit.height).toBeLessThanOrEqual(SHORT.height);
  await page.context().close();
}, 30_000);
```

Run: `cd apps/board && bun test tests/decision-queue-context-layout.test.ts`
Expected: PASS, five tests.

- [ ] **Step 4: Re-pin and look**

```bash
cd apps/board && git rm tests/baselines/queuegroups-light.png tests/baselines/queuegroups-dark.png
bun run capture:baseline
git status --short tests/baselines
```

Open with the Read tool, at minimum: `reviewsheet-light.png`, `reviewsheet-dark.png`, `queue-light.png`, `queue-dark.png`, `queueplan-light.png`, `queueplan-dark.png`, and `rows-light.png` (the `!1271` row). In every queue shot the head is one row (title left; compact focus pane, skip gate, close right) and the step nav sits in the footer to the right of the pips. Confirm: the sheet shows five rows in Important then Minor groups, full bodies in ink, the three disposition pills, the meta line `pat · round 2 · 2 addressed, 1 still open`, no raw JSON anywhere; the queue shot shows the `!1235` context as plain text lines with the `[Important]` / `[Minor]` prefixes intact and no group heads. Write in your report plainly anything that looks wrong; fix what is this task's to fix.

- [ ] **Step 5: Compare against the new pins**

```bash
cd apps/board && bun run capture && bun run capture:compare
```

Expected: every view matches. Then `bun test tests/ src/client/board/__tests__` (the layout test boots the fixture) passes.

- [ ] **Step 6: Purity and commit**

```bash
./scripts/repo-purity.sh
bunx prettier --write apps/board/tests/capture.ts apps/board/tests/fixture/README.md apps/board/tests/fixture/data.json
git add -A apps/board/tests
git commit -m "board: structured review-post fixture gate; reviewsheet capture; baselines re-pinned"
```

---

### Task 8: Look at it, then the full gates (controller, not a subagent)

- [ ] **Step 1: Boot the fixture board**

```bash
cd apps/board && BOARD_FIXTURE=$(pwd)/tests/fixture PORT=7941 bun run src/server.ts
```

(background; wait for `/healthz`). Use the raw port `http://127.0.0.1:7941/?member=all`, never a `.mattstack` URL.

- [ ] **Step 2: Fast Browser screenshots, both schemes**

For each theme (`localStorage.setItem('mrs-theme', 'light' | 'dark')`, reload): open the decision queue, reach the `!1271` review sheet, screenshot; reach the `!1235` legacy review-post gate (the prose fallback), screenshot; reach the `!1235` respond-plan gate (stepped), screenshot. Repeat the prose-fallback and respond-plan shots at a short window (1000x812).

- [ ] **Step 3: Look, and say plainly what is wrong**

Check: row hierarchy (title, then accent file, then body in ink, then muted fix), pill hues and legibility in dark, the meta line, rail pills from the counts, no raw JSON, no clipped text, the tally and "more below" still honest with taller rows, the prose fallback reading as plain markdown. Chrome: the head is one row and its compact buttons read as header chips, not pills; at the short window the step nav stays in the footer on screen while the body scrolls; the footer does not crowd (if it overflows, move an item out rather than shrinking shared padding). Fix anything wrong (TDD where it is behaviour, CSS where it is looks), re-pin the affected captures, commit each fix.

- [ ] **Step 4: Full verification**

From the repo root:

```bash
bun run tui-kit:build
bun run board:typecheck && bun run board:test && bun run lint && bun run board:build && bun run format:check && ./scripts/repo-purity.sh
cd apps/board && bun run capture && bun run capture:compare
```

Expected: every command exits 0.

- [ ] **Step 5: Final whole-branch review**

Per superpowers:subagent-driven-development's final review, over `git diff 53ec3936..HEAD`, against both specs and this plan.
