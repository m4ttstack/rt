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

`bun run setup` is idempotent — re-run it any time to rotate a token or change your default member. it prompts for:

- **GitLab personal access token** (`read_api` scope) — create at `https://gitlab.com/-/user_settings/personal_access_tokens`
- **your GitLab username** — used as the board's default view
- **path to your local repo checkout** (optional) — enables the right-click "launch review" action; leave blank to skip
- **Slack integration** — opens a browser to authorize a Slack app; each teammate mints their own user token this way, so reactions and messages appear as *them*. only teammates added as **Collaborators** on the app can complete this flow

or configure manually: copy `config.example.json` → `config.json` and edit; put `GITLAB_TOKEN=…` and optionally `SLACK_TOKEN=…` in `.env`. `config.team.example.json` is a filled-in demo roster (fake names, fake project) if you just want to see it render before pointing it at a real one.

## config

`config.json` (gitignored) drives everything:

| field | meaning |
|---|---|
| `gitlabHost` | your gitlab instance, e.g. `https://gitlab.com` |
| `projects` | project paths whose MRs are eligible |
| `members` | array of `{ "username", "name"? }` — the teammates whose authored MRs the board shows, in sidebar order |
| `defaultMember` | member username the board opens to by default (or `"all"`); the URL and remembered state override it |
| `title` | page heading and tab title |
| `port` | listen port (default 7930) |
| `reviewCwd` | absolute path a review agent's herdr pane starts in (a repo checkout); empty disables the review launch. see [review integration](#review-integration-local-only) |
| `reviewsWorkspace` | herdr workspace label reviews are grouped under (default `reviews`) |
| `reviewSkill` | domain skill the review wrapper delegates to, e.g. `myteam:review`; empty = the wrapper reviews generically. `respondSkill` / `doctorSkill` are the same for the respond / doctor actions |

the board lists open, non-draft MRs authored by any configured member in one of `projects`. a left sidebar switches between **All** (the whole team) and a single member; the **All** view (and each member view) can be grouped by age / author / status / pipeline and sorted by oldest / pipeline / review progress. the current member, grouping, and sort live in the URL (shareable) and are remembered across visits.

## tokens

`bun run setup` handles both. under the hood:

- **`GITLAB_TOKEN`** — env var (bun auto-loads `.env`). needs `read_api` scope only; the board never writes to gitlab. as a fallback it also reads `gitlabToken` from `~/.rt/secrets.json` if you happen to have one.
- **`SLACK_TOKEN`** — optional user token (`xoxp-…`) for the review-thread integration. minted via the OAuth flow in `bun run setup`, or paste manually into `.env`. same `~/.rt/secrets.json` fallback (as `slackToken`). without it, the Slack menu actions stay disabled and the board runs fine.

## endpoints

- `/` — the board
- `/data.json` — the snapshot the client renders: `{ title, members, mrs, fetchedAt, fetchError, local }`; each MR may carry a `review` status when a review is in flight
- `/review` — POST `{ mrUrl, iid }` to launch a review (local requests only; see below)
- `/healthz` — 200 `ok`, for supervisors and tunnels

data is cached in memory for 60s with stale-while-revalidate: bursts of visitors cost one gitlab round trip, and if gitlab is down the board serves the last good snapshot with a "data from N minutes ago" banner.

## sharing it (optional)

the server binds a local port and has no auth of its own — anything public-facing must bring its own gate. the setup this was built for:

1. run it persistently (launchd, systemd, whatever you have)
2. point a [cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) at the port and route a hostname to it
3. put [cloudflare access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of that hostname with a policy for your org's email domain (google or any idp, or the built-in one-time pin)

the MR titles, branch names, and reviewer names on this page are your employer's internal data — do not expose it without the gate.

## review integration (local only)

when you open the board from a local hostname (`mrs.localhost`, `localhost`, `127.0.0.1`), right-clicking an MR row opens an action menu with **launch review**: the server spawns a fresh [herdr](https://herdr.dev) tab (in the `reviewsWorkspace`, labelled `!<iid>`), starts `claude` in `reviewCwd`, and runs `/mr-board:review <url> --state <path> --status-bin <path> [--skill <reviewSkill>]`. the board injects the domain skill and its own status-writer path as flags, so the wrapper skill itself carries no repo- or team-specific knowledge. the wrapper reports each lifecycle status back to the board, which owns every slack reaction (👀 on `reviewing`, 💬/✅ on `done`) so the agent never touches slack. that thin wrapper emits `reviewing` / `done` / `error` to a state file the board reads, so the row shows a live badge (with an instant optimistic badge + toast the moment you launch), and delegates the actual review to the configured `reviewSkill` (or reviews generically when none is set). launching again while a review is live re-focuses its tab instead of spawning another.

a plain click still opens the MR in a new browser tab (the menu also has open-in-gitlab and copy-for-slack). the review action is gated by an `isLocal` check on both the client (the menu item only appears locally) and the server (`POST /review` returns 403), so it never fires when the board is viewed through a public tunnel. review status files live in the gitignored `state/reviews/` dir and are pruned after 24h.

depends on herdr running locally and on the `mr-board:{review,respond,doctor}` wrapper skills being installed (plus whatever domain skills you point `reviewSkill` / `respondSkill` / `doctorSkill` at).

## dev

```sh
bun test        # unit tests: filtering, grouping, cache, ticket extraction
bun run serve   # client is bundled in-memory at startup; restart to pick up changes
```
