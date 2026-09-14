# MR row density study, direction B approved 2026-09-12

A polish pass on the board's MR row after the 2026-09-12 four-line row
went live (`docs/design/mr-row/README.md`, "Rulings after live use"). Not a
redesign: the same four lines and the anchored corner, tuned for the two
things that were still wrong in daily use, too much metadata reading as
busy, and state colors that did not distinguish states.

Approved by Matt on 2026-09-12 ("B's design is approved"). The `.pen` file
and the renders here are the reference for implementation.

## What lives here

| file | what it is |
| --- | --- |
| `board.pen` | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the renders by hand. |
| `renders/*.{dark,light}.png` | 2x exports of every board, both themes, refreshed after each change |

Boards on the canvas, left column dark, the column at x=1520 light:

- `00 · Overview`: the same hot row drawn five ways (today, A, B, C, D)
- `01 · State pill system`: one hue per review state, four pill styles
- `A · Flags are facts`, `C · Two lines`, `D · No boxes, aligned rail`:
  the rejected directions, kept for the record
- `B · The header line earns its keep`: the approved direction, rest and
  hover side by side

The column at x=3040 (light at x=4560) proofs B against every state the
row can show, on shapes taken from the live board (titles to 97
characters, branches to 68, up to 27,407 commits behind, approvals
required up to 12), with invented names throughout:

- `B0 · Threads token and the comments drawer`
- `B1 · Agent lanes`: review, respond, doctor, orphans
- `B2 · Decisions and social`: gates in every delivery outcome, nudges,
  held notes, peers, humans
- `B3 · Standing states`: the author's ten lines beside the reviewer's nine
- `B4 · Mechanical and stress`: long title and branch, huge diff and behind
  counts, partial approvals, auto-merge, draft, four flags at once, a
  three-deep stack, the author-grouped view
- `B5 · Polish round 2`: the six live-use findings below (emoji marks,
  ticket for branch, threads waiting, no pill repeats, subtle lane-colored
  verbs, secondaries left of the primary); `B5b` the verb identity options
  it chose from
- `B6 · Row menu`: the right-click menu synced with B5, today's beside two
  states of the new one
- `B10 · A note of your own` (approved 2026-09-14): the row's last line,
  a note the seat writes for itself, drawn at rest, wrapping, under the
  pointer with its "dismiss note" verb, and open in its editor
- `B9 · The decision context pane, grouped` (approved 2026-09-14): a
  review gate's bracketed findings as one heading per label with its
  count, prefixes dropped, beside today's flat run of prefixed lines
- `B8 · Dismiss a stuck lane` (approved 2026-09-14): the muted secondary
  beside a failed lane's relaunch verb, drawn at rest, under the pointer,
  and after the dismissal, when the row's next line speaks
- `B7 · Context travels with the question` (approved 2026-09-13): the
  decision queue's respond gate with each thread's reviewer quote, verdict
  and recommendation on its own question card, the overview pane collapsed
  to one line with a disclosure; today's blob-above-the-form beside it

## The rulings

Everything below is drawn in B and its scenario boards; the laws in
`docs/design/mr-row/README.md` still hold underneath.

- **The header line always has a job.** The author tag moves up from the
  facts line to the header's left edge, muted (not purple), with an
  avatar. The mechanical flags sit beside it as colored words with a 12px
  icon, never as chips: `conflicts` (orange, git-merge), `ci failing`
  (red, circle-x), `ci running` (amber, loader), `stacked` (cyan, layers),
  `draft` (dim, pencil), `auto-merge` (green, zap). The Slack marks and the
  pill hold the corner as before.
- **The Slack stage mark is the reaction emoji as Slack shows it** (`👀`
  looking, `💬` commented, `✅` approved, 13px) beside the brand-colored
  logo, because the team reads those reactions off the Slack message and
  the mark says "marked this way on Slack". This supersedes the mr-row
  rule against emoji on the row for this one mark; a mono icon here read
  as a second chat bubble next to the threads token.
- **Conflicts and ci failing never share a color.** Conflicts is orange
  (Tokyo Night `#ff9e64` / `#b15c00`), ci failing is red.
- **Behind count moves to the header line**, after the flags, as a muted
  `↓ N behind` (arrow icon plus word). The facts line is then identity
  only: `!iid`, branch, `+adds −dels`, so the green/red diff is the only
  colored number on it.
- **One hue per pill state, soft fill.** Four states: needs review amber,
  N/M approved cyan, approved green, changes requested red. Soft-fill
  style (tinted background, colored uppercase text, no border), 10px/700,
  4px radius. `commented` and `comments resolved` are conversation
  states, carried by the threads token, not the pill; draft is a flag.
- **The pill owns the approval axis only.** It stops saying "commented";
  the conversation lives in the threads token.
