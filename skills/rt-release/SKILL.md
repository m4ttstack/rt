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

1. **Verify state.** On `main`, working tree clean (`git status --short` empty),
   and commits since the last tag (`git describe --tags --abbrev=0`, then
   `<last-tag>..HEAD` non-empty). Then the command-tree gate: `bun run
   picker:check` green (every leaf that requires a positional declares an
   `omitBehavior` — the "omit args → picker" convention; a new command that just
   errors on a missing arg fails here). Abort on any of these.

2. **Determine version bump.** From `git log --pretty=%s <last-tag>..HEAD`:
   any `feat(` or a new module/file is a minor bump; only `fix(` / `chore(` /
   `docs(` / `ci(` / `test(` is a patch bump; if ambiguous, ask.

2b. **Pin freshness: the bundled apps ship at their deps.lock pins, not at
   apps main.** v2.9.0 shipped a ten-day-stale app layer this way (every
   app pinned at the Sep 7 fold-in while board's half of the gate-seam epic
   sat merged and unreleased), and nothing in the process said so. For each
   app row in `rt-tray/deps.lock` (board, chat, console, deck; gitq and
   fast-browser live in their own repos), compare the pinned release tag's
   date against the subdir's latest commit on `m4ttstack/apps` main:

   ```
   gh api repos/m4ttstack/apps/releases/tags/<tag> --jq '.published_at[:10]'
   gh api "repos/m4ttstack/apps/commits?path=apps/<app>&per_page=1" --jq '.[0].commit.committer.date[:10]'
   ```

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
   rerun-first: `gh run rerun <run-id> --failed`, then re-gate. An
   unchanged app keeps its pin, no empty releases. Holding a stale pin
   anyway is allowed but is a decision the user makes and the release
   notes record, never a silent default. Version numbers stay per-app;
   rt's own tag plus the committed deps.lock is the compatibility record.

2c. **The other vendored layers: plugins, standalone apps, tools, the
   extension.** Step 2b covers only the four apps-monorepo rows; v2.10.1
   shipped a marketplace catalog whose mattstack plugin pin was 263
   commits stale because nothing checked the rest. Walk these four:

   - **Plugin catalog**: `bash scripts/release/marketplace.sh --refresh
     --dry-run` names every url-source pin that drifted from its ref;
     rerun without `--dry-run`, review the diff, and land it before the
     notes commit so the tag publishes current pins. The in-tree `chat`
     plugin has no upstream and never drifts.
   - **Standalone app rows** (gitq, fast-browser): compare each
     deps.lock version against the app repo's newest release
     (`gh api repos/m4ttstack/<repo>/releases --jq '.[0].tag_name'`).
     Same lockstep policy as 2b; a stale hold is the user's recorded
     decision.
   - **Tool rows** (bun, sparkle, age, zstd, git-lfs, gh, glab, jq,
     node, sops, cloudflared, portless): hand-pinned; Renovate does NOT
     watch deps.lock, so drift is invisible until someone sweeps. The
     sweep (first run 2026-09-18): each row's `url` names its upstream,
     so compare pin against latest per source: GitHub-released tools via
     `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name`
     (jqlang/jq, FiloSottile/age, facebook/zstd, git-lfs/git-lfs,
     getsops/sops, cli/cli, oven-sh/bun, cloudflare/cloudflared,
     sparkle-project/Sparkle); glab via the gitlab-org/cli releases API;
     node against the newest LTS in nodejs.org/dist/index.json; portless
     via `npm view portless version`. A bump PR pending on main at
     release time rides or holds by the user's call, never silently, and
     a sparkle bump never rides another release's tag: it changes the
     updater itself and gets its own tested release.
   - **rt-client**: `npm view @mattstack/rt-client version` must equal
     `packages/rt-client/package.json`; an unpublished source bump means
     consumers install stale (publish is release-class, from main only).
   - **NOT vendored, never stale here**: herdr and claude install via
     their own live installers (the `VENDOR_INSTALLERS` allowlist in
     `lib/setup/tools-install.ts`: herdr.dev/install.sh,
     claude.ai/install.sh), so they are current at install time by
     construction and update through their own channels; mattstack.dev
     reads releases/latest live and needs nothing per release.
   - **Chrome extension**: the published extension is pinned by
     `runtime-lock.json` in m4ttstack/fast-browser (extension id,
     version, and the fork release it was built from). It is current
     when the fork's newest `fast-browser-v*` release equals the pinned
     one (`gh api repos/m4ttheweric/playwright/releases` filtered by
     that prefix). A newer fork release means a runtime-lock bump and a
     Web Store submit, which only the user can do and store review
     delays; surface it at step 2 time, never at the tag.

