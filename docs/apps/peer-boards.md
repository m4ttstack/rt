# Peer boards and the switchboard

When your teammates each run their own board, a small relay called the
switchboard lets those boards nudge each other about re-reviews without either
board talking to the other directly. It is entirely optional: skip it and the
board works exactly as it does without it.

What it adds:

- **Live peer badges.** When a peer's board reports a review going into or out
  of flight on one of your MRs, your row picks up the badge.
- **Request re-review.** A row action on your own MR ("request re-review from
  `<reviewer>`") asks that reviewer's board directly.
- **Guarded auto re-review.** The reviewer side can run `bun run triage` on a
  cron so an incoming nudge is picked up and re-dispatched automatically. See
  [agent actions](agent-actions.md#reviewer-side-automation) for the
  guardrails.

## Teammate setup

Peer features need `defaultMember` set to your own GitLab username. That is how
the board tells your MRs from everyone else's, so with `"all"` it stays silent
and publishes nothing to peers.

`bun run setup` prompts once for a board invite. Paste the whole link your
operator gave you (`.../invite/<code>`) and setup redeems it, writing the
switchboard URL to `board.switchboardUrl` and the token it gets back to `.env`
as `SWITCHBOARD_TOKEN`. Blank input keeps whatever is already configured.

A bare URL with no `/invite/<code>` falls back to a manual flow that prompts
for a board token separately, for the rare case someone hands you a token out
of band instead of a link.

Everything degrades cleanly when peer features are not set up: no badges, no
nudge action, and `POST /nudge` returns `400`.

A board that is already running does not need a restart to join or re-join.
Open settings and use "join peer boards", or "re-join with a new invite" if it
is already peered, and paste the link there instead.

If the switchboard ever stops accepting this board's token, because the
operator re-minted it for instance, the settings modal starts showing "peering
token rejected, re-join with a new invite" after a few failed polls. The fix is
the same either way: get a fresh invite from your operator and re-join.

## Operator setup: run a switchboard

The switchboard is a separate deployable in `switchboard/`: a store-and-forward
relay, one process, one SQLite file. To deploy it to
[Railway](https://railway.app):

- **Service root**: the repo root, not `switchboard/`. The relay imports shared
  types from `src/peer/`, so a service rooted at `switchboard/` cannot resolve
  them.
- **Builder**: Dockerfile, path `switchboard/Dockerfile`. It copies only the
  relay's files and runs no `bun install`, because the board's `package.json`
  has a `file:` dependency that only resolves on a dev machine.
- **Watch paths**: `switchboard/**` and `src/peer/envelope.ts`, so board-only
  pushes do not trigger a redeploy of the relay.
- **Volume**: attach one and point `SWITCHBOARD_DB` at a path on it. Otherwise
  the database lives on ephemeral disk and every redeploy loses all board
  registrations.
- **Env**: `SWITCHBOARD_ADMIN_TOKEN`, a value you pick, is the bearer token for
  minting boards. `PORT` is supplied by Railway.

## Inviting teammates

To invite from the board's own UI instead of curl, put the admin token where
the board (not the relay) reads it: the `SWITCHBOARD_ADMIN_TOKEN` env var, or
`switchboardAdminToken` in the rt daemon's secrets (`rt secrets set rt
switchboardAdminToken`) on the machine running your own board. You also need
`switchboard.url` configured.

With both set, open settings ("team members") locally and each roster member
gets an **invite** button. Anyone already peered shows **peered** with a
**re-invite** button instead, and a free-text row at the bottom invites handles
that are not on your roster at all. Either action mints a one-time invite link
(`<url>/invite/<code>`, expiring in 7 days) shown right there to copy and paste
to that teammate.

Re-invite is the rotation story, with one caveat: minting the new invite
changes nothing by itself. Their current board keeps working, and their access
ends only when the new invite is actually redeemed and the token behind it
rotates. A true revoke, cutting a board off without waiting on them, is not in
v1. For that, re-mint or delete the board on the relay directly.

The invite code travels in the URL path, so it shows up in the relay host's
access logs (the platform's edge logs) even though the relay itself never logs
it. Treat invite links as short-lived secrets: hand them over the way you would
a password, and if one may have leaked, re-invite that handle. The relay keeps
one outstanding invite per handle, so minting a fresh one replaces the old code
and the leaked link stops working.

## Scripted operator setup

The relay endpoints stay plain HTTP with the admin bearer token, for scripting
or a headless operator setup:

```sh
# Mint a board directly. username = their GitLab username, lowercased; one board
# per username; re-minting rotates the token, so hand out the new one if you do.
curl -X POST $URL/boards \
  -H "Authorization: Bearer $SWITCHBOARD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"grace"}'

# Or mint an invite link, the same way the settings modal does.
curl -X POST $URL/invites \
  -H "Authorization: Bearer $SWITCHBOARD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"grace"}'
# -> {"code":"...","username":"grace","expiresAt":...}; hand out "$URL/invite/<code>"
```

The invite link works everywhere: `bun run setup`'s prompt and the board's own
"join peer boards". The raw `POST /boards` token only works with `bun run
setup`'s manual fallback (paste the bare switchboard URL, then the token
separately), since "join peer boards" only accepts a link.

## Privacy

The switchboard stores envelopes it never inspects. Payloads carry MR URLs,
iids, statuses, usernames, and timestamps only, never titles, diff content, or
credentials. Board endpoints, `/nudge` included, stay local-only whether or not
peer features are configured.