- **The threads token is the drawer's entry and reads at full weight.**
  A 12px message icon plus `N threads` in foreground color, 500 weight.
  New activity since the drawer was last opened: accent, 700, plus a 6px
  accent dot. Threads awaiting the seat on their own MR replace the count
  with `N threads waiting` in amber, 600 (the total moves to the tooltip:
  the waiting count is the fact the author needs, the total is noise).
  The author having replied to the seat's thread on someone else's MR
  likewise replaces the count with `author replied` in accent, 600: a
  status outranks the count and takes its place. Hover underlines the
  words.
- **All clear is the words and the sun.** `all clear ☀`, no tagline.
- **Hover replaces the dot with main's bespoke square checkbox**: 13px,
  1.5px muted stroke at 55% opacity, near-square corners, centered on the
  dot's point. The row tints, and the copy tool plus the secondary verbs
  appear to the LEFT of the primary verb, which never moves; secondaries
  are muted 600, never plain text.
- **The facts line carries the ticket, not the branch.** `!iid`, then the
  ticket as a Linear link (muted 500 with an arrow), then the diff. The
  branch's only fact worth the space was its ticket; it shows only when no
  ticket can be read off it. The title drops its ticket prefix so the id
  never sits twice one line apart; Slack templates keep it.
- **The status line never repeats the pill.** An approved MR's finished
  review reads `review ready` alone (the outcome detail stays when the
  review only recommends it, or found comments). Someone else's unapproved
  MR reads who has approved so far (`no approvals yet`, `1 of 2
  approvals`, `Tom approved`) with the review verb, since the pill already
  says needs review.
- **Verbs are subtle buttons in three classes.** Nothing at rest but the
  word, a tint under the pointer. Agent verbs (review, respond, call
  doctor, relaunch, resume, re-review, focus) carry the bot mark in their
  lane's color: review accent blue, respond green, doctor orange, so the
  color says which agent a click starts before the word is read. Decide
  verbs (answer, retry) are amber. Navigation (open, read, view ↗) stays
  quiet text.
- **Stacked children indent 20px** (`--stack-indent`); the rail is 2px in
  the cyan tint, drops from the parent's dot, and its arm ends at the
  child dot's edge.
- **Clipping order.** The header clips from the right (flags before marks
  and pill), the title from the right, the branch at 34ch before the diff,
  so the pill, the diff and the age never move.
- **Author-grouped view.** With the author tag gone the header line holds
  only the flags and the behind count; the ticket lives on the facts line
  in every view.
- **The row menu speaks the row's grammar.** Three sections: agent
  actions, gitlab, slack (no misc). Agent actions carry the bot mark in
  their lane's color and use the row's verbs (review, re-review, respond,
  call doctor, rebase locally, relaunch, resume, focus); the agent's
  report opens from there (view agent review), and asking a teammate's
  agent to look again sits last with a people icon. Every other item leads
  with one icon that says where the click lands, in place of the old
  trailing "herdr" / "gitlab" hints; the Slack items carry the row's Slack
  logo and the marks the reaction emoji (`mark as looking`, `unmark
  approved` with a check trailing). Only actions possible right now
  render: a blocked GitLab action is absent, not greyed; the marks appear
  once the MR is posted; an empty section has no label. Re-review appears
  only once a review is logged: the board's own finished review, or a
  person's on GitLab (an approval, a reviewer thread, or a reviewer who
  commented, approved or requested changes).
- **The note is the row's last line, and the only thing allowed to grow
  the row** (B10). A note the seat writes for itself: a band under the
  status line in the row's cyan, opaque (mixed into the panel the rows
  sit on, never an alpha wash, or the row's hover tint would change its
  color), the glyph centred on the whole paragraph when it wraps. No
  note, no band, and the row keeps its 114px. The way in is the note tool
  that joins the copy tool under the pointer, or the row menu; clicking
  the note edits it in place in the same auto-growing textarea the Slack
  header and the launch note use (`↵` saves, `⇧↵` newline, `esc`
  cancels, an empty save clears); under the pointer the band ends in
  `dismiss note`. Notes live in the board's own state db, per machine,
  and are never posted anywhere.
- **The Slack marks are the way into the thread.** Once an MR is posted,
  line 0's marks wear the row tool's button shape and open the Slack
  post; with no permalink they stay the plain marks they were.

## Implementation touch points

`apps/board/src/client/board/RowView.tsx` (line 0 and line 2 contents),
`StatusLine.tsx` (all-clear detail), `row-status.ts` (`statusPhrase` hues
and the commented state), `CommentsDrawer.tsx` (`ThreadsLink` states),
`chips.tsx` / flag rendering, and the row block of `apps/board/src/style.css`
(pill soft fill, flag words, header line, threads token, checkbox). The
fixture at `apps/board/tests/fixture` plus `bun run capture:compare` are the
visual parity gate, compared against `renders/B-*.png` and the `B0`-`B4`
renders. The row note (B10) adds `src/row-note.ts` (the kv-backed store and
`attachNotes`), `POST /note`, `client/board/RowNote.tsx`, and the
`note-*` / `noteedit-*` captures.

Implemented on branch `mr-row-b`.
