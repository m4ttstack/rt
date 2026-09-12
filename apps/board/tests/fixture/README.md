# Capture fixture

`BOARD_FIXTURE=$(pwd)/tests/fixture bun run src/server.ts` boots an inert
board: config from this dir, canned data endpoints, no tokens, no timers,
no rt relay. Port 7941 (never the live board's 7930).

- `config.json`: committed fixture config (this dir).
- `data.json`, `discussions.json`, `review-report.md`, `respond-report.md`,
  `meta.json`: the canned payloads the fixture endpoints serve.

Every name, username, avatar seed, project path, branch, ticket id, URL and
comment body here is invented. Nothing in this directory is a snapshot of a
real board, and nothing may be pasted in from one: the tracked tree is swept
by the repo root's `scripts/repo-purity.sh`, and the PNGs in
`tests/baselines/` render whatever these files say.

Timestamps are pinned and every capture run freezes the browser clock to
`meta.json`'s `now`, so the rendered "3 days ago" style labels stay fixed.
Agent timestamps that the row turns into "12m ago" style detail (the
orphan's `since`, a running review's `startedAt`) are computed from that
same `now`.

## Editing it

Hand-edit the JSON. The set of states the captures exercise lives here, not
in `tests/capture.ts`. The eight MRs carry, between them, the rows of the
approved MR-row design (`docs/design/mr-row`) plus the mechanical states:

| MR    | carries                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| !1204 | the interrupted review: `review.reviewing` on `sess-a` plus a gone `orphan` on the same session, 12m ago                                                                                                              |
| !1374 | the running review: `review.reviewing` started 4m ago, the spinner ring and the muted `focus` verb                                                                                                                    |
| !1271 | the decide row on the failing-CI, conflicted, approved MR: an open `review-post` gate ("Post which findings?"), an auto doctor `watching`, and a finished respond, so the status line reads the gate with "+2 active" |
| !1235 | the own MR: approved, the Slack `eyes` reaction and posted logo, five resolved threads, a peer (`pat`) reviewing; the seat is an `UNREVIEWED` reviewer on it (the seat tab's "review")                                |
| !1273 | the all-clear row: approved, Slack `white_check_mark` posted, nothing else; the seat is a `REVIEWED` reviewer whose `myThreads` the author answered (the seat tab's "re-review")                                      |
| !1210 | the stacked parent (mergeable) with a stuck auto doctor                                                                                                                                                               |
| !1236 | conflicts, a finished review with a saved report (the review modal shot opens from its `read` verb), a finished doctor                                                                                                |
| !1429 | the draft, stacked under !1210, with one awaiting thread, a finished doctor, and the held draft note                                                                                                                  |

Adding a state means adding or amending an MR. The second tab, "Acme
Queue", names a section absent from scopeKnownSections so the
wrong-section banner and chip render. `data.json`'s `defaultMember` is
`rmarlow` (config.json keeps "all": the fixture server validates its own
against its own roster), which is what makes the client append the built-in
"Needs me" tab; every shot but that tab's opens with `?member=all` so the
seat does not narrow the team view.

The thread link's "new activity" weight is derived from `localStorage`
(`board.threads.seen:<url>`) rather than from this data, so a capture on a
fresh browser context always shows every thread link at its rest weight.

`data.json` must satisfy the client's `BoardData` contract
(`src/client/types.ts`), `tabs`, `scopeUncoveredSections`, and
`scopeKnownSections` included, plus `codeownerSections` on each MR. A
missing key does not degrade: the board throws during render and every
capture times out waiting for a row.

After any edit, re-shoot and re-verify:

```sh
bun run capture:baseline   # rewrites tests/baselines/*.png
bun run capture            # shoots again into tests/.captures
bun run capture:compare    # every baseline, zero pixels
```
