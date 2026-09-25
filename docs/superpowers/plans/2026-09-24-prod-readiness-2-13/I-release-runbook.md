# Unit I: release 2.13.0 (runbook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this runbook task by task in the orchestrating session (it writes no code, so there is nothing to hand a subagent). Steps use checkbox (`- [ ]`) syntax for tracking. The release itself runs through the `rt:release` skill; this runbook adds the 2.13.0 gates around it.

**Goal:** Once units A to H have merged in the README's order, publish deck 1.1.0, boxscore 0.1.0, board 0.1.6, chat 0.1.3 and console 0.1.3 through one `bundle-apps` dispatch, merge its bot deps.lock PR with no hand edit, merge unit E, cut and publish 2.13.0 through the `rt:release` full gate (the walkthrough runs unit H's served-app assert), then update Matt's prod through Sparkle, rebuild the dev app from main, and file the follow-up tickets.

**Architecture:** Nothing here writes code. The dispatch lives in m4ttstack/rt (`.github/workflows/bundle-apps.yml`), builds each app from m4ttstack/apps `main`, publishes `<name>-v<version>` releases on m4ttstack/apps, and opens one bot PR (`deps.lock: app bundle build`, branch `bundle-ci/<run_id>`) that rewrites the five rows. From the merge of units A and C-rt until that bot PR merges, `main` cannot produce a releasable bundle (unit A's pending boxscore row makes `checkAppPins` error; unit C-rt's check-bundle gate rejects served rows without identity), so that whole window is release-free by rule.

**Tech Stack:** `gh` (workflow dispatch, runs, releases, PRs), `rt release preflight` / `rt release verify` / `rt release update-machine`, `rt-tray/vm/run/walkthrough.sh` (Tart), `rt chat`, the `linear-matt` connector.

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section I, "Order", "Out of scope tonight", "Authority")

---

## Global Constraints

- **No release or rehearsal between the A/C-rt merges and the bot PR merge.** Not a `release.yml` dispatch, not a tag, not a walkthrough of a `main` build. Rehearsing in that window fails for known reasons and costs a cycle; a tag in that window ships a bundle without boxscore or without identity.
- **One real bundle-apps dispatch.** `apps=deck,boxscore,board,chat,console`, dry run first. Two real runs back to back conflict on the bot PR (`docs/release-and-distribution.md:289-292`), and every tag it mints is immutable: a botched real run costs a version bump in m4ttstack/apps and a second dispatch.
- **Authority (spec).** Matt authorized merging each PR once CodeRabbit (or, when it is rate limited, an Opus stand-in review) and CI are green with findings addressed, and cutting and publishing 2.13.0 without waking him. That authority does not cover launching or clicking GUI apps: anything that needs a click goes into the morning handoff (Task 9).
- **Shared checkouts stay read only.** `~/Documents/GitHub/repo-tools` and `~/Documents/GitHub/mattstack-apps` are never edited or switched here; where the `rt:release` skill needs a checkout on `main`, follow the skill.
- **Binaries.** A binary built or downloaded here (the released boxscore in Task 5) only ever runs under `env -i HOME=<tmp> ...`. The installed apps' own CLIs (`rt`, `deck`) are what this runbook verifies, and `rt release ...` is the skill's own tooling; those run normally. Never rebuild or re-sign `/Applications/mattstack.app` or `rt-tray/mattstack-dev.app` in place: the dev-app rebuild in Task 8 builds in a scratch tree and replaces the app by moving the old one aside.
- **Bash guard.** In an EnterWorktree session run one plain command per Bash call; write multi-line text (PR bodies, chat posts) with the Write tool first.
- No em or en dashes in anything this runbook writes (release notes, PR comments, chat posts, tickets).

---

### Task 1: Confirm merge-order steps 1 to 8 and brief Max

**Files:** none.

- [ ] **Step 1: Check each unit PR is merged, in order.** One call each:

