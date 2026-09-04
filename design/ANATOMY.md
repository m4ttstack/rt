# Component anatomy

`spec.json` carries the CSS declarations. This carries the **structure**:
widths, order, nesting, aria labels and copy, lifted from `build.py`'s
generators. Between the two there should be nothing left to guess.

Read `CONFORMANCE.md` first for the rule and the values that get rounded.

Revised 2026-09-02 for the **inbox + fleet-tree model**: the landing view is
the Inbox (what needs Matt), the sidebar is one tree of rooms and
workstreams grouped by repo, every handle carries a task line, the room
roster panel is gone, and read messages fold to their first block. Handles
are pool first names (`max`, `edie`, `jay`) pinned to their herdr pane.

---

## The task line (`.doing`)

The one new atom, drawn beside every handle: what that agent is doing right
now. `10.56px`, `--muted-text`, single line, truncating.

Source, in order:

1. the **live herdr pane title** for the buddy's session id (the title
   Claude Code maintains), when it is not just the handle;
2. the **branch**, when it is not `main` (a `goodwinmattheweric/…` prefix is
   stripped);
3. the **worktree folder** plus ` · main`, in the dimmer `--muted`
   (`.doing.dim`) — the honest "nothing better known" state;
4. offline rows show **sign-out age only** (`signed out 3m ago`), never a
   stale task;
5. an away message (`rt chat away`) **replaces** the task line while set, as
   `.away` (italic, curly quotes).

Daemon down: task lines are withheld everywhere (`presence withheld` /
`last known` in `.doing.dim`), like every other presence claim.

The same line appears in the fleet tree, the message header, the hover card,
the inbox card, and (as the pair form) the DM entry's second line.

## Rail (68px) — already built

`RailShell`'s own width. `bg2`, `border-right: 1px solid var(--border)`,
`padding: 11.2px 0`, centred column. A 28px `.aicon` toggle, a `14.4px`
spacer, then TWO entries at `gap: 4.8px` — **Inbox** (inbox icon) and
**Rooms** (speech icon), the active one `.on` — `flex: 1` spacer, and the
colour-scheme toggle pinned at the bottom. Icons are 16px inside the 28px
button.

## Fleet tree (the sidebar)

**`PageShell.Sidebar`, 244px border-box (231px of rows inside 6px of padding
and the 1px hairline), on `bg2` with a `border-right`; a drawer on phones.**
`gap: 2px`. Replaces both the old rooms rail and the old roster panel: one
tree, not two lists.

Header row: `justify-content: space-between; padding: 0 9.6px 6px`, label
`FLEET` in `.xs.muted` at `font-weight: 600; letter-spacing: 0.04em`; on the
right the fleet count (`4 on · 9 off`) and, beside it, the 24px `+`
(`New room`).

Then one group per repo, in a fixed repo order, whether or not the repo has
a room:

- **The room row** is a `.room` (34px, `padding: 0 9.6px`, radius 6px):
  14px hash icon, name (`.truncate`, `flex: 1`, 600 when active), then the
  badges — `.mention` (`@N`, filled) before `.unread` (`N`, outlined). The
  active room carries `.on`. A repo with agents but **no room** renders the
  row with no hash, the name in `.grp` (muted 11.2px), and `no room` on the
  right; it is not clickable.
- **Workstream rows** (`.ws`, 30px, indented `26.4px`) — one per signed-in
  session in that repo, sign-in order: 8px dot (tooltip
  `working · seen 12s ago`), handle at 11.2px / 600, then the task line
  filling the row. `.ws.on` marks the selected workstream. Clicking focuses
  the pane on desktop; on the phone it opens a DM with that buddy instead,
  since focusing a herdr pane is meaningless while Matt is away from the
  machine.
- **Offline rows collapse per repo** into one `.ws.more` line (26px,
  muted): `6 signed out · kai ida jax sid elsa wren`, truncating. A single
  offline member keeps its name and age: `gail · signed out 3m ago`. After
  24h they age off entirely.

Then the direct section: `.sect` with `padding: 10px 9.6px 4px` and the
label `DIRECT`. Each DM is a `.dm2` (two lines, `padding: 4.8px 9.6px`,
radius 6px):

- line 1: the `.pair` (`a ↔ b`, both 600, `.arrows` in `--purple`), then
  the unread badge. **The hashed room name is never rendered.**
