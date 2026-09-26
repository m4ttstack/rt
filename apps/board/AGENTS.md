# AGENTS.md -- apps/board

UI colour and type in this app follow the repo-wide authoring guide:
`docs/ui-authoring.md` at the repo root. Read it before writing any
colour, contrast, or font decision; tokens are picked by role there,
and raw values fail lint and the contrast gates.

Board-specific: visual changes regenerate the capture baselines
(`bun run capture:baseline` in apps/board) only when the change is
intentional; `capture:compare` is the gate that catches the rest. It
shoots at 1280 wide only, so narrow widths are checked by hand.

## Decision queue faces

Every gate opens in one full-screen frame, `GateSheet`
(`src/client/board/GateSheet.tsx`), with a body picked by kind:

| Gate                                                       | Body                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| respond-plan, respond-post                                 | `RespondSheetBody` (`RespondSheet.tsx`)   |
| review-post                                                | `ReviewGateSheet.tsx`                     |
| every other open gate (stage, herd, milestone, escalation) | `StageSheetBody` (`StageSheet.tsx`)       |
| pane-attention                                             | `PaneSheetBody` (`StageSheet.tsx`)        |
| answered, answer stuck, agent not running                  | `AnsweredSheetBody` (`AnsweredSheet.tsx`) |

Every body keeps the same split: the items you decide on in the main
column; the MR card, a "decision context" card and the decision docked at
the bottom of the right rail. Shared parts (choices, notes, dock rows, the
answered-elsewhere rail, the dock reserve) live in `SheetParts.tsx`, and
the answer payload in `sheet-payload.ts`. A new gate kind gets a body in
this frame, never a new modal or a card that moves columns, and a face it
replaces is deleted once nothing renders it.

Below 1100px the rail narrows; below 720px the sheet stacks into one
scroll (decision items, then the rail's cards) with the dock pinned to the
bottom of the screen.

## Which gates reach the board

`src/gates/ingest.ts` takes `mr:` subjects, `pane-attention` gates, and
`run:` gates whose run records an MR the board tracks (`src/gates/run-mr.ts`
resolves run to MR in the background; the request path never waits on it).

## Seeing every face

`bun run storybook` from the repo root, then `Gates/Board/Gallery`: one
story per gate kind and variant, built from real gate shapes with invented
data (`gate-gallery.fixtures.ts`). Add a story when you add a gate kind or
variant, with invented names only (the repo is public).

## Respond rounds

A respond run has a round: 1 on the MR's first pass, one more for each
`revise` re-adjudication, recorded by the wrapper through
`respond-status <state> drafting --round <n>` and kept on `RespondState.round`
(`src/respond-state.ts`). Two dispatch helpers decide what a launched pane is
told: `respondResumeDispatchFields` rides the recorded round on a parked-gate
resume as `--round <n>`, and `respondFreshDispatchFields` hands a FRESH launch
on an MR with a prior recorded round `--round <n+1>`, so the wrapper's own
"1, then +1 per revise" rule does not restart at 1 and the gate header chip
does not read round 1 forever. Absent prior round omits the flag in both.
Keep the two helpers siblings with the same shape (they mirror
`doctorResumeDispatchFields` in `src/doctor-state.ts`); a new dispatch field
goes in both, and the wrapper (`skills/respond/SKILL.md`, the `--round` row
of its flag table) must document it the same day.

## Browser checks

Drive local apps by raw port (`http://localhost:<port>`; the live board is
11006, a fixture board takes `PORT=`, Storybook 6006 or the port you pass).
Never open a `*.mattstack` URL: the OS hands it to the mattstack viewer,
which closes the browser tab.
