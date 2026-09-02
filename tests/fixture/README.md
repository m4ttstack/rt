# Capture fixture

`BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts` boots an inert
board: config from this dir, canned data endpoints, no tokens, no timers,
no rt relay. Port 7941 (never the live board's 7930).

- `config.json`: committed fixture config (this dir).
- `data.json`, `discussions.json`, `review-report.md`, `meta.json`: the
  canned payloads the fixture endpoints serve.

Every name, username, avatar seed, project path, branch, ticket id, URL and
comment body here is invented. Nothing in this directory is a snapshot of a
real board, and nothing may be pasted in from one: the tracked tree is swept
by `scripts/repo-purity.sh`, and the twenty PNGs in `tests/baselines/` render
whatever these files say.

Timestamps are pinned and every capture run freezes the browser clock to
`meta.json`'s `now`, so the rendered "3 days ago" style labels stay fixed.

## Editing it

Hand-edit the JSON. The set of states the captures exercise lives here, not
in `tests/capture.ts`: draft, stacked, conflicts, failing CI, approved,
unresolved threads, a held draft, and the review / respond / doctor agent
chips are each carried by one of the eight MRs. Adding a state means adding
or amending an MR. The second tab, "Acme Queue", names a section absent
from scopeKnownSections so the wrong-section banner and chip render.

`data.json` must satisfy the client's `BoardData` contract
(`src/client/types.ts`), `tabs` and `scopeUncoveredSections` included. A
missing key does not degrade: the board throws during render and every
capture times out waiting for a row.

After any edit, re-shoot and re-verify:

```sh
bun run capture:baseline   # rewrites tests/baselines/*.png
bun run capture            # shoots again into tests/.captures
bun run capture:compare    # must be 20/20, zero pixels
```