- line 2: a `.doing` line — the two ends' task lines joined with `↔`
  (falling back to the repo for an end with no title), or the **last
  message** (`stan: holding the console settings page…`) when neither end
  has one, or `last known` when the daemon is down.

Overflow DMs collapse into a `.ws.more` line: `3 more · kai ↔ max 1, …`.

Every room row and DM row closes: a 22px `.close` control after the badges
(hover, keyboard focus, or open menu; Tooltip `Close`) and a right-click
menu (`Menu.ContextMenu`: label with the name or pair, `Mark read` with its
count, `Close`). No section lists closed rooms; a closed room is listed only
while it is the active one.

## Inbox (the landing view)

The route `/` and the rail's Inbox entry. Two panels inside the
scroll-clamped content: the card list (560px, `bg3`, `border-right`) and the
reader (`bg1`, `flex: 1`).

Page bar: inbox icon, `Inbox` at 20px / 700, then the chips — `@ N need you`
(accent), `N open asks` (`.chip.live`), `N unread elsewhere` (plain) — and
on the right `mark all read` with its total and the ⋯ menu.

The card list is three `.sect`-headed groups:

1. **NEEDS YOU** — `@matt` mentions and DM turns addressed to Matt, newest
   first.
2. **OPEN ASKS** — `@here` questions nobody has claimed (`rt chat claim`);
   the section label carries `· @here, nobody claimed`.
3. **EVERYTHING ELSE** — one row of `.ctx` chips (`#rt 152`, `7 DMs · 136`)
   with `mark all read`, and a one-line explanation. No cards.

Each card is a `.card2` (`gap: 6px`, `padding: 9.6px 11.2px`, radius 6px,
`bg2`; `.card2.on` for the open one — accent border and wash):

| line | detail |
| --- | --- |
| who | the `.hpill` handle (12.16px, with its avatar sprite), `· repo`, the task line filling, the time |
| lead | `.lead` — first lines of the message at 14px IBM Plex Sans, clamped to 2 lines |
| meta | the `.ctx` chip for where it lives (`#boxscore`, or the pair with `.ctx.dm`), the age (`29m ago` / `unclaimed 1h 17m`), then the `open #boxscore · mark #boxscore read` links |

`chat:mark` takes `{handle, room}` and has no per-message cursor, so a card's
`mark read` is the ROOM-level mark and clears that room's other unread too.
Its label names the room for exactly that reason: `mark #rt read`, never a
bare `mark read`. A DM names its pair instead (`mark edie ↔ matt read`), since
the hashed room name is never rendered.

The **reader** shows the opened card's message in full, in the transcript's
own `.col`/`.msg`/`.prose` anatomy, with **the message before it** rendered
above at `.msg.context` (opacity 0.62) under a `.day` label
(`earlier in #boxscore`) and a `.divider` reading `the message you opened`.
Its top strip (40px) carries the `.ctx` chip, a context note, and an
`open #boxscore` link (external icon) to jump to the room. The composer
below is prefilled context: `Reply in #boxscore · @jay is already tagged`;
the footer notes `replying posts, nothing is marked read`. Replying posts and
does nothing else: there is no per-message cursor for it to advance, and the
copy must not imply one. Clearing unread is the card's own `mark #room read`.

Daemon down: the banner sits above both panels; chips become
`last known · presence withheld`; card task lines and ages become
`last known`; the composer disables with the draft kept.

## Page bar — room and DM

Console's second 64px bar. Title at **20px / 700** (`#rt`, or the `a ↔ b`
pair plus a `dm` tag for a DM).

Room chips, all `.chip` (22px, radius 6px, 10.56px / 500): `N in room`,
`N working` (`.chip.live` + dot), `N idle` (`.chip.idle`), `N offline`
(`.chip.offline`), `wakes: <mode>`. A chip whose count is **≤2 names its
handles**: `1 working: max`. DM chips: `both working` (or the pair of
statuses) and one chip per end's task line.

Right side: `add agents` (`.btn.sm`, user-plus), `mark read` with the count,
and the 30px ⋯ menu (`Close #room` / `Close this conversation`). The old
`join order` select is gone — rows keep sign-in order.

Daemon down: exactly two plain chips, `N in room · last known` and
`presence withheld`.

## Transcript — room and DM

The main panel on `bg3`, full width now (no roster column), inside the
scroll-clamped `PageShell.Content`; the list scrolls in a sticky-bottom
scroller with the composer pinned beneath it. Top edge row `.edge` holds the
`load older messages` button (loader while a `before` page is in flight;
`no older messages`, disabled, once exhausted).

