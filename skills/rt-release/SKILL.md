---
name: rt:release
description: Use when the user says release, cut a release, tag and release, ship a release, or push a new version of rt.
---

# rt Release

Update the rt.cool docs, write the GitHub release notes from the previous tag
to HEAD, commit them, and push a version tag. Pushing the tag is what publishes:
the `.github/workflows/release.yml` workflow (trigger `on: push: tags: v*`) builds
and notarizes **mattstack.app**, creates the GitHub release from the committed
`RELEASE_NOTES.md`, and attaches the `.dmg`, `.zip`, Sparkle deltas,
`appcast.xml`, and `SHA256SUMS`. You never create the GitHub release yourself;
CI owns the release object. Your job is docs, notes, the tag, verifying CI, and
deploying rt.cool.

A release also republishes the Claude Code plugin catalog: the workflow's first
step runs `scripts/release/marketplace.sh`, pushing `marketplace/` to
`m4ttstack/mattstack-marketplace`, which `plugins.install` adds on every machine
rt sets up. It needs the `MARKETPLACE_TOKEN` secret, but only on a release where
that catalog actually changed — an unchanged one is a no-op that pushes nothing.

> **rt no longer ships as standalone tarballs.** The `rt-darwin-arm64-*.tar.gz`
> / `rt-darwin-x64-*.tar.gz` artifacts this skill was written around are gone —
> `rt` is now the binary embedded at `Contents/MacOS/rt` inside the app bundle,
> and users update through Sparkle rather than by downloading a tarball.
>
> This skill still owns the docs/notes/tag half of a release. The build,
> signing, notarization, clean-room, and appcast half — plus the cross-repo
> coordination a release needs (deck, board, gitq, fast-browser, console) — is
> `~/.claude/skills/mattstack-release/SKILL.md`. Read that one before cutting a
> real release; read this one for the notes and the tag.

This supersedes the local `.claude/commands/release.md` command; that file can be
left as-is or reduced to a pointer here.

## Process