```bash
gh pr list --repo m4ttstack/rt --head rt-2-13-a-deps-lock-serve --state merged --json number,mergedAt
gh pr list --repo m4ttstack/apps --head apps-2-13-b-deck-sweep --state merged --json number,mergedAt
gh pr list --repo m4ttstack/apps --head apps-2-13-c-bundle-identity --state merged --json number,mergedAt
gh pr list --repo m4ttstack/apps --head apps-2-13-d-boxscore-bundle --state merged --json number,mergedAt
gh pr list --repo m4ttstack/rt --head rt-2-13-c-bundle-identity --state merged --json number,mergedAt
gh pr list --repo m4ttstack/rt --head rt-2-13-f-tray-launch-lifecycle --state merged --json number,mergedAt
gh pr list --repo m4ttstack/rt --head rt-2-13-g-window-waits-for-deck --state merged --json number,mergedAt
gh pr list --repo m4ttstack/rt --head rt-2-13-h-vm-served-assert --state merged --json number,mergedAt
```

Expected: one entry each, with `mergedAt` times in README order (A before B before C-apps before D; A before C-rt; F before G; A before H). Unit E (`rt-2-13-e-setup-cli-cleanup`) is an open draft; it merges in Task 6. Stop and report on any gap.

- [ ] **Step 2: Brief Max.** He ran the last three releases. Find his handle with `rt chat buddies`, write the post with the Write tool to `<scratchpad>/max-brief.txt`, and post it as one line (`rt chat post <release room> "<text>"`) or a DM (`rt chat dm <max> "<text>"`):

```text
@max 2.13.0 tonight, full gate. Plan: one bundle-apps dispatch for deck 1.1.0, boxscore 0.1.0 (new row), board 0.1.6, chat 0.1.3, console 0.1.3; merge the bot deps.lock PR; merge the setup cleanup PR; then rt:release with the walkthrough, which now asserts deck's served apps (argv, cwd, icon, routes). Anything from your last three cuts I should watch for?
```

Read his answer before Task 3 if one arrives; do not block on it overnight.

---

### Task 2: bundle-apps preconditions

**Files:** none.

- [ ] **Step 1: The five version bumps are on apps `main`.**

```bash
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/deck/package.json > <scratchpad>/deck-package.json
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/boxscore/package.json > <scratchpad>/boxscore-package.json
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/board/package.json > <scratchpad>/board-package.json
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/chat/package.json > <scratchpad>/chat-package.json
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/console/package.json > <scratchpad>/console-package.json
grep -h '"version"' <scratchpad>/deck-package.json <scratchpad>/boxscore-package.json <scratchpad>/board-package.json <scratchpad>/chat-package.json <scratchpad>/console-package.json
```

Expected, in that order: `1.1.0`, `0.1.0`, `0.1.6`, `0.1.3`, `0.1.3`.

- [ ] **Step 2: The five tags are free.** The dry run skips the tag guard (`bundle-apps.yml:120`), so check it here, one call each:

```bash
gh api repos/m4ttstack/apps/git/ref/tags/deck-v1.1.0 --silent
gh api repos/m4ttstack/apps/git/ref/tags/boxscore-v0.1.0 --silent
gh api repos/m4ttstack/apps/git/ref/tags/board-v0.1.6 --silent
gh api repos/m4ttstack/apps/git/ref/tags/chat-v0.1.3 --silent
gh api repos/m4ttstack/apps/git/ref/tags/console-v0.1.3 --silent
```

Expected: each fails with `HTTP 404`. A tag that exists means that version already shipped; stop and report.

- [ ] **Step 3: rt `main` carries the pending boxscore row, the serve rows and the identity pipeline.**

```bash
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/rt/contents/rt-tray/deps.lock > <scratchpad>/deps.lock
grep -n '"name": "boxscore"\|"serve"' <scratchpad>/deps.lock
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/rt/contents/.github/workflows/bundle-apps.yml > <scratchpad>/bundle-apps.yml
grep -n "stage-identity" <scratchpad>/bundle-apps.yml
```

Expected: the boxscore row with `"status": "pending"`, `"repo": "m4ttstack/apps"`, `"subdir": "apps/boxscore"` and `"serve": { "port": 11005, "args": [] }`; `serve` on board (11006), console (11001) and chat (11002) and nowhere else; and the `Stage app identity` step in bundle-apps. If boxscore's row is missing, the plan job fails on `unknown app "boxscore"`, and a run that got past it would publish the release and then die in `update-lock.ts`; do not dispatch.

---

### Task 3: Dry run

**Files:** none.

- [ ] **Step 1: Dispatch it.**

