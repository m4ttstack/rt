# App badges: decisions waiting on you

## Goal

A decision waiting on Matt is the most important thing for him to see. Push
notifications fire once and are gone, and nothing in the shell shows a
standing count. This adds:

- a count badge on a shell tab when that app has decisions waiting on Matt,
  so a waiting decision is visible from any other tab;
- a dock icon badge with the total across apps, visible with the window
  closed.

## What counts

A badge counts **gates Matt can answer from that tab**. One rule, applied
by each app to the gates it renders:

- `status` is `open` or `parked` (parked means the pane stepped away and
  nobody answered; it is still Matt's decision);
- `owner` is `human` or null (never `herd:*`: the shepherd answers those,
  and the daemon rejects anyone else's answer);
- the subject is one that surface renders;
- a `pane-attention` gate counts only once it has been open 2 minutes,
  on the board for `agent:`/`herd:` subjects and on the console for a
  `run:` subject (most clear on their own within 1 to 4 minutes, so
  counting them sooner makes the badge blink).

The count is of gates, not rows: a run with two open gates of different
kinds counts 2.

Verified against live data and a full code trace on 2026-09-23:

| Gate | Where it surfaces | Counted |
|---|---|---|
| MR gates (`mr:`) owned by Matt | Board decision queue | Board tab |
| Pane-attention gates, open 2+ min, owned by Matt | Board decision queue (`agent:`/`herd:` subjects); console run row (`run:` subject, e.g. an orphaned :work run) | Board tab, or Console tab for a `run:` subject |
| :work and pipeline gates (`run:`, owner human, run exists) | Console run row and run page; also the MR row its run recorded on the board | Console tab, and the Board tab when the gate shows on a board MR row; the dock counts it once by gate id |
| Shepherd workers' gates (`run:`, owner `herd:*`) | Console run row ("waiting on shepherd"); shepherd pane form | No |
| Escalated shepherd gates (all `run:` today) | Console run row ("waiting on shepherd"); notification to the shepherd pane | No. A "shepherd is slow" signal the shepherd resolves. |
| Board queue items for `execution: unassigned` or `delivery: stuck` | Board decision queue | No. They mean an answer did not land, not a decision waiting. They stay in the queue. |
| A blocked pane with no gate | Console attention band; becomes a pane-attention gate after 2 reconciler sweeps for tracked agents | Only once it becomes a pane-attention gate (above). With 60s sweeps, 2-sweep debounce, and the 2-minute age, a wedged pane badges 3 to 4 minutes after it wedges. |
| Orphan `run:` gate whose run is gone | Nowhere | No (daemon cleanup is RT-259) |

Out of scope: chat unread, CI results on Matt's MRs, info notifications, and
app health (the menubar dot owns health).

A pane-attention gate answered with focus-pane while the pane stays blocked
clears from the badge, and the next sweep opens a fresh gate, so it returns
about 3 minutes later. A dismissed one stays suppressed while the pane's
state is unchanged.

Owner values: legacy rows carry `owner` null and count the same as `human`.
`rt gate list --json` rewrites null to `"human"` (`commands/gate.ts`), so
never use the CLI to validate the owner rule; read the daemon or an app's
API.

Known limit: MR gates on a hidden team member's MR are not attached to a
visible row (`visibleMrsFor`, `apps/board/src/data.ts`) and are not counted.

## Design

### Each app counts itself

The count for a tab comes from the app that renders that tab, over the same
data its own screen uses, so a gate the app cannot show is never counted.
The daemon does not compute counts; doing so would copy each app's rendering
rules into rt, and they would drift.

The board's queue button keeps showing everything it shows today. The badge
counts the decision subset of it (the rule above), so the two can differ
when the queue holds unassigned, stuck, or young attention items.

### Badge endpoint contract

An app opts in by declaring a badge path in its `mattstack.deck.json`:

```json
{ "badge": "/api/badge" }
```

The path is relative to the app's URL. `GET <app url><badge>` returns:

```json
{ "count": 2, "path": "/?gate=<id>", "ids": ["<gate id>", "<gate id>"] }
```

`ids` are the daemon's global gate ids behind `count`. Each tab shows its
own `count`; the dock unions `ids` across apps so a gate two apps badge
counts once, and adds the `count` of any reading without `ids`. An app
must never report ids of its own making: the tray merges them across apps.

`count` is a non-negative integer. `path` is optional: a path inside the
same app (starting with `/`) to the page showing the oldest counted
decision. The tray opens it in that app's own tab, so a badge can never
point outside its app. Any other response (non-2xx, bad JSON, negative
or non-integer count, timeout) is a failed fetch.

### Board (`mattstack-apps/apps/board`)

The board's gate cache must be correct before its count can be:

- `GateCache.applyOpened` (`src/gates/cache.ts`) takes `owner` from the
  `gate/opened` payload instead of hard-coding null. Today a pane-attention
  gate opened while the board runs is excluded from `queueExtras` until the
  next board restart. When a row with the same id is already cached, keep
  its `openedAt` so a duplicate frame cannot restart the 2-minute clock.
- The board's client `GateRow` (`src/gates/store.ts`) gains `owner`, copied
  by both `attachGates` (`cache.ts`) and `buildQueueExtras` (`ingest.ts`).
  Without it the predicate cannot exclude herd-owned rows, and an escalated
  herd-owned pane-attention gate (which `buildQueueExtras` admits) would be
  counted.
- The cache reconciles on every relay reconnect and on a 60s timer, using
  the same two `gateList` calls boot uses (`reconcileGatesOnBoot`,
  `reconcileAttentionGatesOnBoot`). Today it reconciles only at boot, so a
  daemon restart (one happened 2026-09-23 19:02) loses every frame in the
  gap and the count sticks high or misses gates. Reconnect is detected from
  the `mr:status` frame the daemon sends on every socket open
  (`lib/daemon/api-server.ts`), so rt-client needs no change. That frame
  also fires on connection-state changes; the extra reconciles are cheap
  and idempotent.
- Tests: a relay `gate/opened` frame for a human-owned pane-attention gate
  lands in `queueExtras` with its owner; an escalated herd-owned attention
  row is in `queueExtras` but not counted.

Then the count:

- `src/gates/badge.ts` exports the badge predicate (the rule above). It
  counts a `run:` gate the board shows on the MR row its run recorded,
  the same set its decision queue shows. The
  client's `needsQueue` and queue button are unchanged. The server applies it to the rows the board holds
  (MR rows with attached gates, plus `queueExtras`), unaffected by the
  client's tab or author filter.
- `GET /api/badge` returns the count and, when above 0, `path` =
  `/?gate=<id>` for the oldest counted gate. Declare
  `"badge": "/api/badge"` in `apps/board/mattstack.deck.json`.

### Console (`mattstack-apps/apps/console`)

- `GET /api/badge` counts gates on `run:` subjects whose run exists in
  `listRuns`, under the rule above. A `kind: pane-attention` gate on a
  `run:` subject counts once it is 2 minutes old. The board may count the
  same `run:` gate; the tray counts each id once in the dock.
  `path` is the run page of the oldest counted gate (`/runs/<repo>/<runId>`).
- The run row marker (`hasOpenGate`, `src/app/runs/useGates.ts`, painted by
  `RunRow.tsx`) shows for any `open` or `parked` gate, labeled by owner:
  "blocked" when the gate is Matt's (counted), "waiting on shepherd" when
  it is `herd:*`. Today it marks only `open` gates, with no owner label.
  The rows marked "blocked" are exactly the tab count's gates.
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
- A `BadgePoller` runs on its own 10s timer, not inside `refreshStatus`
  (that path returns early when the daemon is down and holds an
  `isRefreshing` latch, so a slow badge fetch would delay health). It fetches
  every declared badge concurrently with a 2s timeout. Its pure parts
  (parsing, the failure hold, summing, label formatting) live in
  `Sources-core` so `MattstackCoreChecks` can test them.
- **Failure hold:** an app keeps its last count through 2 consecutive failed
  fetches, then drops out (no badge). This matches the tray's existing
  `consecutiveStatusFailures >= 2` rule for daemon health.
- `WindowModel` holds `badges: [String: BadgeReading]` (count plus optional
  path).
- **Tab:** `TabButton` (`Window/MattstackWindowView.swift`) shows a count
  pill after the label when the count is above 0, and nothing at 0. Colors
  come from the window's existing tokens, in both schemes. Clicking the tab
  label keeps today's behavior (it does not navigate the webview). Clicking
  the pill itself selects the tab and loads its `path` (the oldest counted
  decision), through `WindowModel.open(OpenRequest)`.
- **Dock:** `NSApp.dockTile.badgeLabel` is the sum of all counts, or `nil`
  at 0. Counts above 99 render as `99+` on both the tab and the dock. When
  the window is closed and the dock sum is above 0, clicking the dock icon
  opens the window on the first badged tab (in tab order) at its `path`
  (`applicationShouldHandleReopen`, keeping the `suppressReopenShowUntil`
  guard). With the window open, a dock click just activates it with no
  navigation. With a sum of 0, a dock click behaves as today. Tab order is
  deck's displayName sort (Board before Console).
- The app is a Dock app for the whole run (`main.swift`) and warms the
  catalog at launch, so the dock badge works with the window closed.

## Failure behavior

| Situation | Result |
|---|---|
| One slow or failed fetch | Last count held |
| App down, 3rd consecutive failure | That tab's badge clears; the dock sum leaves it out |
| Daemon down | Console's badge endpoint fails and clears after the hold; the board serves its cached count until its reconcile reconnects |
| Daemon restarts | Board reconciles on relay reconnect (the `mr:status` open frame); counts correct within one tick |
| Deck catalog unavailable | Last cached catalog is used, as today |
| App has no `badge` in its manifest | Never polled, never badged |
| Gate answered on any surface | The app's count drops on its next computation; the badge follows within one tick (10s). If the board never cached that gate, its 60s reconcile catches it: worst case about 70s. |

## Rollout

Deck reads a manifest only at register or adopt, and the tray loads the
catalog once per launch. After the change ships: re-register board and
console with deck, then relaunch the tray.

## Testing

- **Board:** the two cache tests above; reconcile on the `mr:status` frame
  replaces the cache; a duplicate opened frame keeps `openedAt`; the badge predicate (open and parked counted;
  answered, closed, herd-owned, unassigned-only, stuck-only excluded;
  pane-attention counted only at 2+ minutes); `/api/badge` count and `url`.
- **Console:** `/api/badge` counts open and parked human gates on existing
  runs and `run:` pane-attention gates 2+ minutes old, and excludes
  herd-owned, young pane-attention, answered, and missing-run gates; the row marker shows "blocked" for counted gates and "waiting on
  shepherd" for herd-owned ones.
- **Deck:** discovery passes `badge` through when present and omits it when
  absent.
- **Tray:** `MattstackCoreChecks` for parsing, the 2-failure hold, summing,
  `99+` formatting, the pill-click target, and the dock-click target.
- **Real check:** in a scratch-built dev app (never the installed or
  blessed bundles), under an isolated HOME wherever the rt binary runs:
  open a real human-owned gate on the board and a real `run:` gate on the
  console, screenshot the tab badges and the dock badge in light and dark
  mode, say what looks wrong, then answer both gates and confirm every badge
  clears. Also restart the daemon with a gate open and confirm the board
  badge is still correct one tick later.
