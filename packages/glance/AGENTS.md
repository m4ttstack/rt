> Scope: packages/glance and packages/glance-react. This was the glance repo's contract before the fold-in.

# glance

The forge SDK behind the mattstack estate: `@mattstack/glance` (GitHub and
GitLab reads and writes behind one `GitProvider` interface) and
`@mattstack/glance-react` (the design system and components the apps share).
Read `docs/glance/README.md` for orientation, `packages/glance/README.md`
for the SDK API, and `packages/glance/src/GitProvider.ts` before adding an
option, since every provider implements it and new options are typed there
first.

## Layout and commands

A Bun workspace: the shared `catalog` lives in rt's root `package.json`, one
workspace with rt itself and the apps. `packages/glance` and
`packages/glance-react` pin TypeScript 5.9, vite 7 and `@vitejs/plugin-react`
5 explicitly instead of the catalog versions, a documented exception in
`apps/AGENTS.md`. `packages/typescript-config` is a private workspace package
the others depend on. Root scripts fan out through turbo (`bun run check`);
day to day, work from the package directory:

- `packages/glance`: `bun test` (Bun's runner), `bun run check-types` (covers
  `src` and `tests/live`), `bun run check:node` (builds, then
  `node tests/node-smoke.mjs`, the Node-vs-Bun parity check), `bun run build`
  (twelve explicit entrypoints plus `tsc -p tsconfig.build.json`).
- `packages/glance-react`: `bun run test` (vitest, happy-dom; Storybook
  interaction tests run through `@storybook/addon-vitest`), `bun run lint`
  (`eslint . --quiet`), `bun run format:check`, `bun run build` (tsc, vite,
  then the Tailwind CLI concatenates `palette.css` and `tokens.css` into
  `dist/tokens.css`), `bun storybook`.

`bun test`, `check-types` and `check:node` must be clean before every commit in
`packages/glance`; `test`, `lint` and `check-types` in `packages/glance-react`.

## The live suite mutates real repos

`packages/glance/tests/live/` and the root-level `live-*.test.ts` and
`integration.live.ts` run only with `GLANCE_LIVE=1`. They create branches and
MRs and merge into default branches on real GitHub and GitLab fixture repos,
so budget one live run per session and never point them at
`m4ttheweric/gitq-test-sandbox`. Credentials come from
`packages/glance/harness_credentials.json` (template:
`harness_credentials.example.json` beside it; loader:
`packages/glance/tests/live/credentials.ts`): three GitLab identities, since
GitLab blocks self-approval, plus the fixture-repo pointers. The second GitHub
identity is minted at run time with
`gh auth token --user $GLANCE_HARNESS_GITHUB_APPROVER`, on purpose, so nothing
GitHub-credential-shaped sits on disk. Never stage, print, or `git add -A`
that file. Every live entry point resolves the file relative to the package;
one that hardcodes an absolute path is a bug, not a convention.

## Release

Manual and per package; follow `packages/glance/docs/releasing.md`.
`prepublishOnly` runs `check-types` and `check:node` (glance) or
`check-types` and `build` (glance-react), so a publish that skips scripts
ships unchecked output. There is no release workflow; turbo runs the
typecheck, lint and test gates from rt's root (`bun run check`) instead.
In-repo consumers link the workspace package; external consumers (gitq
today) pin glance by version, so a behaviour change needs a bump before
they can see it.

## Invariants from recent releases

- **0.27.0, unresolved-thread blocker.** `hasUnresolvedDiscussions` in
  `packages/glance/src/MRDashboard.ts` keys off the GitLab mergeability check
  `DISCUSSIONS_NOT_RESOLVED` first (`FAILED` blocks, `INACTIVE` and `SUCCESS`
  clear) and falls back to the raw thread count whenever the check is
  anything else, including `CHECKING`, `WARNING`, or absent; a null
  `unresolvedThreadCount` means "not a blocker", never "unknown, so blocked".
- **0.26.0, `excludeTargetBranches`.** The option on the MR read options is
  exact names, no wildcards: expand a glob before passing it. GitLab applies
  it server-side, so excluded MRs' fields (approval state included) are never
  resolved; GitHub fetches and drops client-side. Only the `projectPath`-alone
  and `authorUsernames` fetch modes honour it.

## Design system

`packages/glance-react/.agents/SKILL.md` is the design-system contract for
consumer apps (never redefine colours, tokens or components downstream; how
to import styles; where the token files live). Read it before touching
`lib/css/` or a consumer's theme.

## What this codebase watches for

Something reporting success while proving nothing: a hardcoded constant
presented as a measurement, a silent no-op, a test that passes against a
stub that never exercised the contract. Every plan under
`docs/glance/superpowers/plans/` names an instance; the fix is always to
make the thing observable, not to add a comment. Comments explain why, never
what; no em or en dashes anywhere authored; one commit per completed task.
