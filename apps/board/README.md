# board

One page of your team's open GitLab merge requests that are ready for review,
so you can drop a single link in Slack instead of pasting MR URLs. Terminal
styled in tokyo night, server-rendered with a small React client, and zero
database.

Every teammate gets a deterministic pixel-sprite avatar derived from their
username, so there is no image hosting anywhere in the stack.

## Contents

- [What it shows](#what-it-shows)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Usage](#usage)
- [Configuration](#configuration)
- [State](#state)
- [Slack](#slack)
- [Agent actions](#agent-actions)
- [Peer boards](#peer-boards)
- [Deployment](#deployment)
- [Development](#development)
- [Part of mattstack](#part-of-mattstack)
- [Contributing](#contributing)
- [License](#license)

## What it shows

Each row carries a status dot (hover it for the full blocker list), the title,
the branch, one prioritized review-state phrase, the diff size, the age, and a
Linear ticket link when the branch or title carries a ticket id.

The status phrase is the human review axis only, in this order:

`changes requested` > `approved` > `N comments` > `comments resolved` >
`n/m approved` > `needs review`

Mechanical blockers (merge conflicts, red CI) are not folded into it. They
render as their own flag chips above the title, so the phrase always says where
the MR actually sits in review.

There is no screenshot in this README. The ones taken so far were captured
against a real team's merge requests, branch names, and reviewer identities. To
see the layout yourself without wiring up a real GitLab project, copy
`config.team.example.json` to `config.json`. It is a filled-in demo roster
(`ada`, `grace`, `linus`), each with their own deterministic avatar.

## Features

- **One shareable page.** Current member, tab, grouping, and sort all live in
  the URL, and are remembered across visits.
- **Rows or grid**, light, dark, or system theme.
- **Group and sort.** Group by age, author, status, or my reviews; sort by
  oldest or by progress.
- **Live.** The page polls every 60 seconds and also holds a server-sent-events
  channel, so a status change pushed by an agent or a peer lands right away.
- **Slack, by convention not by workflow.** Post a review request, then read
  and set the three review reactions straight from a row.
- **Agent actions.** Right-click an MR to hand it to a Claude Code agent in a
  herdr pane: review it, respond to feedback on your own, or call the doctor on
  red CI and merge conflicts.
- **Tabs.** Beyond the author roster, a tab can source the approval queue for a
  named codeowners section.
- **Peer boards.** Optionally, teammates' boards can nudge each other about
  re-reviews through a small relay.

## Requirements

- [Bun](https://bun.sh).
- An **rt daemon** with the board's projects registered and the `project-mrs`
  grant. This is where MR data comes from: the board reads one socket call per
  project, and makes no forge traffic of its own. See
  [rt](https://github.com/m4ttstack/rt).
- Optionally a GitLab personal access token (`read_api`) for member display
  names and MR notes, a Slack user token for the Slack actions, and
  [herdr](https://herdr.dev) for the agent actions.

## Installation

```sh
git clone https://github.com/m4ttstack/apps.git
cd apps                       # the workspace root, not this app's own dir
bun install                   # workspace install: packages/*, apps/*
cd apps/board
```

## Quickstart

```sh
cp config.example.json config.json   # fill in gitlabHost, projects, rtRepos, members
bun run setup                        # prompts for tokens and your defaults
bun run serve                        # http://localhost:7930
```

`config.json` carries the team-shared fields (`gitlabHost`, `projects`,
`rtRepos`, `members`, `title`, and so on). Copy it once per team, or point
everyone at a shared mattstack team settings store instead.

`bun run setup` only handles what is yours, and is idempotent: re-run it any
time to rotate a token or change your default view. It prompts for:

- **A GitLab personal access token** (`read_api` scope), created at
  `<your-gitlab>/-/user_settings/personal_access_tokens`.
- **Your GitLab username**, used as the board's default view.
- **A path to your local repo checkout** (optional), which enables the
  right-click agent actions. Leave it blank to skip.
- **Slack** (optional), opening a browser to authorize a Slack app. Each
  teammate mints their own user token this way, so reactions and messages
  appear as _them_. See [Slack](#slack) for the one-time app creation.
- **A peer-board invite** (optional). See [peer boards](#peer-boards).

Setup also symlinks the wrapper skills in `skills/` into `~/.claude/skills/`,
so the panes the board launches can invoke them.

To configure by hand instead, put `GITLAB_TOKEN=...` and optionally
`SLACK_TOKEN=...` in `.env`.

## Usage

The board lists open MRs authored by any configured member in one of your
`projects`. Your own drafts are shown; nobody else's are.

A left sidebar switches between **All** and a single member. Everything else is
in the header: group, sort, rows or grid, theme, a refresh button, and a Slack
filter that narrows the board to MRs whose review request has actually been
posted.

A plain click opens the MR in a new browser tab. Right-click any row for its
action menu instead: open in GitLab, copy for Slack, mark or unmark a Slack
reaction, flip your own MR between draft and ready, and (from a local
hostname) the agent actions.

## Configuration

`config.json` in the repo root is gitignored and drives everything, with the
mattstack settings stores layered over it per key. The essentials:

| field           | meaning                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `gitlabHost`    | your GitLab instance, e.g. `https://gitlab.com`                                                        |
| `projects`      | project paths whose MRs are eligible                                                                   |
| `rtRepos`       | maps each project path to the rt repo identity holding its MR store                                    |
| `members`       | array of `{ "username", "name"? }`, the teammates whose authored MRs the board shows, in sidebar order |
| `defaultMember` | member username the board opens to, or `"all"`                                                         |
| `title`         | page heading and tab title                                                                             |
| `slack`         | review channel, post templates, and signal emoji                                                       |

The listen port is `$PORT`, default `7930`, and the server always binds
`127.0.0.1`.

**[Full configuration reference](docs/configuration.md)** covers every field,
tabs, the settings-store ownership latch and its reload rules, and all the
tokens and secrets.

## State

Everything the board writes at runtime (review/respond/doctor lifecycle
rows, drafts, nudges, the outbox, Slack refs, triage memory, the
agent-status cursor) lives in one SQLite file, `state.db`, opened lazily on
first use and shared by the server and every CLI it launches. Its location
is independent of `config.json`'s: `BOARD_STATE_DB` pins an exact file path
when set, otherwise it defaults to `~/.mattstack/board/state.db` regardless
of which checkout or `BOARD_APP_ROOT` is running the server. That path must
still be named `state.db` (a launched pane's status CLI always derives
`<root>/state.db` from its claim ticket, never from `BOARD_STATE_DB`
itself, so any other basename would silently split the server's db from
every pane's); a mismatched basename fails fast rather than quietly forking
state. A first run against an existing install one-shot
imports any legacy per-lane JSON state files it finds and renames the old
`state/` directory aside.

A launched pane (review, respond, doctor) never sees `BOARD_STATE_DB`
itself. Instead the server hands it a **claim ticket**: a `--state <path>`
argv value that is really an opaque handle, `<root>/state/<lane>s/<slug>.json`,
from which the status CLI (`bin/review-status.ts`, `bin/respond-status.ts`,
`bin/doctor-status.ts`, `bin/gate.ts`) derives the same `state.db` by
walking up from the handle to its root. The CLI resolves its row by handle
and updates it; an unrecognized handle is a loud error rather than a
silently created record.

## Slack

The board plugs into a channel convention rather than inventing its own
workflow: review requests are messages in one channel containing the MR's URL,
and review state is signalled with three reactions on that message (looking,
commented, approved). If your team already reviews this way, the board drops in
as-is.

Setup is one Slack app for the team, created from the checked-in
[`slack-app-manifest.yaml`](slack-app-manifest.yaml), then one OAuth flow per
teammate. The three emoji names are configurable, and drive the row chips, the
mark actions, and the reaction the board drops automatically when a launched
review starts or lands.

**[Slack integration guide](docs/slack.md)**

## Agent actions

Opened from a local hostname, the row menu can hand an MR to a Claude Code
agent in a fresh [herdr](https://herdr.dev) pane:

- **launch review** or **re-review** someone else's MR
- **respond to review** on your own
- **call the doctor** on merge conflicts or red CI

The board injects the domain skill and a status-writer path as flags, so the
wrapper skills carry no repo- or team-specific knowledge. The wrapper reports
lifecycle status back through a state file and a matching event on the rt
daemon's bus; the board reads that bus from a cursor it keeps, so a
transition that lands while the board is down is replayed at its next boot.
The row shows a live badge, and the board owns every Slack reaction, so the
agent never touches Slack.

The gate is enforced on both sides: the client hides the menu items and the
server returns `403`, so these never fire through a public tunnel.

There is also a one-shot automation pass for a cron entry, off by default:

```sh
./bin/board triage
```

**[Agent actions guide](docs/agent-actions.md)** covers the skill bindings in
`.mattstack/skills.jsonc`, operator notes, held drafts, and every triage
guardrail.

## Peer boards

When teammates each run their own board, a small relay called the switchboard
lets those boards nudge each other about re-reviews without either board
talking to the other directly. It adds live peer badges, a "request re-review"
row action, and optional guarded auto re-review on the reviewer's side.

It is entirely optional. Skip it and the board works exactly as described
above.

**[Peer boards guide](docs/peer-boards.md)**

## Deployment

The server binds a local port and has no auth of its own, so anything
public-facing must bring its own gate. The setup this was built for is a
persistent process behind a Cloudflare tunnel with Cloudflare Access in front
of it.

The MR titles, branch names, and reviewer names on this page are your
organization's internal data. Do not expose it without the gate.

**[Deployment guide](docs/deployment.md)**

## Development

```sh
bun test           # unit tests: filtering, grouping, cache, ticket extraction, peers
bun run typecheck  # server and client projects
bun run serve      # the client is bundled in memory at startup; restart to pick up changes
bun run build      # standalone binary at dist/board
```

[HTTP endpoint reference](docs/api.md)

## Part of mattstack

board is one app in [mattstack](https://github.com/m4ttstack), a personal
developer estate: [rt](https://github.com/m4ttstack/rt) is the CLI and daemon
this board reads its MR data from,
[deck](../deck) (in this same repo) serves it locally at
`board.mattstack`, [gitq](https://github.com/m4ttstack/gitq) manages stacked
branches, [glance](https://github.com/m4ttstack/glance) models the forge data,
and [skills](https://github.com/m4ttstack/skills) plus the
[marketplace](https://github.com/m4ttstack/mattstack-marketplace) carry the
agent skills the row actions invoke.

## Contributing

Issues and pull requests are welcome. Before opening one:

- Run `bun test` and `bun run typecheck`.
- Keep the TypeScript strict, and keep new configuration in
  [`docs/configuration.md`](docs/configuration.md) rather than only in code.
- Never commit `config.json` or `.env`. They are gitignored for a reason:
  they carry real names, tokens, and MR URLs. `state.db` lives outside the
  repo entirely (`~/.mattstack/board/state.db` by default), so it never
  shows up here to begin with.

## License

MIT. See [LICENSE](LICENSE).