3. **Push main.** If `main` is ahead of `origin/main`, push it. This is an
   outward action: unless the user pre-authorized the release, say what you are
   about to push and wait for confirmation.

4. **Update docs.** Run `bun scripts/update-docs.ts --no-agent`: it regenerates
   the command reference, runs the drift/coverage check, and scaffolds
   `RELEASE_NOTES.md` for `<last-tag>..HEAD`. Then, following
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
   release body. Scoped add only, never `git add -A`:
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

   **Pin-only fast path** (user-ratified 2026-09-18): when `git diff
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

9. **Tag and push.**
   ```
   git tag -a <tag> -m "<tag>"
   git push origin <tag>
   ```
   Do NOT run `gh release create`. The tag push triggers `release.yml`, which
   builds and notarizes the app, publishes the marketplace catalog, creates the
   release from `RELEASE_NOTES.md`, attaches the artifacts, and installs from
   the zip in a clean room.

10. **Verify the publish.** Find the run (`gh run list --workflow=release.yml`)
   and watch it to completion (`gh run watch <run-id> --exit-status`), then confirm with
   `gh release view <tag>`: the body is your `RELEASE_NOTES.md` (not GitHub's
   auto-generated notes), and `mattstack-<ver>.dmg`, `mattstack-<ver>.zip`,
   `appcast.xml`, and `SHA256SUMS` are all attached. The workflow asserts those
   four itself before publishing, so a missing one fails the run rather than
   shipping a partial release. If CI failed or the body is wrong, report it
   rather than papering over it.

   Assets and body are not the whole verification: the release action creates
   the release as a DRAFT and flips it public last, so a run that dies
   mid-upload leaves a draft that `gh release view` renders exactly like a
   published release while the public API and the mattstack.dev download
   button keep serving the previous tag. Confirm
   `gh release view <tag> --json isDraft,isPrerelease` shows both false, and
   that `https://api.github.com/repos/m4ttstack/rt/releases/latest` resolves
   to the new tag with all four assets (give the endpoint a minute; it
   caches). Completing a failed run's assets by hand does not publish the
   draft: `gh release edit <tag> --draft=false` is the missing flip.

11. **Deploy rt.cool.** Run `bash scripts/deploy-docs.sh` (builds the site, deploys
   to Cloudflare Pages via wrangler). Needs wrangler auth (`wrangler login` or
   `CLOUDFLARE_API_TOKEN`) and the Pages project pointed at rt.cool's DNS, both
   one-time setup in the script header. If that setup is missing, tell the user
   the steps and stop rather than failing partway.

12. **Update this machine.** The release is not done while the dev's own
   machine still runs the previous one; v2.10.0 ended with a 2.7.0 prod
   app, a day-old dev bundle, and served apps up to three days stale
   until the user asked. In order:

   - **Prod app**: download the released dmg, verify it against
     SHA256SUMS, and replace `/Applications/mattstack.app` with the
     mounted copy (`ditto`). Never launch an old prod copy to
     Sparkle-update it: pre-2.8 updaters gate on `~/.local/bin/rt`
     existing, and a launched prod app's daemon seizes `rt.sock` from
     the dev daemon. Do not launch the new copy either; it sits ready
     for the next flavor flip.
   - **Dev bundle**: in a scratch clone or worktree at the released
     commit, `scripts/fetch-deps.sh arm64`, then `rt-tray/build.sh dev`
     (never rebuild the blessed bundle in place). With the user's
     approval, swap `/Applications/mattstack-dev.app`: kill the running
     dev app by pid (a polite quit fails silently), `ditto` the new
     bundle over, `open` it, and verify a fresh pid and launch time.
   - **Daemon**: announce in #rt first (the dev daemon serves other
     sessions), then `rt daemon restart` and confirm `rt daemon status`
     reports the released commit.
   - **Deck and the served suite**: the bundle swap ships the new
     Helpers, but the live agent binary is `~/.local/bin/deck`; confirm
     `deck --version` matches the deps.lock pin. The rt-managed served
     apps (board, chat, console, boxscore, gitq) run from the
     `~/Documents/GitHub/mattstack-apps` checkout, so pull it to main
     (branch-check first, it is shared) and `deck restart --managed`.
     Then verify each managed app's pid actually cycled via `launchctl
     print gui/501/com.mattstack.deck.<app>`: a socket blip can end the
     restart loop partway, so restart stragglers by name. Rows deck
     lists as user-managed are the user's own; leave them.
   - **Verify**: prod Info.plist version equals the tag, dev app process
     is fresh, daemon reports the released commit, `deck --version` is
     current, and every managed app's start time postdates the restart.

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
