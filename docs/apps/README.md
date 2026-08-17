# mr-board

a one-page board of your team's open gitlab merge requests that are ready for review, so you can drop a single link in slack instead of pasting MR urls. terminal-styled (tokyo night), server-rendered data with a small react client, zero database.

each MR shows a status dot (hover for the full blocker list), title, branch, a single prioritized status phrase (`conflicts` > `ci failing` > `ci running` > `approved` > `n/m approved` > `needs review`), diff size, age, and a linear ticket link when the branch or title carries a ticket id. rows and grid views, light/dark/system theme, refreshes itself every 60s.

each member view shows that member's name and a deterministic pixel-sprite avatar in the header; the **All** view lists all team members' MRs together. every user gets their own creature derived from their username, with no image hosting involved.

## screenshot

no screenshot yet: the earlier ones were captured against a real team's actual merge requests, branch names, and reviewer identities, so none of them ship with this repo. to see the board's layout yourself without wiring up a real GitLab project first, copy `config.team.example.json` → `config.json` (a filled-in demo roster: `ada`, `grace`, `linus`, each with their own deterministic invadrs avatar) and `bun run serve`.

## run it

requires [bun](https://bun.sh).

```sh
bun install
bun run setup   # prompts for tokens + your defaults, writes .env and config.json
bun run serve   # http://localhost:7930
```

`bun run setup` is idempotent -- re-run it any time to rotate a token or change your default member. it prompts for:

- **GitLab personal access token** (`read_api` scope) -- create at `https://gitlab.com/-/user_settings/personal_access_tokens`
- **your GitLab username** -- used as the board's default view
- **path to your local repo checkout** (optional) -- enables the right-click "launch review" action; leave blank to skip
- **Slack integration** -- opens a browser to authorize a Slack app; each teammate mints their own user token this way, so reactions and messages appear as *them*. only teammates added as **Collaborators** on the app can complete this flow

or configure manually: copy `config.example.json` → `config.json` and edit; put `GITLAB_TOKEN=…` and optionally `SLACK_TOKEN=…` in `.env`. `config.team.example.json` is a filled-in demo roster (fake names, fake project) if you just want to see it render before pointing it at a real one.

## config

`config.json` (gitignored) drives everything:

| field | meaning |
|---|---|
| `gitlabHost` | your gitlab instance, e.g. `https://gitlab.com` |
| `projects` | project paths whose MRs are eligible |
| `members` | array of `{ "username", "name"? }` -- the teammates whose authored MRs the board shows, in sidebar order |
| `defaultMember` | member username the board opens to by default (or `"all"`); the URL and remembered state override it |
| `title` | page heading and tab title |
| `port` | listen port (default 7930) |
| `host` | bind address; default `127.0.0.1`, set e.g. `"0.0.0.0"` to serve the LAN directly -- see [sharing it](#sharing-it-optional) |
| `reviewCwd` | absolute path a review agent's herdr pane starts in (a repo checkout); empty disables the review launch. see [review integration](#review-integration-local-only) |
| `reviewsWorkspace` | herdr workspace label reviews are grouped under (default `reviews`) |
| `reviewSkill` | domain skill the review wrapper delegates to, e.g. `myteam:review`; empty = the wrapper reviews generically. `respondSkill` / `doctorSkill` are the same for the respond / doctor actions |

the board lists open, non-draft MRs authored by any configured member in one of `projects`. a left sidebar switches between **All** (the whole team) and a single member; the **All** view (and each member view) can be grouped by age / author / status / pipeline and sorted by oldest / pipeline / review progress. the current member, grouping, and sort live in the URL (shareable) and are remembered across visits.

## tokens

`bun run setup` handles both. under the hood:

- **`GITLAB_TOKEN`** -- env var (bun auto-loads `.env`). needs `read_api` scope only; the board never writes to gitlab. as a fallback it also reads `gitlabToken` from `~/.rt/secrets.json` if you happen to have one.
- **`SLACK_TOKEN`** -- optional user token (`xoxp-…`) for the review-thread integration. minted via the OAuth flow in `bun run setup`, or paste manually into `.env`. same `~/.rt/secrets.json` fallback (as `slackToken`). without it, the Slack menu actions stay disabled and the board runs fine.

## endpoints

- `/` -- the board
- `/data.json` -- the snapshot the client renders: `{ title, members, mrs, fetchedAt, fetchError, local, canInvite, peering }`; each MR may carry a `review` status when a review is in flight. `canInvite` is true when the request is local and this board has both a switchboard url and an admin secret, so it can hand out invites. `peering` is `"ok"` or `"unauthorized"` for a board that is peered, and `null` when it is not peering at all
- `/review` -- POST `{ mrUrl, iid }` to launch a review (local requests only; see below)
- `/nudge` -- POST `{ mrUrl, iid, reviewer }` to ask a peer's board for a re-review on your own MR (local requests only; see [peer boards + switchboard](#peer-boards--switchboard-optional))
- `/healthz` -- 200 `ok`, for supervisors and tunnels

data is cached in memory for 60s with stale-while-revalidate: bursts of visitors cost one gitlab round trip, and if gitlab is down the board serves the last good snapshot with a "data from N minutes ago" banner.

## sharing it (optional)

the server binds a local port and has no auth of its own -- anything public-facing must bring its own gate. the setup this was built for:

1. run it persistently (launchd, systemd, whatever you have)
2. point a [cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) at the port and route a hostname to it
3. put [cloudflare access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of that hostname with a policy for your org's email domain (google or any idp, or the built-in one-time pin)

the MR titles, branch names, and reviewer names on this page are your employer's internal data -- do not expose it without the gate.

the server binds `127.0.0.1` by default, so nothing on your LAN can reach it directly -- the cloudflared tunnel above still works fine, since it connects out from the same machine rather than in over the network. viewing it directly from another device on your LAN needs `"host"` set in `config.json` (e.g. `"0.0.0.0"`, or a specific address) to opt into the wider bind. do that with eyes open: the review-launch and peer-invite actions are gated by an `isLocal` check on the request's Host header alone, not by network topology, so a wider bind means anyone who can reach that port and forge a local-looking Host header reaches those actions too. prefer the tunnel.

## review integration (local only)

when you open the board from a local hostname (`mrs.localhost`, `localhost`, `127.0.0.1`), right-clicking an MR row opens an action menu with **launch review**: the server spawns a fresh [herdr](https://herdr.dev) tab (in the `reviewsWorkspace`, labelled `!<iid>`), starts `claude` in `reviewCwd`, and runs `/mr-board:review <url> --state <path> --status-bin <path> [--skill <reviewSkill>]`. the board injects the domain skill and its own status-writer path as flags, so the wrapper skill itself carries no repo- or team-specific knowledge. the wrapper reports each lifecycle status back to the board, which owns every slack reaction (👀 on `reviewing`, 💬/✅ on `done`) so the agent never touches slack. that thin wrapper emits `reviewing` / `done` / `error` to a state file the board reads, so the row shows a live badge (with an instant optimistic badge + toast the moment you launch), and delegates the actual review to the configured `reviewSkill` (or reviews generically when none is set). launching again while a review is live re-focuses its tab instead of spawning another.

a plain click still opens the MR in a new browser tab (the menu also has open-in-gitlab and copy-for-slack). the review action is gated by an `isLocal` check on both the client (the menu item only appears locally) and the server (`POST /review` returns 403), so it never fires when the board is viewed through a public tunnel. review status files live in the gitignored `state/reviews/` dir and are pruned after 24h.

depends on herdr running locally and on the `mr-board:{review,respond,doctor}` wrapper skills being installed (plus whatever domain skills you point `reviewSkill` / `respondSkill` / `doctorSkill` at, or bind via the manifest below).

### skill bindings (.mattstack/skills.jsonc)

the wrapper skills are parameterized skills (the convention lives in the mattstack-skills plugin's `parameterized-skills` skill): each declares slots for the domain skills that own the actual work, and resolves them with a vendored `scripts/resolve-args.sh`. resolution order, in each wrapper: an explicit `--skill` flag (what the board injects from `reviewSkill` / `respondSkill` / `doctorSkill`) always wins, unchanged; with no `--skill`, the wrapper resolves its slot bindings from the nearest `.mattstack/skills.jsonc` (walking up from the working dir, then `~/.mattstack/skills.jsonc`); a failed resolution degrades loudly (the resolver prints machine-readable json errors, the wrapper never guesses a binding) before falling back to the generic domain-free behavior.

slots and contracts: `mr-board:review` has slot `review` (contract `mr-review@1`), `mr-board:respond` has slot `respond` (`mr-respond@1`), and `mr-board:doctor` has slots `doctor` (`mr-doctor@1`, the checkout tier) and `doctor-api` (`mr-doctor-api@1`, the `--tier api` no-checkout tier). a bound skill must declare the matching contract in its `metadata.provides`.

example bindings, as the acme domain pack provides them:

```jsonc
// ~/.mattstack/skills.jsonc
{
  "version": 1,
  "bindings": {
    "mr-board:review":  { "review": "acme:mr-board-review" },
    "mr-board:respond": { "respond": "acme:mr-board-respond" },
    "mr-board:doctor": {
      "doctor": "acme:mr-board-doctor",
      "doctor-api": "acme:mr-board-doctor-api"
    }
  }
}
```

## peer boards + switchboard (optional)

when your teammates each run their own mr-board, a small relay called the switchboard lets the boards nudge each other about re-reviews without either board talking to the other directly. it's entirely optional: skip it and the board works exactly as described above.

what it adds:

- **live peer badges**: when a peer's board reports a review going into or out of flight on one of your MRs, your row picks up the badge
- **request re-review**: a row action on your own MR ("request re-review from `<reviewer>`") asks that reviewer's board directly. `POST /nudge` answers `409` with a plain-text reason if the reviewer isn't on the switchboard, or `{"ok":true,"queued":true}` if the relay is unreachable and the ask gets queued for the next tick
- **guarded auto re-review**: the reviewer side can run `bun run triage` on a cron so an incoming nudge gets picked up and re-dispatched automatically, gated by the guardrails below

### teammate setup

peer features also need `defaultMember` in `config.json` set to your own GitLab username: it is how the board tells your MRs from everyone else's, so with `"all"` it stays silent and publishes nothing to peers.

`bun run setup` prompts once for a board invite: paste the whole link your operator gave you (`.../invite/<code>`) and setup redeems it, writing the switchboard URL to `config.json` as `switchboard.url` and the token it gets back to `.env` as `SWITCHBOARD_TOKEN`. blank input keeps whatever is already configured. a bare URL (no `/invite/<code>`) falls back to the old manual flow: it prompts for a board token separately, for the rare case someone hands you a token out of band instead of a link. either way, everything degrades cleanly when peer features aren't set up: no badges, no nudge action, `/nudge` returns `400`.

a board that's already running doesn't need a restart to join or re-join: open settings and use "join peer boards" (or "re-join with a new invite" if it's already peered) to paste the link there instead.

if the switchboard ever stops accepting this board's token -- the operator re-minted it, for instance -- the settings modal starts showing "peering token rejected -- re-join with a new invite" after a few failed polls. the fix is the same either way: get a fresh invite from your operator and re-join.

### operator setup (run a switchboard)

the switchboard is a separate deployable in `switchboard/`, a dumb store-and-forward relay, one process, one sqlite file. deploy it to [Railway](https://railway.app):

- service root: the repo root, not `switchboard/`. the relay imports shared types from `src/peer/`, so a service rooted at `switchboard/` cannot resolve them
- builder: Dockerfile, path `switchboard/Dockerfile`. it copies only the relay's files and runs no `bun install`, because the board's package.json has a `file:` dependency that only resolves on a dev machine
- watch paths: `switchboard/**` and `src/peer/envelope.ts`, so board-only pushes do not trigger a redeploy of the relay
- attach a volume and point `SWITCHBOARD_DB` at a path on it (otherwise the database lives on ephemeral disk and every redeploy loses all board registrations)
- env: `SWITCHBOARD_ADMIN_TOKEN` (pick your own value, the bearer token for minting boards)
- `PORT` is supplied by Railway

to invite teammates from the board's own UI instead of curl, put the admin token where the board (not the relay) reads it: `switchboardAdminToken` in `~/.rt/secrets.json`, or the `SWITCHBOARD_ADMIN_TOKEN` env var, on the machine running your own board -- plus `switchboard.url` in your `config.json`. with both set, open settings ("team members") locally and each roster member gets an **invite** button; anyone already peered shows **peered** with a **re-invite** button instead, and a free-text row at the bottom invites handles that aren't on your roster at all. either action mints a one-time invite link (`<url>/invite/<code>`, expires in 7 days) shown right there to copy and paste to that teammate. re-invite is the rotation story, with one caveat worth knowing: minting the new invite changes nothing by itself. their current board keeps working, and their access ends only when the new invite is actually redeemed and the token behind it rotates. a true revoke (cutting a board off without waiting on them) is not in v1 -- for that, re-mint or delete the board on the relay directly.

the invite code travels in the url path, so it shows up in the relay host's access logs (the platform's edge logs, e.g. railway's) even though the relay itself never logs it. treat invite links as short-lived secrets: hand them over the same way you would a password, and if one may have leaked, re-invite that handle. the relay keeps one outstanding invite per handle, so minting a fresh one replaces the old code and the leaked link stops working.

the no-UI path still works too -- the relay endpoints stay plain HTTP with the admin bearer token, for scripting or a headless operator setup:

```sh
# mint a board directly (username = their GitLab username, lowercased; one board
# per username; re-minting rotates the token, so hand out the new one if you re-mint)
curl -X POST $URL/boards \
  -H "Authorization: Bearer $SWITCHBOARD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"grace"}'

# or mint an invite link the same way the settings modal does
curl -X POST $URL/invites \
  -H "Authorization: Bearer $SWITCHBOARD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"grace"}'
# -> {"code":"...","username":"grace","expiresAt":...} -- hand out "$URL/invite/<code>"
```

the invite link works everywhere (`bun run setup`'s prompt and the board's own "join peer boards"); the raw `POST /boards` token only works with `bun run setup`'s manual fallback (paste the bare switchboard URL, then the token separately), since "join peer boards" only accepts a link.

### reviewer-side automation

a nudge only auto-launches a re-review if the reviewer has `bun run triage` running on a cron (rt cron, or a plain cron entry, either works) with `triage.enabled: true` in their `config.json`. each run applies the same guardrails before dispatching:

- the reviewer's prior review on that MR is `done` with a `comment` outcome
- no review is already in flight for that MR
- the nudge is fresh, judged on the relay's `receivedAt` (never the sender's clock), and expires after 48h
- a per-MR cooldown and a daily dispatch budget cap how often triage will act

a nudge that clears the guardrails launches through the same resume-or-fresh path as the manual re-review button. every disposal (launched, rejected, or expired) publishes an outcome back to the asker's board so their chip resolves. launches, guardrail rejections, and expiries also raise a desktop notification; a rejection caused by a failed launch attempt is still audited and published, just without one. an unresolved nudge self-expires after 48h with a visible retry cue on the asking board.

### privacy

the switchboard stores envelopes it never inspects. payloads carry MR urls, iids, statuses, usernames, and timestamps only, never titles, diff content, or credentials. board endpoints, `/nudge` included, stay local-only whether or not peer features are configured.

## dev

```sh
bun test        # unit tests: filtering, grouping, cache, ticket extraction
bun run serve   # client is bundled in-memory at startup; restart to pick up changes
```