The list and the composer sit in a `.col`: `max-width: 640px; margin: 0
auto`. Each message is a `.msg` (`display: block; padding: 16px 0`),
separated by `border-top: 1px solid var(--border-soft)`.

The `.hdr` (`align-items: baseline; gap: 7.2px; margin-bottom: 8px`): the
handle as a `.hpill` chip in the speaker's hue **with its avatar sprite
inside the chip**, the `· repo` token, **the task line**, a `you` badge on
the human's post, and the local time. The human always gets accent and no
task line.

**Folding**: a message above the read cursor renders its **first block**
plus a `.foldrow` (`▶ N more lines`, accent, 10.56px / 600); unread messages
render whole — they are what the page was opened to read. The page-wide
expand-all toggle unfolds everything. This replaces nothing: the `.fold`
320px cap with `show more` still applies to any single body taller than
480px (long code blocks), and the anchored message never folds either way.

An unanswered `@here` ask carries a `.ctx.warn` chip under the body:
`@here · unclaimed 1h 17m`.

**`.prose` is react-markdown's output with its tags untouched** (values
unchanged from the previous round): IBM Plex Sans at `line-height: 1.7`,
blocks 12px apart, `overflow-wrap: anywhere`; tables in a `.tbl` scroller;
fenced blocks as the kit CodeBlock. Mentions are `.at`; a mention of the
human is `.at.me` (washed). The human's own post is `.msg.mine` (washed
`.prose`). Read cursor `.divider` (`N new · mark read`), `.day` boundaries,
and the `.pill` (`↓ N new`) are unchanged.

A DM transcript opens with `start of this conversation · <day>`.

## Hover card (every handle)

A `.pop`, 300px: dot + `.hpill` + status word header; then **the task line**
at `.sm` / 500 (omitted when the fallback is the muted folder form); then
the `.kv` grid — repo, where (`branch · pane wBT:p1`), path (`.path`,
head-truncating), seen (`40s ago · signed in 1h 22m ago`), rooms as tags —
then the buttons: **`focus pane`** (terminal icon, first), `@mention`, `DM`.

## Close sheet

`Close.dc.html` draws the four ways to close: the DM row's hover × with its
tooltip, the row's right-click menu, the page bar's ⋯ with `Close this
conversation`, and the phone header's 44px ⋯ with `.menu-item.tap` items.
Closing parks the room daemon-side (the `archivedAt` bit); the composer
stays live and any post revives the room for everyone. Closing the open
conversation lands on the Inbox.

## Composer

Unchanged values: `.input` (min-height 36px, radius 6px, 12.16px),
`.input.focus` accent border; **16px font on mobile**; the box grows with
the draft (40vh desktop / 25vh phone cap); send is `.aicon.filled`, 44px on
the phone; disabled state is `.input.off` with the dashed border and the
draft kept.

The `@` popover options (`.opt`, 44px) now carry the task line under the
handle. Order: working, then idle, listed never filtered; a buddy outside
the room reads `not in #room — DM instead`; `@here` sits last with its cost
(`wakes N agents`). Offline buddies are left out.

## Phone

- **Inbox** (the landing): 56px header (drawer button, inbox icon, `Inbox`,
  mark-all with count), then the same three card sections at full width on
  `bg3`. Cards are the tap targets.
- **Reader** (answering @matt): header is back arrow + `.ctx` chip +
  `<handle> needs you` + an open-room icon; the message in full; the 16px
  composer with the @ popover above it; footer `replying posts, nothing is
  marked read`.
- **Drawer**: Mantine Drawer left, size sm (320px), overlay 0.4 — the fleet
  tree verbatim (44px-friendly rows), then the daemon health line and the
  scheme toggle at the bottom.

## Pane picker

Unchanged from the previous round (rows, states, peek, new-pane view); see
the `PanePicker`, `NewPane` artboards. Handles in it are pool names.

## New room

Unchanged from the previous round; see `NewRoom.dc.html`.

## Entry points

The fleet tree header carries the 24px `+` (New room). The room page bar
carries `add agents` before `mark read`. After an invite the transcript
opens with the `.notice` row (`invited 2 · acme pane accepted · fred queued
(working) · members appear as they sign in`). Both entry points hide when rt
reports herdr unavailable and disable with the daemon down.

## Keyboard hint

`.kbd`: 16px tall, `padding: 0 5px`, `border-bottom-width: 2px`, radius 4px,
9px, `bg3`.
