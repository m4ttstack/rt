# One-invite board peering

**Problem.** Joining a team takes two invites today: the `rt team invite`
code, and a separate board peering invite the owner mints in the board UI
and hands over mid-onboarding. The one-invite path was already designed
and half-built: `rt team join` reads the team-shared `switchboardAdminToken`
secret and POSTs `{member}` to `<switchboard>/peer/join`, but the deployed
switchboard never grew that route, so every join 404s and silently reports
peering "unavailable". The board UI invite became the workaround.

**Goal.** The team invite is the only invite. A joiner whose team declares
a switchboard ends onboarding with a peered board and zero extra pastes.
The board UI invite becomes a repair path only.

## What already works (verified in source)

- `rt team join` (`lib/team/join.ts:441-455`): reads the admin token from
  team secrets and POSTs `/peer/join`; reports `peering:
  applied|unavailable|idle`. It ignores the response body.
- Switchboard store (`apps/board/switchboard/store.ts`): `registerBoard`
  is an upsert that rotates `token_hash` and returns the fresh token.
- Board resolves its switchboard URL from the team-synced
  `board.switchboardUrl` settings key (`apps/board/src/config.ts:754`),
  and its token env-first then via the rt daemon's `secrets:read` scope
  "board", which whitelists the rt-domain `switchboardToken`
  (`lib/daemon/handlers/secrets.ts:64`, `apps/board/src/config.ts:1119`).
  Both reads happen at call time; no restart or .env write needed.

## Changes

### 1. Switchboard: no change

The needed route already exists: `POST /boards {username}` (admin bearer,
`apps/board/switchboard/server.ts:37`) upserts via `registerBoard` and
answers `201 {username, token}`, rotating the token on re-registration
(matching the board UI's "re-join with a new invite" semantics). rt's
`/peer/join {member}` call was simply aimed at a route that never
existed. No apps change, no Railway deploy.

### 2. rt: embed the board token at mint, store it at join (m4ttstack/rt)

A join-time admin-token read can never serve a FIRST join: the invitee's
age key becomes a team-secrets recipient only after the owner's members
sync processes their reply, which happens after the join. So the token is
minted where the admin token is readable, the owner's machine:

- `lib/team/invite.ts` (`mintInvite`): when the team declares a
  switchboard, read `switchboardAdminToken` from the operator's LOCAL rt
  domain, POST `<switchboard>/boards {username: handle}`, and seal the
  returned per-board token into the pointer as
  `switchboard: { url, token }` (the pointer travels only as ciphertext).
  Any failure degrades to an invite without peering plus a warning naming
  the board-panel re-invite repair; the mint never fails over peering.
- `lib/team/join.ts`: a pointer carrying `switchboard.token` stores it as
  the LOCAL user secret (`rt` domain, `switchboardToken`, never
  team-synced) and reports peering applied; no switchboard call, no
  team-secret read. Without an embedded token it falls back to the old
  admin-token path, now aimed at the real route (POST `/boards`,
  capturing the token), which serves re-joins by members whose keys are
  already recipients. On `unavailable`, the join message names the
  repair.

### 3. rt: roster readers cut to mattstack.roster (m4ttstack/rt)

Writers already dual-write `board.members` + `mattstack.roster`; board
and boxscore read the new key; rt's readers still read the old one. Cut
`rt team status` (`commands/team.ts:527`), the members-remove picker
(`commands/team.ts:393`), and `lib/team/members.ts`'s default read key to
`mattstack.roster`, falling back to `board.members` when the new key is
absent (old team stores). Dual-write stays.

## Rollout

- Switchboard deploys from apps main to the Railway project
  `mattstack-switchboard` (no board app release; the board binary is
  untouched).
- The rt half ships as **v2.10.1**: the joiner-side code runs on the
  invitee's machine, so the fix is inert for new teammates until it is in
  the released bundle.
- Owner-side precondition, checked at execution time: the operator's
  LOCAL rt domain must actually hold the `switchboardAdminToken`
  secret; if absent, seed it before minting invites.

## Out of scope (fast-follow tickets)

- Board members panel goes repair-only (drop the free-text invite row;
  per-row buttons become re-invite).
- Settings > Team pane: merge the members list and invite into one list
  with per-row state (joined / invited pending / needs re-invite).

## Testing

- Switchboard: route test for auth gate, bad member, happy path, re-join
  rotation (existing test file pattern in `apps/board/switchboard`).
- rt: `joinRedeem` unit tests for token capture and store, 2xx-no-token,
  404 (today's deployed reality), and no-admin-token; roster-read tests
  for new-key, old-key-only, and both-present stores.
- End to end: the VM walkthrough's join leg exercises the real flow ahead
  of v2.10.1's tag.