```bash
gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=deck,boxscore,board,chat,console -f dry_run=true
gh run list --repo m4ttstack/rt --workflow bundle-apps.yml --event workflow_dispatch --limit 1 --json databaseId,status,createdAt
gh run watch <databaseId> --repo m4ttstack/rt --exit-status
```

Expected: `plan`, five `build (...)` legs and five `sign-and-package (...)` legs green; `release` and `pr` skipped. `gh run watch --exit-status` can exit nonzero on a transient API error while the run is still in progress; if `gh run view <databaseId> --repo m4ttstack/rt` says in progress, watch again rather than reading it as a failure. The summary names `deck v1.1.0`, `boxscore v0.1.0`, `board v0.1.6`, `chat v0.1.3`, `console v0.1.3`, each with its `https://github.com/m4ttstack/apps/releases/download/<name>-v<version>/<name>-darwin-arm64.tgz` url. A build-leg failure here costs nothing: fix it in m4ttstack/apps with a PR (house review rules), merge, and dry-run again.

- [ ] **Step 2: Every served app's tarball carries identity.** One call each:

```bash
gh run download <databaseId> --repo m4ttstack/rt --name bundle-boxscore --dir <scratchpad>/dry/boxscore
tar tzf <scratchpad>/dry/boxscore/boxscore-darwin-arm64.tgz
gh run download <databaseId> --repo m4ttstack/rt --name bundle-board --dir <scratchpad>/dry/board
tar tzf <scratchpad>/dry/board/board-darwin-arm64.tgz
gh run download <databaseId> --repo m4ttstack/rt --name bundle-chat --dir <scratchpad>/dry/chat
tar tzf <scratchpad>/dry/chat/chat-darwin-arm64.tgz
gh run download <databaseId> --repo m4ttstack/rt --name bundle-console --dir <scratchpad>/dry/console
tar tzf <scratchpad>/dry/console/console-darwin-arm64.tgz
```

Expected: each listing holds `./<name>`, `./identity/mattstack.deck.json` and the icon its manifest names (boxscore: `./identity/public/favicon.svg`). deck's tarball stages no identity (its manifest declares no displayName or icon), which is correct. Do not extract or run any binary.

---

### Task 4: Real run and the bot deps.lock PR

**Files:** none.

- [ ] **Step 1: Dispatch it once.**

```bash
gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=deck,boxscore,board,chat,console -f dry_run=false
gh run list --repo m4ttstack/rt --workflow bundle-apps.yml --event workflow_dispatch --limit 1 --json databaseId,status,createdAt
gh run watch <databaseId> --repo m4ttstack/rt --exit-status
```

Expected: every job green, including `release` and `pr`.

Recovery: if the releases published but the `pr` job failed, rerun only that job (`gh run rerun <databaseId> --repo m4ttstack/rt --failed`). Never re-dispatch an app at a version whose tag now exists; the tag guard refuses it by design.

- [ ] **Step 2: Read the bot PR.**

```bash
gh release view boxscore-v0.1.0 --repo m4ttstack/apps --json tagName,assets
gh pr list --repo m4ttstack/rt --head bundle-ci/<databaseId> --json number,url,title
gh pr diff <number> --repo m4ttstack/rt
```

Expected: one open PR titled `deps.lock: app bundle build`. Its diff touches exactly the deck, board, console, chat and boxscore rows: new `version`, `url` and 64-hex `sha256` on each, boxscore flipped to `"status": "bundled"`, and every `serve` object unchanged (no row gains or loses `serve`).

- [ ] **Step 3: Verify each changed sha256 against its published asset** (the `rt:release` step 2b rule). One call per app, for example boxscore:

```bash
gh release download boxscore-v0.1.0 --repo m4ttstack/apps -p boxscore-darwin-arm64.tgz -D <scratchpad>/rel/boxscore
shasum -a 256 <scratchpad>/rel/boxscore/boxscore-darwin-arm64.tgz
```

Repeat for `deck-v1.1.0`, `board-v0.1.6`, `chat-v0.1.3`, `console-v0.1.3`. Expected: every digest equals the one on its row in the PR diff.

- [ ] **Step 4: CI green with no hand edit, reviewed, merged.** The bot PR's CI must pass as the bot wrote it: unit A's deps-lock-file tests name serve rows whatever their status and compute the bundled catalog from the lock, so the boxscore flip needs no test change. A red check means a unit plan missed something; read it, fix it in its own PR (never push to `bundle-ci/<run_id>`), and rerun. Review per the house rule (CodeRabbit, or an Opus stand-in when it is rate limited; a rate-limited green row is not a review), then merge:

