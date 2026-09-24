# App badges: decisions waiting on you

## Goal

A decision waiting on Matt is the most important thing for him to see. Push
notifications fire once and are gone, and nothing in the shell shows a
standing count. This adds:

- a count badge on a shell tab when that app has decisions waiting, so a
  waiting decision is visible from any other tab;
- a dock icon badge with the total across apps, visible with the window
  closed.

## Scope

A badge counts **gates that surface in a UI and wait on Matt**, and nothing
else. Verified against live data on 2026-09-23:

| Gate | Where it surfaces | Counted |
|---|---|---|
| MR gates (`mr:`), pane-attention gates, escalated herd gates | Board decision queue | Board tab |
| :work gates (`run:`, owner human) | Console, on the run's row and page | Console tab |
| Shepherd questions (herd gates, not escalated) | Only the shepherd pane's form | No. They join the board count once escalated. |
| A plain in-pane form with no gate | Nowhere | No |

Out of scope: chat unread, CI results on Matt's MRs, info notifications, app
health (the menubar dot owns health), and closing orphan gates in the daemon
(filed separately; badges do not depend on it, see "Each app counts itself").

## Design

### Each app counts itself

The count for a tab comes from the app that renders that tab, using the same
rule its own screen uses. The badge therefore always equals what Matt sees
when he clicks through, and a gate the app cannot show (an orphan `run:` gate
whose run is gone) is never counted.

The daemon does not compute counts. Doing so would copy the board's queue
rules into rt, and the two would drift.

### Badge endpoint contract

An app opts in by declaring a badge path in its `mattstack.deck.json`:

```json
{ "badge": "/api/badge" }
```

The path is relative to the app's URL. `GET <app url><badge>` returns:

```json
{ "count": 2 }
```

`count` is a non-negative integer. Any other response (non-2xx, bad JSON,
negative or non-integer count, timeout) means "no badge" for that app.

### Board (`mattstack-apps/apps/board`)

- Move `needsQueue` and the queue assembly out of `Board.tsx` into a module
  both the client and the server import. The client's `queueEntries` and the
  server's count call the same function over the same data, so the tab badge
  and the queue button cannot disagree.
- The server count runs over the rows the board holds (MR rows with their
  attached gates, plus `queueExtras`), not filtered by the client's current
  tab or author filter. This matches the queue button, which already ignores
  filters.
- `GET /api/badge` returns that count. Declare `"badge": "/api/badge"` in
  `apps/board/mattstack.deck.json`.

### Console (`mattstack-apps/apps/console`)

- `GET /api/badge` counts gates with status `open` on a `run:` subject whose
  run exists in `listRuns`. This is the same rule as `hasOpenGate`
  (`src/app/runs/useGates.ts`), which drives `RunRow`'s waiting badge, so
  the tab count equals the number of marked rows' open gates. `parked` does
  not count, per that rule.
- Declare `"badge": "/api/badge"` in `apps/console/mattstack.deck.json`.

### Deck (`mattstack-apps/apps/deck`)

- `ingestManifest` carries the optional `badge` field into the app record.
- `buildDiscoveryApps` (`src/api/discovery.ts`) adds `badge?: string` to
  `DiscoveryApp`, passed through only when the record has one. It is a path,
  never an absolute URL.

### Mac app (`rt-tray`)

- `DiscoveryApp` (`Sources-core/Launch/OpenLink.swift`) gains an optional
  `badge`. Decoding stays tolerant of catalogs without it, including the
  cached `~/.mattstack/rt/window-apps-cache.json`.
- On the existing 10s status tick (`AppDelegate.swift`), fetch the badge for
  every catalog app that declares one, concurrently, with a short timeout
  (2s). The fetch lives in a small `BadgePoller` whose pure parts
  (response parsing, summing, label formatting) sit in `Sources-core` so
  `MattstackCoreChecks` can test them.
- `WindowModel` holds `badges: [String: Int]`, replaced wholesale each tick.
  An app whose fetch failed is absent from the map, so its tab shows no
  badge rather than a stale number.
- **Tab:** `TabButton` (`Window/MattstackWindowView.swift`) shows a count
  pill after the label when the app's count is above 0, and nothing at 0.
  Colors come from the window's existing tokens, in both schemes.
- **Dock:** `NSApp.dockTile.badgeLabel` is the sum of all counts, or `nil`
  at 0. Counts above 99 render as `99+` on both the tab and the dock.
- The app is a Dock app for the whole run (`main.swift`), so the dock badge
  works with the window closed. Polling runs whether or not the window is
  open.

## Failure behavior

| Situation | Result |
|---|---|
| App down, slow, or returns garbage | That tab shows no badge; the dock sum leaves it out |
| Deck catalog unavailable | Last cached catalog is used, as today |
| App has no `badge` in its manifest | Never polled, never badged |
| Gate answered on any surface | The app's count drops on its next computation; the badge follows within one tick (10s) |

## Testing

- **Board:** unit tests for the shared queue function (open, parked,
  unassigned, stuck delivery included; answered and closed excluded;
  `queueExtras` included) and for `/api/badge`.
- **Console:** `/api/badge` counts open gates on existing runs, excludes
  parked, answered, and gates whose run is missing.
- **Deck:** discovery passes `badge` through when present and omits it when
  absent.
- **Tray:** `MattstackCoreChecks` for parsing, summing, `99+` formatting,
  and a failed fetch dropping out of the map.
- **Real check:** in a scratch-built dev app (never the installed or
  blessed bundles), under an isolated HOME wherever the rt binary runs:
  open a real gate on the board and a real `run:` gate on the console,
  screenshot the tab badges and the dock badge in light and dark mode, say
  what looks wrong, then answer both gates and confirm every badge clears.
