# Publishing runbook

This repo is simultaneously (a) a working template app and (b) the npm package that scaffolds new
apps from it (`create-cli/create.ts` copies the repo root as the template). It ships with
`"private": true` in `package.json` as a safety net against an accidental `npm publish`. This is the
exact, in-order runbook for turning it into a real, installable `create-<name>` package.

## 1. Pick the final name

Decide the scaffold name, e.g. `create-foo`. Everywhere below, `<name>` means the part after
`create-` (so for `create-foo`, `<name>` is `foo`).

## 2. Find-replace `mantine-kit` -> `<name>` across the repo

The working name `mantine-kit` is embedded as literal text in a known set of files. Find every
occurrence first:

```bash
grep -rln "mantine-kit" . --exclude-dir={node_modules,.git,dist,storybook-static,.superpowers}
```

As of this writing that list is:

- `package.json` (package `name`, `bin` key, `description`)
- `index.html` (page title)
- `README.md`
- `AGENTS.md`
- `bun.lock` (root workspace package name)
- `create-cli/create.ts` (the `TOKEN_FILES` list itself, the git user name placeholder, and the
  `description` string it writes into scaffolded apps)
- `create-cli/README.md`
- `create-cli/readme.template.md` (the "scaffolded from the mantine-kit template" line -- this one
  names the template itself, not the scaffolded app, so it belongs to this find-replace pass, not
  `create.ts`'s `TOKEN_FILES` list)
- `src/app/landing/branding.ts` (the site header/footer name)
- `src/app/landing/HeroSection.tsx` (the "publishing to npm" forward-looking note)
- `src/app/docs/pages/GettingStartedPage.tsx` (the "publishing to npm" forward-looking note)
- `src/app/docs/pages/ScaffoldingPage.tsx` (the "publishing to npm" forward-looking note)
- `src/ui/core/copy-button/CopyButton.stories.tsx` (demo copy-button value)
- `src/ui/utils/smoke.test.ts` (smoke-test identity-function input)

Replace every occurrence of `mantine-kit` with `<name>`, and every occurrence of
`create-mantine-kit` with `create-<name>` (do the longer string first, or a single pass with
`mantine-kit` -> `<name>` naturally turns `create-mantine-kit` into `create-<name>` too, since
`mantine-kit` is a substring of it).

Also update:

- `create-cli/create.ts`'s `TOKEN_FILES` array and comment stay correct as long as the file list
  above didn't change; if you've added new template files that embed the name since this doc was
  last updated, add them to `TOKEN_FILES` too (see AGENTS.md §9).
- The `pkg.description` line `create.ts` writes into every scaffolded app (currently
  `` `${appName}, scaffolded with create-mantine-kit.` ``) -- update the hardcoded
  `create-mantine-kit` piece to `create-<name>`.
- The git scaffold-commit identity `create-mantine-kit` used as a placeholder `user.name` in
  `create.ts`.

## 3. Flip `private`

In `package.json`, remove the `"private": true` line entirely (or set it to `false` -- removing it
is preferred so it doesn't need to be flipped back for a future version bump).

## 4. Sanity-check before publishing

**Git history**: this working repo's commit messages reference the design's
source project in places the `debrand` gate cannot reach (it checks files,
not history). When creating the public repository, do not push this history:
start it from a squashed initial commit (`git checkout --orphan public &&
git add -A && git commit`) so the published history is exactly one clean
commit. Scaffolded apps are unaffected (the create CLI always git-inits
fresh).

From the repo root:

```bash
bun run typecheck
bun run lint
bun run test -- --run
bun run build
bun run debrand
npm pack --dry-run
```

Inspect the `npm pack --dry-run` file list against the `files` whitelist in `package.json`: `src`,
`create-cli` (including `gitignore.template` and `readme.template.md`), `index.html`, `public`, `vite.config.ts`,
`tsconfig*.json`, `eslint.config.js`, `eslint-local`, `vitest.setup.ts`, `.prettierrc`,
`.prettierignore`, `.storybook`, `scripts`,
`bun.lock`, `AGENTS.md`, `CLAUDE.md`, `.github`. Confirm no `dist`, `node_modules`,
`storybook-static`, `.superpowers`, logs, or `.env*` files are present, and that `.gitignore` is
_not_ in the list (npm never packs it regardless of the whitelist -- that's why
`create-cli/gitignore.template` exists and `create.ts` writes `.gitignore` from it post-scaffold).

**Known scaffold delta**: if `npm pack --dry-run` shows that `.github` and/or `.storybook` were
silently dropped by npm despite being listed in `files` (some npm versions treat dot-directories
specially), `create.ts` still works correctly for everything else -- the copy-from-checkout path
(running `bun create-cli/create.ts` from a git clone of this repo, as opposed to `bunx
create-<name>` against the published tarball) is unaffected, since it copies the real working
directory rather than an npm-packed tarball. Document any such gap here if you hit it, and treat a
missing CI workflow or Storybook config in the _published-package_ scaffold path as an acceptable,
called-out limitation rather than a bug to silently work around.

## 5. Publish

```bash
npm publish
# or: bun publish
```

## 6. Post-publish cleanup

- Update the landing page hero command chip (`src/app/landing/HeroSection.tsx`,
  `SCAFFOLD_COMMAND`) and the docs' Getting started and Scaffolding pages
  (`src/app/docs/pages/GettingStartedPage.tsx`, `src/app/docs/pages/ScaffoldingPage.tsx`) to show
  `bunx create-<name> my-app` as the primary command instead of the checkout-only
  `bun create-cli/create.ts my-app` form. All already carry a small muted note pointing at this
  doc -- remove it once the real command is live, or leave it as a permanent pointer back to this
  runbook, your call.
- Update `README.md` and `create-cli/README.md`'s usage sections the same way.
- Bump `version` for subsequent releases as normal.

## 7. Sanity `bunx` smoke test

```bash
bunx create-<name> smoke-test
cd smoke-test
bun install
bun run typecheck
bun run build
bun run test -- --run
bash scripts/debrand-check.sh
cd ..
rm -rf smoke-test
```

Confirm: `smoke-test/package.json` has `"name": "smoke-test"` (not `create-smoke-test`),
`"private": true`, no `bin`/`files` fields, and a `.gitignore` is present with the expected content.