```bash
gh pr checks <number> --repo m4ttstack/rt --watch
gh pr merge <number> --repo m4ttstack/rt --squash
```

This merge closes the release-free window.

---

### Task 5: Gate the released boxscore binary on this Mac

**Files:** none (scratchpad only).

- [ ] **Step 1: Fetch the gate from apps `main`, unpack the released tarball, check its signature.** One call each:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/boxscore/scripts/binary-gate.sh > <scratchpad>/binary-gate.sh
tar xzf <scratchpad>/rel/boxscore/boxscore-darwin-arm64.tgz -C <scratchpad>/rel/boxscore
codesign -dvv <scratchpad>/rel/boxscore/boxscore
```

Expected: `codesign` prints `Identifier=com.mattstack.helper.boxscore` and an `Authority=Developer ID Application: ...` line.

- [ ] **Step 2: Serve it under a fresh HOME.** The gate runs the binary only under `env -i HOME=<temp>` and needs an app dir for `package.json`, so point it at a copy:

```bash
mkdir -p <scratchpad>/gate-app/scripts
cp <scratchpad>/binary-gate.sh <scratchpad>/gate-app/scripts/binary-gate.sh
cp <scratchpad>/boxscore-package.json <scratchpad>/gate-app/package.json
env BINARY=<scratchpad>/rel/boxscore/boxscore bash <scratchpad>/gate-app/scripts/binary-gate.sh
```

Expected: `binary-gate: boxscore 0.1.0 serves its embedded assets and opens its store` and exit 0. CI only ever gated the linux binary, so this is the one proof the darwin binary serves and opens its SQLite store. A failure here blocks the release: report it with the gate's server log.

---

### Task 6: Merge unit E

**Files:** none.

- [ ] **Step 1: Record the B dev-creation decision.** Read what deck 1.1.0 shipped:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/m4ttstack/apps/contents/apps/deck/src/api/register.ts > <scratchpad>/register.ts
grep -n "async function ensureCatalogRows\|adopt: boolean\|ensureCatalogRows(flavor.catalog" <scratchpad>/register.ts
```

Expected: `ensureCatalogRows` takes `adopt: boolean` and the sweep calls it whenever a catalog exists, which means dev creates missing catalog rows too (B contract note 12, the recommended default). Confirm E's PR body carries the matching **Dev flavor** line; if Matt ruled otherwise before this point, the line and the spec's rule section say so instead. If Matt has not ruled, the default stands and Task 9's handoff asks him to confirm it.

- [ ] **Step 2: Mark ready and merge.**

```bash
gh pr ready rt-2-13-e-setup-cli-cleanup --repo m4ttstack/rt
gh pr checks rt-2-13-e-setup-cli-cleanup --repo m4ttstack/rt --watch
gh pr merge rt-2-13-e-setup-cli-cleanup --repo m4ttstack/rt --squash
```

Merge only with CI green and review findings addressed (E Step 7).

---

### Task 7: Release 2.13.0 through `rt:release`, full gate

**Files:** `RELEASE_NOTES.md` and `website/` (written by the skill).

- [ ] **Step 1: Tell Max the cut is starting** (`rt chat post <release room> "@max starting the 2.13.0 cut: bot deps.lock PR and setup cleanup merged, running rt:release full gate now"`), and keep posting at the rehearsal, walkthrough and tag.

