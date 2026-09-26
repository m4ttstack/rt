# Review gates: structured findings, full-screen board sheet, locked palette

Status: approved in design session 2026-09-18 (Matt + Claude). Mocks live in
Matt's personal pen.dev file (`~/Documents/review gate.pen`, frames
"Review Gate Sheet · LOCKED" and the superseded explorations); repo copies of
the frames must swap all review content for invented data before landing in
`docs/design/board/board.pen`, since this repository is public.

## Problem

A review gate today carries one checkbox per severity tier ("Minor (4)"), so
the human posts all of a tier or none of it, and the findings themselves ride
a prose `context` blob that downstream surfaces parse with text heuristics.
The board's gate presentation is also thinner than the in-pane form for the
same decision. apps#96 fixed the transport half (per-question context now
survives live gate frames); this spec covers the rest: a structured findings
contract, per-finding picking, a review-specific board presentation, and the
palette that came out of syncing the design to the real tokens.

## 1. Findings contract: `report.json`

The review engine's Deliver step writes a machine artifact beside the
Markdown report, same basename, `.json` extension. The md report is unchanged
and stays the human artifact; the json is the only machine-read path (no md
section parsing anywhere).

Required:

```json
{
  "summary": {
    "readiness": "yes | no | with-fixes",
    "reasoning": "one or two sentences, the assessment's qualifier"
  },
  "findings": [
    {
      "id": "f1",
      "tier": "Critical | Important | Minor",
      "kind": "nitpick | suggestion | thought | confirmation | question | ...",
      "title": "short claim, sentence case",
      "file": "path/to/file.ts",
      "line": 42,
      "fix": "one-line fix gist"
    }
  ]
}
```

- `id` is stable within the report (`f1, f2, ...` in report order).
- `kind` is free vocabulary but the values above are the conventional set.
- `file`/`line` are optional; a finding with no anchor (file not in the diff,
  or anchored to a constant) omits them and carries its anchor text in
  `fileLabel` (e.g. "not inline-anchorable").

Optional, rendered by the full-screen sheet when present:

```json
{
  "depth": "verify. jest 120/120 green; typecheck noise was codegen, not defects.",
  "strengths": [{ "lead": "short claim", "detail": "receipts, with file:line refs" }],
  "checks": [{ "tag": "PASS | N/A | FAIL", "text": "what was checked" }],
  "notes": ["observations that are neither strengths nor findings, incl. post-merge follow-ups"]
}
```

Readiness words and tier names remain the engine's fixed vocabulary. A report
missing the optional arrays still renders; the sheet falls back to showing
the raw md below the findings.

## 2. Posting contract

`review-posting`'s decided selection becomes
`{findings: ["f1", "f3"], disposition: "comment" | "approve" | "request_changes"}`.

- Legacy `{levels: [...]}` stays accepted (posts whole tiers) to absorb skew
  between the board wrapper and installed packs.
- Posting maps each selected id to its json row and feeds `file`/`line`/
  `title`/`fix` directly into the inline-thread mechanics
  (`mr_comment_inline` on GitLab, `gh` on GitHub). No prose parsing.
- A finding without an anchor posts into the review's summary comment
  instead of an inline thread.
- `rt runs decision record` selection payload carries the same shape.

## 3. Board wrapper gate build (`apps/board/skills/review/SKILL.md`)

The wrapper reads `report.json` (sibling of `--report`) and builds:

