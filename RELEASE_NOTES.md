the one-invite release. Joining a team now takes exactly one invite: the code your inviter sends is the whole thing, board peering included.

### Team invites

- the invite carries board peering: `rt team invite` registers the invitee's board on the switchboard and seals the board token into the encrypted invite pointer, and the join stores it where the board already reads it. The hand-delivered second board invite is gone (#339)
- only the team's declared switchboard is trusted: an invite can never point the join (or the admin token) anywhere else, and every peering failure degrades to a completed join that names the board-panel re-invite as the repair (#339)
- removing a member revokes every age key recorded for them across both roster keys, and roster reads prefer `mattstack.roster` everywhere, matching the apps (#339)

### Gates and daemon

- a dead pane's gate-push retry delivers doorbell-only, never injecting Escape into a live session (#328)
- background fetches abort their child process instead of leaving it running, and the fetch gate's 60s race aborts with it (#337)
- BUSY-deferred deletes in the project-MRs store are retried instead of lost (#336)

### Toolchain

- the bundled and CI-pinned bun moves to 1.4.2 (#334)

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.10.0...v2.10.1
