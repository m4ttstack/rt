# Running it beyond your own machine

The server binds a local port and has no auth of its own. Anything
public-facing must bring its own gate. The setup this was built for:

1. Run it persistently: launchd, systemd, whatever you have. `bun run build`
   produces a standalone `dist/board` binary if you would rather not ship a
   checkout.
2. Point a [Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   at the port and route a hostname to it.
3. Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
   in front of that hostname, with a policy for your organization's email
   domain (Google, any IdP, or the built-in one-time pin).

**The MR titles, branch names, and reviewer names on this page are your
organization's internal data. Do not expose it without the gate.**

## Why it only binds loopback

The server always binds `127.0.0.1`, so nothing on your LAN can reach it
directly. The tunnel above still works fine, because cloudflared connects out
from the same machine rather than in over the network.

There is no wider-bind opt-in. A former `host` config field was retired for
exactly this reason: the review-launch and peer-invite actions are gated by a
check on the request's Host header alone, not by network topology, so a wider
bind would have let anyone who can reach that port and forge a local-looking
Host header reach those actions too. Use the tunnel for any off-machine access.

## Deck

`mattstack.deck.json` registers the board with [deck](../../deck) (in this same repo),
which serves it at `board.mattstack` on a local port. That hostname counts as
local for the gating above, so agent actions work through deck the same way
they do on `localhost`.

## Releases

Tagging `vX.Y.Z` publishes a GitHub Release carrying a bun-compiled
`darwin-arm64` binary plus its sha256. The release workflow refuses to publish
unless the tag, `package.json`'s version, and the binary's own `--version`
output all agree.

Verify a downloaded artifact with:

```sh
shasum -a 256 -c board-darwin-arm64.sha256
```
