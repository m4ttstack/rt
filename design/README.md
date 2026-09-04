# rt chat viewer — design reference

The approved mockups for plan 2 (`docs/superpowers/plans/2026-08-23-rt-chat-viewer.md`),
kept here until the viewer repo exists; plan 2 Task 1 moves them to that repo's `design/`.

**The artboards in this directory are the reference.** A hosted canvas is a
convenience, not a record: artifacts belong to the Claude Code account that
published them, so a link stops resolving as soon as the active account
changes. Re-seed one from these files whenever it is wanted (the `/design`
skill's `seed-canvas.mjs`, every `artboards/*.dc.html` plus `canvas.json`),
and do not treat a dead link as lost work.

| file | what it is |
| --- | --- |
| `artboards/*.dc.html` | the design source — `Main` (the Inbox landing), `DaemonDown`, `Room` (#rt with the fleet tree and folded messages), `DirectMessage` (Matt inside an agent↔agent DM), `PhoneInbox`, `Phone` (answering @matt), `PhoneRooms` (the fleet drawer), `Fleet` (the tree as its own panel, with the hover card), `Indicators`, `NewRoom`, `PanePicker`, `NewPane`, `EntryPoints` |
| `canvas.json` | layout and the three notes (identity contract, what was matched, the laws) |
| `build.py` | regenerates the artboards from one shared CSS block; edit it, not the outputs |

Every value is lifted from console, not eyeballed: palette, grid and `@font-face` from
`src/app/styles/tokyo-theme.css`; font sizes, spacing, radii from
`@mattstack/app-kit`'s `design-system/app-theme.ts`; rail 68px, header 64px, page bar 64px with the 20px
title from `RailShell` + `ConsoleChrome`; row anatomy, 28px action icons and badge wash from
`RunRow.tsx`. The artboards load JetBrains Mono from Google Fonts because the canvas is
hosted; the app uses the vendored woff2.

Deliberate departures: phone controls are 44px (the hit-target floor at 375px); status dots
are 8px, not the 6px health dots, because they carry the page's main signal; the mention badge
uses accent shade 7 in light and bg-on-accent in dark so it passes contrast at 10px.

Revised 2026-08-25 for the presence design (`docs/superpowers/specs/2026-08-24-rt-chat-presence-design.md`):
the third column is the fleet buddy roster (listening/idle/deaf/offline, away messages, room tags,
per-session buddies), the rail gains a DIRECT section, the page bar counts the fleet and shows the
room's wake mode, and the picker offers DM-instead for buddies outside the room.

Rooms, handles and paths are the shape of this machine's worktree pool; the conversations are
illustrative. One drawn affordance is not in plan 2 and is marked as such there:
focusing a herdr pane from a member row (no route addresses a pane by id).

Revised 2026-08-26 for the kit's `PageShell` layout: the three floating cards on
a padded grid became edge-to-edge panels (rooms in the sidebar, page bar as the
header, transcript and roster inside the scroll-clamped content), the page-bar
title dropped from 26px to 20px, and the transcript scrolls sticky-bottom.

Revised 2026-08-28 for rt chat delivery v2: the daemon pushes straight to a
session's socket instead of waking a polled tail, so `deaf` (an armed tail
that died) cannot happen and is gone. The roster is three sections now
(working/idle/offline), not four.

Revised 2026-08-30: archive is gone from the viewer (close replaces it: the
rail row's hover ×, its right-click menu, the ⋯ menu; `Close.dc.html`), and
the transcript is a Reader column (see the next round's spec).

Revised 2026-09-02 for chat at a glance (direction A, "inbox + fleet"): the
landing view is the Inbox (NEEDS YOU / OPEN ASKS / everything else, with a
reader column), the sidebar is one fleet tree (rooms and workstreams grouped
by repo, DM entries with a second line), every handle carries a live task
line from the herdr pane title, the room's roster panel is gone, read
messages fold to their first block, and handles are pool first names pinned
to their herdr pane. Direction exploration:
`explorations/2026-09-02-at-a-glance/`.