- [ ] **Step 2: Run the `rt:release` skill end to end.** Invoke it and follow it exactly. The 2.13.0 specifics:
  - `rt release preflight` must exit 0 with every `app:` row current (deck 1.1.0, board 0.1.6, chat 0.1.3, console 0.1.3, and boxscore 0.1.0 as a new row). Its `gate:` line must say full gate (new row `boxscore`, and the tray and setup changes). If it says fast path, stop: the walkthrough is the only real-launchd proof of units F and H.
  - Version bump: minor, `v2.13.0`.
  - Release notes name the six tickets (RT-279 to RT-284) and the app versions, with no em or en dashes.
  - Rehearse (`release.yml` dispatch) and walk the rehearsal's dmg through the clean room with `--scenario create --fresh-team-repo --no-graphics`, as the skill says. The walkthrough's `assert` phase now runs unit H's served-app assert: board, chat, console and boxscore rt-managed, healthy, each advertising its icon, argv `[<bundle>/Contents/Helpers/<name>]`, cwd `~/.mattstack/<name>`, a pid, every `.mattstack` route answering, and no tool loaded as a deck job. `screens` and `assert` must both be `pass`; a `skip` is not green. If there is time, add `--update-dir`/`--update-version` so the Sparkle update leg runs too.
  - Tag the exercised sha, push it, `rt release verify v2.13.0`, deploy rt.cool, exactly as the skill says. Notarization and the Sparkle feed (`appcast.xml`) are produced by `release.yml` and confirmed by `rt release verify`.

- [ ] **Step 3: If the walkthrough fails**, read the report and the guest logs the skill names (a `deck.managed` failure: `~/.mattstack/deck/logs/agent.log` first; an assert failure: `logs/assert-served/`). A served-app assert failure is a real defect in B, C, D or F: fix it in its unit's repo with a PR, and if an app changed, that app needs a new version and its own bundle-apps dispatch (the release-free rule applies again until its bot PR merges). Tell Max what failed.

---

### Task 8: Update Matt's prod through Sparkle; rebuild the dev app from main

**Files:** none.

