# mr-board

a one-page board of your open gitlab merge requests that are ready for review, so you can drop a single link in slack instead of pasting MR urls. terminal-styled (tokyo night), server-rendered data with a small react client, zero database.

each MR shows a status dot (hover for the full blocker list), title, branch, a single prioritized status phrase (`conflicts` > `ci failing` > `ci running` > `approved` > `n/m approved` > `needs review`), diff size, age, and a linear ticket link when the branch or title carries a ticket id. rows and grid views, light/dark/system theme, refreshes itself every 60s.

## run it

requires [bun](https://bun.sh).

```sh
bun install
cp config.example.json config.json   # edit it (see below)
echo 'GITLAB_TOKEN=glpat-...' > .env # a token with read_api scope
bun run serve                        # http://localhost:7930
```

## config

`config.json` (gitignored) drives everything:

| field | meaning |
|---|---|
| `gitlabHost` | your gitlab instance, e.g. `https://gitlab.com` |
| `username` | gitlab username whose authored MRs to show |
| `projects` | project paths to display, in display order; MRs outside this list are hidden |
| `title` | page heading and tab title |
| `port` | listen port (default 7930) |

the board lists MRs that are: authored by `username`, open, not draft, in one of `projects`. grouping follows `projects` order; within a group, most recently updated first.

## token

`GITLAB_TOKEN` env var (bun auto-loads `.env`). needs `read_api` scope only — the board never writes to gitlab. as a fallback it also reads `gitlabToken` from `~/.rt/secrets.json` if you happen to have one.

## endpoints

- `/` — the board
- `/data.json` — the snapshot the client renders (title, groups, fetch timestamp)
- `/healthz` — 200 `ok`, for supervisors and tunnels

data is cached in memory for 60s with stale-while-revalidate: bursts of visitors cost one gitlab round trip, and if gitlab is down the board serves the last good snapshot with a "data from N minutes ago" banner.

## sharing it (optional)

the server binds a local port and has no auth of its own — anything public-facing must bring its own gate. the setup this was built for:

1. run it persistently (launchd, systemd, whatever you have)
2. point a [cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) at the port and route a hostname to it
3. put [cloudflare access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of that hostname with a policy for your org's email domain (google or any idp, or the built-in one-time pin)

the MR titles, branch names, and reviewer names on this page are your employer's internal data — do not expose it without the gate.

## dev

```sh
bun test        # unit tests: filtering, grouping, cache, ticket extraction
bun run serve   # client is bundled in-memory at startup; restart to pick up changes
```
