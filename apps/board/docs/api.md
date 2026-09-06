# HTTP endpoints

The board serves its own page and a small JSON API on `$PORT` (default
`7930`), always bound to `127.0.0.1`.

Endpoints marked **local-only** are gated by the same
`isLocalRequest` check the row menu uses: the hostname must be `localhost`,
`127.0.0.1`, `*.localhost`, or `*.mattstack`. They return `403` otherwise, so
they never fire for a visitor coming through a public tunnel.

## Reading

| endpoint | notes |
|---|---|
| `GET /` | the board page |
| `GET /data.json` | the snapshot the client renders. `?fresh=1` forces a cache-bypassing refetch (local-only; elsewhere it degrades to a plain cached read) |
| `GET /member?u=<username>` | one member's MRs, a cheaper scoped refresh than the full snapshot |
| `GET /discussions?repo=<repo>&iid=<iid>` | reviewer-participated comment threads for the drawer |
| `GET /review/report?mr=<url>` | the agent's written review markdown for one MR. Read-only display data, so it is available through a tunnel too |
| `GET /events` | server-sent events. A one-way nudge channel: browsers re-pull `/data.json` on any message |
| `GET /healthz` | `200 ok`, for supervisors and tunnels. Answered before any daemon round trip, so a wedged daemon cannot stall a health check |
| `GET /app.js`, `/app.css`, `/style.css`, `/favicon.svg` | client assets |

`/data.json` carries the title, the default member, the visible roster and the
full roster with counts, the MRs, the tab list, Slack availability plus emoji
and templates, `staleAfterDays`, the fetch and sync timestamps and any
`fetchError`, and the sync-scope fields the coverage banner renders. Each MR
may carry `review`, `respond`, `doctor`, `draft`, `slack`, and peer state.
`local` reflects the locality gate. `canInvite` is true when the request is
local and this board holds both a switchboard URL and an admin secret.
`peering` is `"ok"` or `"unauthorized"` for a peered board, and `null` when the
board is not peering at all.

## Launching agents (local-only)

| endpoint | body |
|---|---|
| `POST /review` | `{ mrUrl, iid }`. `400` when `reviewCwd` is unset |
| `POST /respond` | same shape, for your own MR |
| `POST /doctor` | same shape, to repair mechanical breakage |
| `POST /review/outcome` | the launched agent's only channel back to the board. It reports the lifecycle status it wrote, and the board decides which Slack reaction that means |
| `POST /drafts` | approve or dismiss a held doctor draft. The only path from a draft to a GitLab note |

## Mutating (local-only)

| endpoint | body |
|---|---|
| `POST /settings` | flip a member's hidden state |
| `POST /roster` | add or drop a teammate |
| `POST /tabs` | replace the tab list |
| `POST /draft` | flip one of your own MRs between draft and ready, by rewriting the title prefix |
| `POST /api/settings/*` | the settings-kit routes behind the config modal. Reads are as public as `/data.json`; writes are local-only, and a successful write live-reloads the board's config |

## Slack (local-only, and `400` without a Slack token)

| endpoint | body |
|---|---|
| `POST /slack/resolve` | find and cache an MR's review-request message in the channel |
| `POST /slack/refresh` | force a sweep: every MR with no found review request is re-checked now rather than on the next scheduled sweep |
| `POST /slack/post` | post one MR, or a summary of many, to the configured channel |
| `POST /slack/react` | add or remove a review-signal reaction; `remove: true` unreacts |

## Peer boards (local-only)

| endpoint | body |
|---|---|
| `POST /nudge` | `{ mrUrl, iid, reviewer }`, asking a peer's board for a re-review on your own MR. `400` with no switchboard configured, `409` with a plain-text reason when the reviewer is not on the switchboard, or `{"ok":true,"queued":true}` when the relay is unreachable and the ask is queued for the next tick |
| `POST /peer/invite` | mint a one-paste invite. Operator-only: needs the admin token |
| `GET /peer/boards` | list peered boards. Operator-only |
| `POST /peer/join` | redeem an invite, persist the URL and token, and hot-start peering with no restart |

## Caching

Snapshots are cached in memory for 60 seconds with stale-while-revalidate. A
burst of visitors costs one daemon read per project, and if the daemon or the
upstream sync is down the board serves the last good snapshot behind a "data
from N minutes ago" banner.