- [ ] **Step 1: Prod through Sparkle.** This is a binary-only update for the served apps' plists on a machine that lived in dev, which is exactly the path unit F's post-settle restart covers. If prod 2.12.0 is running, trigger its own update check (the tray menu's Check for Updates), install 2.13.0 and let it relaunch. If prod is not running, or Sparkle needs a click nobody is awake to give, do not launch or drive the GUI: put it in Task 9's handoff.

After the relaunch, check the evidence, one call each:

```bash
defaults read /Applications/mattstack.app/Contents/Info.plist CFBundleShortVersionString
grep -h "served apps restarted after version change\|app version recorded after agents answered" ~/.mattstack/rt/logs/tray.*.log
deck status
```

Expected: `2.13.0`; both tray log lines from the relaunch; `deck status` lists board, chat, console and boxscore healthy (open the window only if Matt is awake to look at the tab icons).

- [ ] **Step 2: Rebuild the dev app from main.** Follow the dev-bundle leg of `rt:release` step 12 (and `AGENTS.md` "Getting a change into the running dev app"): in a scratch tree at the released commit, `scripts/fetch-deps.sh arm64`, then `rt-tray/build.sh dev`, then replace `/Applications/mattstack-dev.app` by moving the old one aside. Never build in the shared checkout's `rt-tray/`. `rt release update-machine --plan` shows the legs it would run; its prod leg must not run again (Sparkle already updated prod), so if it cannot be skipped non-interactively, run the dev-bundle leg by hand as above and then `rt release update-machine --verify-only`. If auto mode refuses the build or the app launch, hand the exact commands to Matt (Task 9).

---

### Task 9: File the follow-up tickets and hand off

**Files:** none.

- [ ] **Step 1: File six tickets** in the mattstack Linear org (the `linear-matt` connector, team RT, the team RT-279 to RT-284 live in), PM-shaped as below. Search first (`list_issues` with the title's key words) and skip any that already exist.

**Ticket 1: VM clean room: the lived-in-dev-mode leg**

```markdown
## Problem
The walkthrough only proves a clean install. 2.12.0 broke on a machine that had lived in dev mode first, and nothing replays that path, so a regression in the flavor flip ships unseen.

## Fix
Add a walkthrough scenario that runs the dev app with source-linked registrations first, then installs prod and runs the served-app assert, then flips back.

## Acceptance
- The scenario seeds a dev-lived registry (linked rows, a gitq web row) before the prod install
- The prod assert passes: catalog apps served from the bundle, gitq not served, no row deleted
- Flipping back to dev serves the registrations from source again

## Source
Spec 2026-09-24 prod readiness 2.13, "Out of scope tonight"; the rest of RT-284.
```

**Ticket 2: Flavor exclusivity at login**

```markdown
## Problem
At login the other flavor's still-enabled agents reload, and flavor takeover boots them out rather than retiring them, so after a reboot both flavors' agents compete for the same labels.

## Fix
Takeover retires the other flavor's agents (unregisters them) instead of booting them out.

## Acceptance
- After a takeover and a logout and login, only the active flavor's agents are loaded
- The other flavor's agents are no longer registered after takeover

## Source
Spec 2026-09-24 prod readiness 2.13, "Out of scope tonight".
```

**Ticket 3: Debug builds must not write prod's launch state**

```markdown
## Problem
An Xcode Debug build carrying prod's bundle id started at login on 2026-09-24 and wrote prod's launch state.

## Fix
Give Debug builds their own identity, or skip login-item registration in Debug.

## Acceptance
- A Debug build never registers a login item under prod's bundle id
- Running a Debug build leaves prod's recorded launch state untouched

## Source
Spec 2026-09-24 prod readiness 2.13, "Out of scope tonight".
```

**Ticket 4: Deck restarts served apps when the bundle version changes**

```markdown
## Problem
A binary-only Sparkle update swaps Contents/Helpers/<app> at the same path, so deck's boot sweep finds every served plist unchanged and the apps keep running the deleted binary, losing their privacy grants. 2.13.0 covers this with a one-shot `deck restart --managed` from the tray after deck answers; the fact it patches lives in deck.

## Fix
Deck's sweep records the bundle version each catalog row last started under and kickstarts rows whose recorded version differs at boot. Then the tray's post-settle restart can go.

## Acceptance
- After a binary-only update, every catalog app runs a new pid with no tray action
- An unchanged bundle kickstarts nothing
- The older deck pinned in the other flavor still reads the registry

## Source
Unit F plan, contract note 2.
```

**Ticket 5: Compile console and chat with the autoload flags**

```markdown
## Problem
Deck runs bundled apps from ~/.mattstack/<name>. console and chat are compiled without `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`, so a stray .env or bunfig.toml there is loaded, and a bunfig preload runs arbitrary code. rt and boxscore already pass both flags.

## Fix
Add both flags to console's and chat's build:binary, with boxscore's bundle-ready test and binary gate.

## Acceptance
- Both build:binary scripts carry both flags, pinned by a test
- A gate run with a poisoned .env and bunfig.toml in the working directory passes for both apps

## Source
Unit D plan, contract note 6.
```

**Ticket 6: rt:release fast path must not skip the walkthrough for served-app changes**

```markdown
## Problem
The rt:release skill's pin-only fast path skips the walkthrough when only app deps.lock rows change, which is exactly when the served-app assert matters. Preflight now sends a serve change to the full gate, but a pin bump on a served app still skips the one check that proves deck serves it.

## Fix
Update the skill (through superpowers:writing-skills) so a served app's pin change runs at least the walkthrough's assert phase, and so the skill's rule and preflight's gate line agree.

## Acceptance
- The skill's fast-path rule names served-app pin changes and serve changes explicitly
- Preflight's gate line and the skill agree on a serve-only diff

## Source
Unit H plan, contract note 7.
```

- [ ] **Step 2: Hand off.** Write a short summary with the Write tool and post it to the release room (and DM Matt if that is how he asked to be told): the release url, the five app release urls, the bot PR, the walkthrough verdict, the six ticket ids, and anything left for Matt: the Sparkle click or prod launch if Task 8 Step 1 deferred it, the dev-app rebuild if auto mode refused it, and a one-line ask to confirm the B dev-creation default (dev creates missing catalog rows) or rule it out.

---

## Contract notes

1. **This runbook replaces unit D's old Task 6** and absorbs the single five-app dispatch that units C and D each described. The dispatch spans B, C and D, so no unit plan owns it.
2. **Why five apps in one run.** C-rt's `check-bundle.sh` requires identity for every served row, and board 0.1.5, chat 0.1.2 and console 0.1.2 are pinned to tarballs built before identity existed; deck and boxscore are new builds. One run yields one bot PR, and two real runs back to back conflict on it.
3. **Release-free window.** Opens at the first of the A and C-rt merges and closes when the bot PR merges (Task 4 Step 4). Unit E merges after it closes, and the release is cut after E.
4. **Out-of-scope tickets come from the spec** (tickets 1 to 3); tickets 4 to 6 are the follow-ups units F, D and H raised.

## Depends on

README merge order steps 1 to 8 merged (Task 1 checks). Everything here is sequential: dispatch, bot PR, E, release, post-release, tickets.
