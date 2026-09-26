# Configuration reference

Board reads its configuration from two places, in this order:

1. **The mattstack settings stores** (`~/.mattstack/`), through the resolver in
   `@mattstack/rt-client`. Team-shared keys live on the `team` scope; personal
   ones on `user` or `machine`.
2. **`config.json`** in the repo root (gitignored), as the fallback for any key
   the store does not own yet.

Ownership is a one-way latch decided fresh on every load: `config.json` stays
authoritative for a key until something writes that key to a store, and from
then on the store wins. Copy `config.example.json` to `config.json` for a solo
install, or seed the team store once and point everyone at it.

## Reload behavior

- `config.json` edits hot-reload. The server watches the file.
- Edits made through the board's own settings modal reload too. The write goes
  through `/api/settings/*`, which reloads the in-memory config on success.
- An out-of-band store edit (`rt settings set board.<key> ...` by hand, or
  another tool writing the store directly) does **not** reload. Restart the
  board (`bun run serve`) to pick it up.

## Fields

| field | meaning |
|---|---|
| `gitlabHost` | your GitLab instance, e.g. `https://gitlab.com` |
| `projects` | GitLab project paths whose MRs are eligible, e.g. `["group/project"]` |
| `rtRepos` | maps each `projects` entry to the rt repo identity that holds its MR store, e.g. `{"group/project": "gitlab.com/group/project"}`. An unmapped project surfaces as a fetch error on the board |
| `members` | array of `{ "username", "name"?, "hidden"? }`: the teammates whose authored MRs the board shows, in sidebar order |
| `defaultMember` | member username the board opens to by default, or `"all"`. The URL and remembered state override it |
| `title` | page heading and tab title |
| `staleAfterDays` | hide MRs with no activity in more than this many days (default `90`) |
| `ticketPrefixes` | when non-empty, show only MRs whose ticket key starts with one of these prefixes, e.g. `["ACME"]`. Case-insensitive; MRs with no detectable key are hidden. Empty shows all |
| `botUsernames` | extra bot accounts whose general MR comments to hide, on top of the built-in heuristic |
| `reviewCwd` | absolute path the review agent's pane starts in (a repo checkout). Empty disables the review launch |
| `respondCwd` | same, for respond panes. Falls back to `reviewCwd` when empty |
| `doctorCwd` | same, for doctor panes. Falls back to `reviewCwd` when empty |
| `reviewsWorkspace` | herdr workspace label reviews are grouped under (default `reviews`) |
| `respondsWorkspace` | herdr workspace label responses are grouped under (default `responses`) |
| `doctorsWorkspace` | herdr workspace label doctor sessions are grouped under (default `doctors`) |
| `doctorSkill` | domain skill the doctor wrapper delegates to, e.g. `acme:doctor`. Empty means the wrapper repairs generically. A repo's `skills.jsonc` binding overrides it when present |
| `claudeCommand` | verbatim override for the command that starts Claude in every pane, with the prompt or resume flags appended after it. Normally unset: the board composes this from the `board.agent.*` settings. See below |
| `slack` | review channel, post templates, sweep interval, and signal emoji. See [Slack integration](slack.md) |
| `switchboard` | `{ "url": "..." }` for peer boards. See [peer boards](peer-boards.md) |
| `triage` | reviewer-side automation block. See [agent actions](agent-actions.md#reviewer-side-automation) |
| `tabs` | board tabs, in display order. See below |

### `claudeCommand`

Normally you do not set this. The board composes the launch command from three
settings, each of which the board reads from the rt settings store:

| Setting | Effect |
| --- | --- |
| `board.agent.account` | cswap account the panes launch under. Unset uses the default Claude profile |
| `board.agent.model` | value for Claude's `--model`. Unset omits the flag |
| `board.agent.effort` | value for Claude's `--effort`. Unset omits the flag |

```sh
rt settings set board.agent.account someone@example.com
rt settings set board.agent.model claude-opus-5
rt settings set board.agent.effort high
```

With all three set the board runs
`cswap run 'someone@example.com' --share-history -- --model 'claude-opus-5' --effort 'high'`,
then appends the prompt or the resume flags. `cswap run` launches Claude
itself, so everything after its `--` is read as Claude's own arguments and the
word `claude` never appears there. `--share-history` is not cosmetic: without
it a resumed pane cannot find the transcript the review session wrote.

A `claudeCommand` in `config.json` overrides all three and is inserted
verbatim. Keep it for a wrapper the three settings cannot express; it must
obey the same two rules above.

Before rt-client 0.14.0 this was a single `board.claudeCommand` setting holding
the whole command. That key is retired. A store that still carries it is
ignored, so move the value into the three keys above or the panes fall back to
plain `claude`.

## Tabs

Each tab is a filtered view of MRs with a unique id, a sidebar label, and
optional overrides. With no `tabs` config the board creates one implicit
"Team" tab sourced from team members.

Two source kinds:

- `"authors"`: MRs authored by configured team members (the default).
- `"codeowners"`: MRs blocked on approval from a named codeowners section. The
  section name comes from your repo's `.gitlab/codeowners`. Set
  `excludeMembers: true` to hide MRs authored by team members, so the queue
  shows work assigned to the team rather than self-reviews. Leave it out to
  show the section's full queue.

Per-tab overrides:

- `slackChannel`: posts and reactions for this tab go to a different channel
  instead of `slack.channel`.
- `reviewSkill`: skill binding for review launches from this tab, instead of
  the manifest binding or the empty fallback.

```json
"tabs": [
  { "id": "team", "label": "Team", "source": { "kind": "authors" } },
  { "id": "codeowner-queue", "label": "Codeowner Queue",
    "source": { "kind": "codeowners", "section": "Acme", "excludeMembers": true },
    "slackChannel": "team-codeowners" }
]
```

A codeowners tab needs `@mattstack/rt-client` 0.5.0 or newer and an rt daemon
whose `project-mrs:read` handler is sections-aware. An older daemon reports no
codeowner sections at all, so the tab renders empty with no badge explaining
why.

Edit tabs on the team scope with `rt settings set board.tabs --scope team`.
`config.json` carries them until then, and a store edit needs a restart.

## Tokens and secrets

`bun run setup` handles all of these. Every one is resolved env-first, then
from the rt daemon's token-gated `secrets:read` (the `board` scope). An env
var always wins when it is set, so `.env` stays the simplest path for a solo
install.

| name | purpose |
|---|---|
| `GITLAB_TOKEN` | optional. `read_api` scope; the board never writes to GitLab with it. Used for member display-name lookups and for posting MR notes. Daemon fallback: `gitlabToken` in the `rt` domain (`rt secrets set rt gitlabToken`) |
| `SLACK_TOKEN` | optional user token (`xoxp-...`) for the Slack integration. Minted by `bun run setup`'s OAuth flow. Daemon fallback: `slackToken` in the `board` domain (`rt secrets set board slackToken`) |
| `SLACK_CLIENT_ID` | public OAuth app identifier, used by setup. Falls back to the `mattstack.integrations` team setting (`slack.clientId`) |
| `SLACK_CLIENT_SECRET` | the Slack app's client secret, used by setup only. Never a team setting |
| `SWITCHBOARD_TOKEN` | this board's peer-relay token. Written by setup when you redeem an invite |
| `SWITCHBOARD_ADMIN_TOKEN` | operator only. Its presence turns on the board's invite affordances. Daemon fallback: `switchboardAdminToken` in the `rt` domain |

Without `GITLAB_TOKEN` the board still renders: MR data comes from the rt
daemon, not from GitLab directly. Without `SLACK_TOKEN` the Slack menu actions
stay disabled and everything else works.

## Port

The listen port is `$PORT`, default `7930`. The server always binds
`127.0.0.1`. See [deployment](deployment.md) for reaching it from elsewhere.
