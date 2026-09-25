# 2.13.0 prod readiness: plan index

Spec: `docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md` (RT-279 to RT-284). These plans were cross-checked against each other after they were written; the merge order below replaces the spec's "Order" section wherever the two differ.

## Plans

| Unit | Plan | Repo | Branch | PR title | Depends on |
|---|---|---|---|---|---|
| A | `A-deps-lock-serve.md` | m4ttstack/rt | `rt-2-13-a-deps-lock-serve` | deps.lock: serve field for bundled apps | none |
| B | `B-deck-sweep.md` | m4ttstack/apps | `apps-2-13-b-deck-sweep` | deck 1.1.0: the boot sweep serves the bundle catalog | A (copies A's parity fixture from `main`) |
| C-apps | `C-bundle-identity.md` (Tasks 1 to 7) | m4ttstack/apps | `apps-2-13-c-bundle-identity` | deck: serve bundled app identity for unlinked rows (2.13.0 unit C) | B (reuses `bundleResourcesDir`) |
| C-rt | `C-bundle-identity.md` (Tasks 8 to 13) | m4ttstack/rt | `rt-2-13-c-bundle-identity` | Bundle each served app's identity at Resources/apps (2.13.0 unit C) | A (reads `t.serve`) |
| D | `D-boxscore-bundle.md` (Tasks 1 to 5) | m4ttstack/apps | `apps-2-13-d-boxscore-bundle` | boxscore: bundle-ready (build:binary, recipe, license, binary gate) | none (lands after C-apps) |
| E | `E-setup-cli-cleanup.md` | m4ttstack/rt | `rt-2-13-e-setup-cli-cleanup` | setup and uninstall: rely on deck's sweep, reject app names | B, the bot deps.lock PR (step 10), the B dev-creation decision |
| F | `F-tray-launch-lifecycle.md` | m4ttstack/rt | `rt-2-13-f-tray-launch-lifecycle` | tray: settled re-register, spawn-health heal, answer-gated records | none |
| G | `G-window-waits-for-deck.md` | m4ttstack/rt | `rt-2-13-g-window-waits-for-deck` | tray: window waits for deck, 5xx tabs show the failure overlay (RT-283) | F (consumes F's `LaunchdPrint` parser) |
| H | `H-vm-assert-expected-set.md` | m4ttstack/rt | `rt-2-13-h-vm-served-assert` | vm: assert deck's served apps from deps.lock and every .mattstack route | A (Task 7 unwraps the fixture's `.lock`) |
| I | `I-release-runbook.md` | m4ttstack/rt and m4ttstack/apps | none (bot branch `bundle-ci/<run_id>`, tag `v2.13.0`) | bot PR `deps.lock: app bundle build`; release 2.13.0 | steps 1 to 8 merged |

## Merge order

1. A `rt-2-13-a-deps-lock-serve` (m4ttstack/rt): canonical wrapper parity fixture, serve on board/console/chat, pending boxscore stub row with serve {11005, []}, flip-proof exact-catalog test
2. B `apps-2-13-b-deck-sweep` (m4ttstack/apps): deck 1.1.0 with A's fixture copied byte for byte from main, .prettierignore entry, prettier-formatted sources
3. C-apps `apps-2-13-c-bundle-identity` (m4ttstack/apps): rebased on B, uses B's bundleResourcesDir, board 0.1.6 / chat 0.1.3 / console 0.1.3
4. D `apps-2-13-d-boxscore-bundle` (m4ttstack/apps): Tasks 1-5 only (Task 6 moves to the release runbook)
5. C-rt `rt-2-13-c-bundle-identity` (m4ttstack/rt): after A, reads t.serve directly; from here until step 10 no release or rehearsal is cut (check-bundle rejects served rows without identity, and checkAppPins errors on the pending row)
6. F `rt-2-13-f-tray-launch-lifecycle` (m4ttstack/rt): owns LaunchdPrint/LaunchdJobSnapshot; keeps the one-shot post-settle deck restart --managed
7. G `rt-2-13-g-window-waits-for-deck` (m4ttstack/rt): rebased on F, consumes F's parser; swift build and the full mattstack-checks run on the rebased tree before merge
8. H `rt-2-13-h-vm-served-assert` (m4ttstack/rt): after A (Task 7 unwraps fixture.lock)
9. bundle-apps dispatch once, dry run then real: apps=deck,boxscore,board,chat,console (needs 1-5 on main)
10. Merge the bot deps.lock PR (deck 1.1.0, boxscore 0.1.0 bundled, board 0.1.6, chat 0.1.3, console 0.1.3; serve preserved; CI green with no hand edit)
11. E `rt-2-13-e-setup-cli-cleanup` (m4ttstack/rt): mark ready only after step 10, and after the B dev-creation decision is recorded
12. Release 2.13.0 via rt:release full gate (walkthrough runs H's assert), notarize, Sparkle feed; then update Matt's prod through Sparkle and rebuild the dev app from main

Every PR merges on the house rule: CodeRabbit (or an Opus stand-in review when it is rate limited) and CI green with actionable findings addressed. The mattstack-apps units (B, C-apps, D) run from a session rooted in mattstack-apps with their worktree under `.claude/worktrees/`, never as subagents of a repo-tools worktree session.

## Release chain after the merges

`I-release-runbook.md` carries every step with its commands. In short:

1. **One bundle-apps dispatch** from m4ttstack/rt `main`, dry run first, then real: `gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=deck,boxscore,board,chat,console`. It publishes deck 1.1.0 and boxscore 0.1.0, and re-releases board 0.1.6, chat 0.1.3 and console 0.1.3 so their tarballs carry the identity unit C's check-bundle gate requires. The released darwin boxscore binary is gated locally with `binary-gate.sh`.
2. **The one deps.lock PR it opens** (`deps.lock: app bundle build`, branch `bundle-ci/<run_id>`) re-pins all five rows. boxscore's row was added by unit A as a pending stub already carrying `serve: { port: 11005, args: [] }`; the bot flips it to bundled and leaves every `serve` alone, so the PR goes green with no hand edit. Each sha256 is checked against its published asset before merge. Its merge ends the release-free window.
3. **Unit E merges** once the B dev-creation decision is recorded in its PR body.
4. **The `rt:release` skill**, full gate, with Max consulted over rt chat before and during the cut: preflight, notes, rehearsal, the clean-room walkthrough (whose assert phase now runs unit H's served-app check, icons included), tag, `rt release verify` (notarization and the Sparkle `appcast.xml`), and the rt.cool deploy.
5. **After the release:** update Matt's prod through Sparkle (checking for unit F's `served apps restarted after version change` log line), rebuild the dev app from `main` in a scratch tree, and file the follow-up tickets below. Anything that needs a GUI click goes into the morning handoff.

## Out of scope tonight (tickets to file)

From the spec:

- The "lived in dev mode first" VM leg (the rest of RT-284). It runs after the release.
- Flavor exclusivity at login: the other flavor's still-enabled agents reload at login, and takeover boots them out rather than retiring them.
- An Xcode Debug build with prod's bundle id started at login on 2026-09-24 and wrote prod's launch state. It needs its own identity or to skip login-item registration.

Raised by the plans (filed with the three above in the runbook's Task 9):

- Deck restarts served apps when the bundle version changes (a per-row bundle-version stamp in B's sweep), so F's post-settle `deck restart --managed` can go (F contract note 2).
- console and chat are compiled without `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (D contract note 6).
- The `rt:release` pin-only fast path skips the walkthrough for served-app changes (H contract note 7).