- One option per finding: `value` = finding id, `label` = `[Tier] title`
  (middle-truncated to the 200-byte label cap), `description` = anchor plus
  fix gist (1024-byte cap). Multi-select questions chunked `findings-1..N`
  at four options each, Critical first, report order within tiers; answers
  read as one union (the gate protocol's existing convention).
- One `outcome` question: label `Verdict on !<iid>: <readiness clause>`,
  options with descriptions, the recommended option first with the
  `(recommended)` suffix. Clean review: outcome question alone.
- Gate-level `--context` carries the readiness line and tier counts; finding
  titles no longer need to ride question context (they are the options).
- Parked resume and degraded mode read the same json. Answer handling passes
  `{findings, outcome}` to the domain skill.

## 4. Board UI

### Review-post gates open as a full-screen sheet

Covering the app window, replacing the generic modal for this kind only.
Layout (locked in the pen mock):

- **Header**: title, focus-pane / skip-gate chips, then queue nav (prev
  chevron, progress dots, "gate n of m", next chevron), gate tag, close.
- **Left column**: author-first MR card (member pixel-sprite avatar, author
  name in identity purple, "opened !<iid> into <target> · age", title,
  meta line with branch, +/-, depth summary, pane); findings list under
  "Post which findings to !<iid>?" with an "n of m selected" tally; tier
  group headers (wash pill + all/none links); rows = accent checkbox,
  title, kind tag, mono anchor, fix gist; then the review record cluster:
  STRENGTHS / DEPTH / EVIDENCE / NOTES sharing one right-aligned label
  column and one text edge, green disc checks on strengths, muted inline
  record icons (search-check, camera, pencil-line shapes) on the rest.
- **Right rail**: Decision context card (small-caps label, readiness lead,
  reasoning, tier pills), checks card (fixed-width PASS/N/A chips), then
  "Verdict on !<iid>", the option cards (kit geometry: 1px border, 7px
  radius; selected = accent border + wash + solid accent radio), note
  field, primary button `post <n> · <verdict>` directly below, reset.
- The findings region scrolls inside the sheet with a bottom fade and the
  tally carrying "k more below" if content ever exceeds even full-screen
  height; verdict and submit never scroll away.
- all/none interaction states: rest faint; hover = accent + underline on the
  hovered word; mousedown deepens; a no-op end (already all / already none)
  drops to disabled gray without disappearing, so nothing shifts.
- The board collapses `findings-N` chunks into the one visual list and
  splits the checked union back into per-chunk answers on one submit.
- Row data renders from the gate payload (option label + description);
  `report.json` is the wrapper's input, not the board client's.

### Other gate kinds

Respond, doctor, and non-MR gates keep the generic decision-queue modal
unchanged. A mixed queue is one sequence; each gate renders in its kind's
presentation, queue position shown in both chromes. Pane forms, shepherd,
and console gate rendering are unaffected.

### Selection states go accent everywhere

The gate form's checked-option state (today amber-coded) moves to the accent
across all gate kinds. Amber remains a signal color only (dots, pills,
washes); no primary action or selection is amber.

### Housekeeping

`pruneStates` unlinks the `.json` report sibling alongside the md.

## 5. Locked palette (`packages/tokens`)

Light halves only; dark pairs untouched. One edit in
`packages/tokens/src/values.ts` + `scripts/generate.ts` regenerates both
tui-kit and mantine-tokyo, recoloring every app in this repo.

| Token | Value | Text companion |
| --- | --- | --- |
| accent | #4658FF | #3A3FE8 |
| green (ok) | #00C287 | #008559 |
| purple (identity) | #9B45FF | none |
| cyan | #00B8D9 | none |
| amber (warn/signal) | #FF8A00 | #B36000 (wash #FFEDD8) |
| red (bad) | #FF3D81 | none |

Text companions for green and amber are new token concepts (only accent had
one); generation and consumers gain them together. Badges keep the
light-wash-plus-colored-text concept. Contrast held approximately in the
mock; the token PR does a proper AA pass. Gray badge texts darkened one step: kind tags read a new badgeText token (#454b66 light, #aab3d8 dark); N/A chips read mutedText (#565d80).

Open question: the recolor lands on every app at once; decide before merge
whether to eyeball chat/console/deck served locally first.

## 6. Sequencing

1. **Tokens PR** (this repo): values + regenerated artifacts + accent
   checked-states CSS. Independent, ships first.
2. **Board PR** (this repo): sheet renderer, chunk collapse, prune tweak,
   wrapper skill update.
3. **mattstack-skills PR**: engine Deliver json emission, posting contract,
   decision-record shape; then `rt skills sync` per pack. Engine text keeps
   ticket references out (pack-compiled files are employer-visible).

Skew is safe in any order: the wrapper falls back to tier options without a
json; posting accepts both selection shapes; the board renders any gate
generically until the sheet lands.

## 7. Follow-ups (parked, not in scope)

- Respond gates adopting the sheet shell (header nav + rail).
- gate-kit chunk visual merge for the generic modal + console.
- Answered-row chip compression for many-finding gates.
- "Posts to summary" hint on non-anchorable finding rows.
- Update BOARD-42 to point here (it describes the pre-redesign parity fix).