1. **Verify state: run `rt release preflight`.** One read-only command
   (from source: `bun run cli.ts release preflight`; `--json` for the
   agent envelope) performs every mechanical check in steps 1-2c at once:
   git/tag state (on `main`, tree clean, commits since the last tag), the
   picker conformance gate, the settings schema lock against the last
   tag, per-app pin freshness, the standalone
   gitq/fast-browser rows, tool-row drift against upstreams, plugin
   catalog pin drift, Chrome extension currency, rt-client npm-vs-source
   parity, and the gate (fast path vs full) the pending diff implies.
   Exit 0 means every layer verified current. A stale row prints pinned
   vs current; an unverifiable row (`!`) is not a pass — rerun or check
   that layer by hand before proceeding. Abort on a stale `git state`
   row (off main, dirty tree). A stale `schema lock` row names a key
   whose committed schema can reject a value the lock at the last tag
   accepted, with no `storeVersion` bump or no entry in
   `packages/rt-client/src/settings/breaking-schema-changes.json`; land
   the bump and the one-line reason (or revert the tightening) on main
   before tagging. `bun run cli.ts settings check` (source, so it checks
   this release's registry) must also exit 0 against the real stores; a
   finding is fixed in the schema, never in the store. Every other stale
   row is handled by the policy in steps 2b-2c: cut the layer's release,
   or the user ratifies holding the pin and the release notes record it.

2. **Determine version bump.** From `git log --pretty=%s <last-tag>..HEAD`:
   any `feat(` or a new module/file is a minor bump; only `fix(` / `chore(` /
   `docs(` / `ci(` / `test(` is a patch bump; if ambiguous, ask.

2b. **Pin freshness: the bundled apps ship at their deps.lock pins, not at
   apps main.** v2.9.0 shipped a ten-day-stale app layer this way (every
   app pinned at the Sep 7 fold-in while board's half of the gate-seam epic
   sat merged and unreleased), and nothing in the process said so.
   Preflight's `app` rows do the compare for each apps-monorepo row in
   `rt-tray/deps.lock` (board, chat, console, deck): the pinned release's
   published date against the subdir's latest commit on `m4ttstack/apps`
   main; a stale row means the subdir moved since the pin.

   The policy is content lockstep, independent numbering: an app whose
   subdir moved since its pin gets a release cut from the same main this
   tag builds against. Nothing in that pipeline is tag-triggered, so
   never hand-push an app tag; a hand-pushed tag builds nothing. The
   pipeline: bump `apps/<app>/package.json` on apps main via PR, then

   ```
   gh workflow run bundle-apps.yml --repo m4ttstack/rt -f apps=<comma-list>
   ```

   (`bundle-apps.yml` lives in rt, not the apps repo). The workflow reads
   each app's package.json version, mints the app-prefixed tag itself,
   creates the apps release with the tarball, and opens ONE combined
   deps.lock PR on rt covering every app it was dispatched for; verify
   each changed row's sha256 against the published asset before merging.
   Merge-on-green, here and for any release-day PR, means zero pending
   checks AND at least one pass; any fail blocks. A failed check in a
   suite the diff cannot touch (a deps.lock pin failing a UI test) is
   rerun-first: `gh run rerun <run-id> --failed`, then re-gate. A green
   CodeRabbit row is only a review if it actually reviewed: the org is
   rate-capped, and a rate-limited pass reports success having read
   nothing (check for a real review body or inline comments). For
   release-bound code changes, a rate-limited CodeRabbit means a
   strong-model subagent reviews the diff instead; docs-only diffs may
   merge on CI alone when the user has said so. An
   unchanged app keeps its pin, no empty releases. Holding a stale pin
   anyway is allowed but is a decision the user makes and the release
   notes record, never a silent default. Version numbers stay per-app;
   rt's own tag plus the committed deps.lock is the compatibility record.

   Since 2026-09-18 (rt#347) bundle-apps signs every artifact with the
   Developer ID cert under the stable identifier
   `com.mattstack.helper.<app>`, so deployed binaries keep their macOS
   TCC grants across updates on BOTH channels (the bundle's embedded
   helpers, which build.sh re-signs with the same identifier convention,
   and the raw-artifact channel: fetch-deps copies and each app's
   self-update). Two consequences: an app pin minted before that date
   points at ad-hoc-signed bytes, and re-cutting it through the signing
   workflow is a REAL release even with no source change (the artifact
   changes; note it as "signed build" in the app release); and a user's
   first deploy of a signed build prompts for TCC once more (the
   identity switches from ad-hoc to stable), then never again. Verify a
   signed artifact with `codesign -dvv` (Identifier plus a Developer ID
   Application authority); the workflow's dry_run input proves the
   signing path with no publish side effects.

2c. **The other vendored layers: plugins, standalone apps, tools, the
   extension.** Step 2b covers only the four apps-monorepo rows; v2.10.1
   shipped a marketplace catalog whose mattstack plugin pin was 263
   commits stale because nothing checked the rest. Preflight reports all
   of them; this step is what a stale row means and what to do about it:

   - **Plugin catalog** (`catalog` rows): preflight re-resolves each
     url-source pin's ref with `git ls-remote`, read-only. To land a
     bump: `bash scripts/release/marketplace.sh --refresh` rewrites
     `marketplace/marketplace.json` in place (`--refresh` ignores
     `--dry-run`, so there is no read-only refresh; that is why
     preflight does its own compare), then review the diff and land it
     before the notes commit so the tag publishes current pins. The
     in-tree `chat` plugin has no upstream and never drifts.
   - **Standalone app rows** (`standalone` rows: gitq, fast-browser):
     gitq compares against its repo's latest GitHub release;
     fast-browser against `m4ttstack/fast-browser`'s main
     `package.json`, because that repo publishes to npm and has no
     GitHub releases. Same lockstep policy as 2b; a stale hold is the
     user's recorded decision.
   - **Tool rows** (`tool` rows: bun, sparkle, age, zstd, git-lfs, gh,
     glab, jq, node, sops, cloudflared, portless): hand-pinned; Renovate
     does NOT watch deps.lock, so preflight's sweep is the only drift
     signal. It derives each row's upstream from its `url` (GitHub
     releases, the nodejs.org LTS index, the npm registry, the GitLab
     releases API). A bump PR pending on main at release time rides or
     holds by the user's call, never silently, and a sparkle bump never
     rides another release's tag: it changes the updater itself and gets
     its own tested release.
   - **rt-client** (`rt-client parity` row): npm must equal
     `packages/rt-client/package.json`; an unpublished source bump means
     consumers install stale (publish is release-class, from main only).
   - **NOT vendored, never stale here**: herdr and claude install via
     their own live installers (the `VENDOR_INSTALLERS` allowlist in
     `lib/setup/tools-install.ts`: herdr.dev/install.sh,
     claude.ai/install.sh), so they are current at install time by
     construction and update through their own channels; mattstack.dev
     reads releases/latest live and needs nothing per release.
   - **Chrome extension** (`chrome extension` row): the published
     extension is pinned by `runtime-lock.json` in m4ttstack/fast-browser
     (extension id, version, and the fork release it was built from);
     preflight compares that pin against the fork's newest
     `fast-browser-v*` release. A newer fork release means a runtime-lock bump
     (pin-runtime) and a Web Store submit, scripted in
     m4ttstack/fast-browser: `npm run publish-extension <store-zip>`
     (dry-run flag available) uploads and publishes via the items API
     with keychain credentials, refusing any zip whose manifest version
     differs from the runtime-lock pin. Store review delay is Google's,
     so surface a needed submit at step 2 time, never at the tag.
     Credentials are three keychain items minted once by
     `npm run cws-mint-token` (GCP OAuth desktop client, Chrome Web
     Store API enabled, publisher account on the consent app's test
     users).

3. **Push main.** If `main` is ahead of `origin/main`, push it. This is an
   outward action: unless the user pre-authorized the release, say what you are
   about to push and wait for confirmation.

4. **Update docs.** Run `bun scripts/update-docs.ts --no-agent`: it regenerates
   the command reference, runs the drift/coverage check, and scaffolds
   `RELEASE_NOTES.md` for `<last-tag>..HEAD`. It scaffolds UNCONDITIONALLY:
   any curated notes already in the file are overwritten, so if curation
   exists (a re-run mid-release, or notes written early), copy
   `RELEASE_NOTES.md` aside first and restore after. Then, following
   `skills/rt-docs/SKILL.md`, update whichever guides, getting-started pages, or
   `_partials` the range's behavior changes require. Do the judgment yourself in
   this session; do not shell out to a nested headless Claude.

5. **Write the release notes.** Refine `RELEASE_NOTES.md` into the body that will
   be published verbatim: grouped by scope, a `### ` heading per section, one
   bullet per change, a `**Full Changelog**` compare link from the previous tag
   to the new tag at the bottom. Every line traces to a real commit in
   `git log <last-tag>..HEAD`; never invent or embellish. Calibrate tone against
   a prior release with `gh release view <last-tag>`.

6. **Show the user and get approval.** Print the proposed tag, the full
   `RELEASE_NOTES.md` body, and the docs diff (`git diff --staged --stat` for
   `website/`). Get explicit approval before committing, tagging, or deploying.
   Nothing below runs until this approval is given.

7. **Commit and push the notes, without tagging.** `RELEASE_NOTES.md` must be
   committed at the commit the tag will point to, because CI reads it as the
   release body. Every release-day PR this release depends on (deps.lock
   pins, a catalog refresh, anything the notes describe) must be MERGED
   before this commit: the notes commit is the tag target, and whatever
   lands after it misses the tag. Scoped add only, never `git add -A`:
   ```
   git add website RELEASE_NOTES.md
   git commit -m "chore(release): docs and notes for <tag>"
   git push origin main
   ```
   Stop here. The tag comes after the rehearsal, so that the commit it will
   point at is the one that was actually exercised.

8. **Rehearse the pipeline.** Run `release.yml` via `workflow_dispatch` against
   the commit you just pushed. It builds, notarizes, and clean-rooms exactly as
   a tag does, but stamps `v0.0.0-ci<run>`, skips the release, validates the
   marketplace catalog without pushing it, and uploads `out/` as an artifact.
   Watch it green before continuing. This pipeline's defects have consistently
   been invisible until the step before them started working, so a rehearsal is
   the only thing that finds them cheaply... a tag that fails halfway has already
   re-signed the app and cost the user their TCC grants.

   check-bundle.sh (run automatically by this workflow) asserts
   `Contents/Helpers/gate-fork.sh` exists and is executable, so a missing or
   non-executable copy already fails the rehearsal loudly; no separate manual
   check is needed here.

   Then walk the rehearsal's own artifact through the local clean room. GitHub
   runners cannot nest virtualization, so this leg runs only on this machine:
   ```
   gh run download <run-id> -n release-dry-run -D /tmp/release-dry-run
   bash rt-tray/vm/run/walkthrough.sh --ver 26 \
     --dmg /tmp/release-dry-run/mattstack-v0.0.0-ci<run>.dmg \
     --scenario create --fresh-team-repo --no-graphics
   ```
   It needs the `mattstack-golden-26` image and takes about 25 minutes. The gate
   is the report's `screens` and `assert` phases both `pass` — a `skip` is not
   green. Tag only when the dispatch run and this walkthrough are both green.

   Environment the walkthrough actually needs (the v2.9.0 run hit all
   three): `MATTSTACK_VMTEST_PAT` set (`gh auth token` works for GitHub;
   `--forge gitlab` needs a GitLab PAT, since the harness exports it as
   `GITLAB_TOKEN`), and the real vmtest org is `matts-hasura-demo` — the
   README's default `mattstack-vmtest` does not exist — so export
   `MATTSTACK_VMTEST_ORG=matts-hasura-demo` and
   `MATTSTACK_VMTEST_ORG_CONFIRM=matts-hasura-demo`. Also: the rehearsal's
   dmg version stamp is `<latest-patch-bump>-ci<run>`, not `v0.0.0` — read
   the artifact's actual filename rather than assuming.

   Before launching the walkthrough, run `tart list` and stop or delete
   any running guests: macOS virtualization caps concurrent VMs at two,
   so a leftover guest makes the new one fail boot as "ssh as tester
   never came up". A closed job's pane may never have run its cleanup;
   verify, don't assume.

   **Pin-only fast path** (user-ratified 2026-09-18; preflight's
   `gate:` line computes this call): when `git diff
   --stat <last-tag>..HEAD` touches ONLY `rt-tray/deps.lock` (plus
   `RELEASE_NOTES.md` and `website/`) AND every changed row is an app deck
   merely serves (board, chat, console, gitq, boxscore), skip the local
   walkthrough and tag on the rehearsal alone: CI still builds, notarizes,
   and clean-room installs, and those apps play no part in the setup flow
   the walkthrough exercises. Rows that DO participate in onboarding keep
   the full gate no matter how small the diff: deck (the deck.managed
   adopt is walkthrough territory, and a deck pin is exactly what the
   walkthrough gated on 2026-09-18), fast-browser (fastbrowser.setup ran
   a real setup regression to ground in v2.9.0), and every tool row (bun,
   sparkle, age, zstd, git-lfs, and the rest all run during install). Any changed file outside that list also means the full gate.

   When a walkthrough fails on `deck.managed`, read
   `~/.mattstack/deck/logs/agent.log` from the guest-home tarball FIRST;
   its shape names the failure: no entries at all is the silent no-spawn
   window (launchd never ran the registered agent, often right after the
   FDA relaunch); failed-bind holder lines are the port wedge; a fresh
   "serving" line seconds before the step failed means adopt raced deck's
   registry bootstrap. All three are rerun-first during a release, and the
   evidence goes to the deck boot ticket, not into ad-hoc guest debugging.

9. **Tag and push.** Tag the EXERCISED sha explicitly, never bare HEAD:
   the shared checkout moves under a release (other sessions merge to
   main mid-pipeline, twice on 2026-09-18 alone), and the tag must point
   at the commit the rehearsal and walkthrough actually ran.
   ```
   git tag -a <tag> <exercised-sha> -m "<tag>"
   git push origin <tag>
   ```
   Do NOT run `gh release create`. The tag push triggers `release.yml`, which
   builds and notarizes the app, publishes the marketplace catalog, creates the
   release from `RELEASE_NOTES.md`, attaches the artifacts, and installs from
   the zip in a clean room.

10. **Verify the publish: run `rt release verify <tag>`.** One read-only
   command (`--json` for the agent envelope) performs every check this step
   used to run by hand: it finds the `release.yml` run for the tag and
   watches it for up to about an hour (a real run, macOS build plus
   notarize plus clean room, takes 25-50 minutes; `--no-wait` takes a single
   snapshot instead and stays pending until you re-run), tolerating
   transient API errors along the way (never a bare `gh run watch
   --exit-status`, which exits nonzero on a false FAILED while the run is
   still in_progress, seen live on v2.10.0). It also confirms the published
   body equals the committed `RELEASE_NOTES.md`, confirms all four assets
   (`mattstack-<ver>.dmg`, `mattstack-<ver>.zip`, `appcast.xml`,
   `SHA256SUMS`) are attached, confirms the release is neither a draft nor a
   prerelease, and confirms `https://api.github.com/repos/m4ttstack/rt/releases/latest`
   resolves to the tag with the same four assets. Exit 0 means the release
   is genuinely live; it prints "still propagating" rather than failing when
   a row is only waiting on that endpoint's cache. It never runs a recovery
   itself, only names one:

   - **Failed run** (the known flake is asset-upload 500s on the large
     files): `gh release delete <tag>` (the git tag survives) plus
     `gh run rerun <run-id> --failed`.
   - **Draft left behind** (the release action creates the release as a
     DRAFT and flips it public last, so a run that dies mid-upload leaves a
     draft that `gh release view` renders exactly like a published release
     while the public API and the mattstack.dev download button keep
     serving the previous tag): `gh release edit <tag> --draft=false`.
     Completing a failed run's assets by hand does not publish the draft;
     that flip is the missing step.
   - **Missing assets**: the hand-completion recipe (zip re-derive, appcast
     re-sign, draft flip) lives in `~/.claude/skills/mattstack-release/SKILL.md`.

   `releases/latest` caches and can lag up to ~20 minutes behind the flip;
   re-run the verb rather than declaring the publish failed inside that
   window. Anything else, report rather than papering over.

11. **Deploy rt.cool.** Run `bash scripts/deploy-docs.sh` (builds the site, deploys
   to Cloudflare Pages via wrangler). Needs wrangler auth (`wrangler login` or
   `CLOUDFLARE_API_TOKEN`) and the Pages project pointed at rt.cool's DNS, both
   one-time setup in the script header. If that setup is missing, tell the user
   the steps and stop rather than failing partway.

12. **Update this machine: run `rt release update-machine`.** The
   release is not done while the dev's own machine still runs the
   previous one; v2.10.0 ended with a 2.7.0 prod app, a day-old dev
   bundle, and served apps up to three days stale until the user asked.
   One command runs every leg below in order, each behind its own
   confirmation prompt: `--yes` skips every prompt, `--plan` prints the
   resolved legs and exits without touching anything, `--verify-only`
   runs just the last leg standalone (exit-coded, and refused together
   with `--plan`), and on a non-interactive terminal without `--yes` it
   refuses outright rather than guess at consent.

   A leg that ends aborted or error halts every later state-changing
   leg (the read-only verify sweep still runs and reports, and the
   summary names the leg that halted the run); declining a leg's
   confirmation prompt only skips that one leg and moves on. A sha256
   mismatch on the prod dmg is exactly this kind of abort: it stops the
   dev bundle, daemon, and served-suite legs from running unprompted
   even under `--yes`.

   - **Prod app**: resolves the released tag (default latest),
     downloads the dmg, verifies it against SHA256SUMS, mounts it
     (`hdiutil attach -plist`, never `-quiet`, which closes stdout
     entirely and leaves nothing to parse), and replaces
     `/Applications/mattstack.app`: moves the current app aside, ditto
     the new one into place, and only removes the aside copy once that
     succeeds (`ditto` onto an existing `.app` merges rather than
     replacing, so a plain ditto-over leaves stale files and can break
     the code-signature seal; a failed ditto restores the aside copy).
     A sha256 mismatch aborts before mounting or replacing anything.
     Never launches either copy: pre-2.8 updaters gate on
     `~/.local/bin/rt` existing, and a launched prod app's daemon
     seizes `rt.sock` from the dev daemon.
   - **Dev bundle**: in a scratch tree at the released commit,
     `scripts/fetch-deps.sh arm64` then `rt-tray/build.sh dev` (never
     rebuilds the blessed bundle in place), kills every process
     matching the running dev app and waits for them to actually exit,
     replaces `/Applications/mattstack-dev.app` the same move-aside way
     as the prod app, opens it, and polls briefly for a fresh pid
     (`open` hands off to LaunchServices and returns before the app is
     actually up).
   - **Daemon**: announces in #rt first (the dev daemon serves other
     sessions) and refuses to restart at all if the announce failed,
     then `rt daemon restart` and confirms `rt daemon status`'s
     `data.identity.sourceRev` prefix-matches the released commit
     (either can be the shorter abbreviation, so the match works in
     both directions; a prod daemon's null sourceRev is reported as a
     mismatch, never a silent pass).
   - **Served suite**: the `~/Documents/GitHub/mattstack-apps` checkout
     is shared, so this leg checks `git branch --show-current` first
     and aborts, touching nothing, if it is off main. On main: pull,
     then `deck restart --managed`, then poll each managed app's pid
     for a bit (a `deck restart` is a kickstart, not a readiness
     guarantee) via `launchctl print
     gui/<uid>/com.mattstack.deck.<app>` and, if the pid didn't change,
     its process start time from `ps` against the moment the restart
     began; stragglers are restarted by name and re-verified the same
     way. Rows deck lists as user-managed are the user's own; this leg
     leaves them alone.
   - **Verify**: prod Info.plist version equals the tag, dev app pid is
     fresh, daemon's sourceRev prefix-matches the released commit,
     `deck --version` matches the deps.lock pin, and every managed
     app's start time postdates the restart.

## Guardrails

- Never run `gh release create` or `gh release edit --notes` yourself. CI owns the
  release object. The curated notes reach it only by being committed as
  `RELEASE_NOTES.md` before the tag.
- No em dashes or en dashes in the notes; use commas, periods, or "...".
- Never invent a change that isn't in `git log <last-tag>..HEAD`.
- Never hand-write a command flag or arg table; those come only from
  `bun run docs:gen` (via `scripts/update-docs.ts`).
- Committing, tagging, and deploying happen only after the step 6 approval. The
  step 3 push may run earlier, but only once the user has confirmed it (or
  pre-authorized the release).
