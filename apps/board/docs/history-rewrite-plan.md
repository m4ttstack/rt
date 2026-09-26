# History rewrite plan

Status: **not run.** This document is the procedure, written while the tip of
`main` was being cleaned. Nothing in it has been executed against any repo,
local or remote.

## Why

The working tree is clean as of the fixture-scrub branch: `scripts/repo-purity.sh`
passes, the capture fixture is invented, and all twenty baseline PNGs were
re-shot from it. History is not clean. Every one of those files is still one
`git show` away, and GitHub serves any commit in a public repo by SHA.

What history still carries, measured on this repo (400 commits, 2986 objects):

| Class | Extent |
| :--- | :--- |
| Fixture snapshot of a real board | `tests/fixture/data.json`, `discussions.json`, `review-report.md`: 1 employer-bearing blob version each |
| Rendered baselines | 20 PNGs under `tests/baselines/`, 6 to 8 blob versions each, showing the same real names |
| Employer terms in source, tests and docs | 32 tracked text paths, 199 blob versions |
| Employer terms in commit messages | 9 commits across all refs |
| Private planning docs | 2 files under `.local-dev/`, committed before that directory was ignored |

Two of the real usernames in the old fixture contain the employer's name, so
this is not only a "names of teammates" problem: the employer is identifiable
from the fixture alone, and from the PNGs by reading them.

## Preconditions

- `git filter-repo` on PATH (`brew install git-filter-repo`).
- Nobody else pushing. Announce the freeze first; a rewrite races any push.
- Every collaborator and every worktree re-clones afterward. A rebase onto
  rewritten history is not a fix, it reintroduces the old commits.
- Decide up front whether the tags stay. The three existing tags are release
  tags and the `release` workflow built artifacts from them. Rewriting changes
  their SHAs; the GitHub Releases attached to the old tags keep pointing at
  objects that the rewrite orphans but does not delete.

## Step 0: mirror backup, before anything else

```sh
mkdir -p ~/board-rewrite && cd ~/board-rewrite
git clone --mirror https://github.com/m4ttstack/board.git board-backup.git
tar czf board-backup-$(date +%Y%m%d).tar.gz board-backup.git
```

Keep the tarball off the machine that will run the rewrite if you can. It is
the only route back if the rewrite drops a ref nobody noticed still mattered:
it holds every branch, every tag, and every note.

## Step 1: build the term files

The three input files name the banned words, so they are **generated into a
scratch directory and never committed**. The fragments below are the same ten
`scripts/repo-purity.sh` uses; if you extend that script, extend this too.

```sh
cd ~/board-rewrite && mkdir -p in

A1=$(printf '%s%s' 'ass' 'ured')      # employer name
A2=$(printf '%s%s' 'claim' 'view')    # internal product name
A3=$(printf '%s%s' 'CV' '-')          # ticket prefix, both cases
A4=$(printf '%s%s' 'pgr' '-qa')
A5=$(printf '%s%s' 'am' 'fam')
A6=$(printf '%s%s' 'adjus' 'ter')
A7=$(printf '%s%s' 'hog' 'warts')
A8=$(printf '%s%s' 'CV' 'I')          # internal initialism
A9=$(printf '%s%s' 'progres' 'sive')

# Blob content. filter-repo applies these in order, to every blob it keeps.
{
  printf 'regex:(?i)%s(?=\\d)==>ACME-\n' "$A3"
  printf 'regex:(?i)%s==>ACME\n'         "$A8"
  for t in "$A1" "$A2" "$A4" "$A5" "$A6" "$A7" "$A9"; do
    printf 'regex:(?i)%s==>acme\n' "$t"
  done
} > in/replace-text.txt

# Commit messages. Same format, same order, applied to the message text.
cp in/replace-text.txt in/replace-message.txt
```

Two notes on the rules:

- The ticket-prefix rule uses a lookahead so it only fires on a real ticket id
  and needs no backreference in the replacement.
- The initialism rule runs before the word rules because it is a substring of
  none of them but shares two letters with the ticket prefix; keeping it early
  makes the ordering obvious to the next reader rather than incidental.

Lockfiles were checked: no `bun.lock` blob in this repo's history matches any
term, so content replacement cannot corrupt an integrity hash here.

## Step 2: the paths file

These paths come out of history entirely. Content replacement cannot help
them: the JSON is a verbatim snapshot and the PNGs are pictures of it.

```sh
cat > in/paths.txt <<'EOF'
tests/fixture/data.json
tests/fixture/discussions.json
tests/fixture/review-report.md
tests/fixture/README.md
tests/baselines/
.local-dev/
EOF
```

- `tests/fixture/README.md` is on the list because its old text advertised the
  fixture as a real private-repo snapshot.
- `tests/fixture/config.json` and `meta.json` stay: both were always invented.
- `tests/baselines/` and `.local-dev/` are directory prefixes, so every file
  ever under them goes, including ones deleted long ago.

Nine screenshots were committed at the repo root during the peer-boards work
and later deleted: `01-modal-operator-dark.png` through `09-modal-narrow.png`.
Three of the nine were opened and inspected while writing this plan. They show
a demo roster (invented names, a `demo-` author handle) rather than a real
team, so they are **not** on the purge list above. Two things to decide before
the run: the other six were not opened, and `03-copy-feedback.png` shows a
localhost invite token which is long expired but is still a credential in a
picture. If either bothers you, add this line and they are gone:

```sh
printf 'glob:0*.png\n' >> in/paths.txt
```

## Step 3: dry run on a scratch clone

Never rehearse in a checkout you care about. filter-repo rewrites in place and
deletes the origin remote on purpose.

```sh
cd ~/board-rewrite
rm -rf dry && git clone --no-local board-backup.git dry
cd dry

git filter-repo \
  --paths-from-file ../in/paths.txt --invert-paths \
  --replace-text ../in/replace-text.txt \
  --replace-message ../in/replace-message.txt
```

Then verify the dry result, in this order. The checks reuse the `A1`..`A9`
variables from step 1, so re-run those assignments if this is a new shell.

```sh
# 1. Nothing tracked at the tip matches. Uses the branch's own gate.
git checkout -q main && ./scripts/repo-purity.sh

# 2. Nothing in ANY blob of ANY ref matches. Slow (a few minutes).
PATTERN="$A1|$A2|$A3[0-9]|$A4|$A5|$A6|$A7|$A8|$A9"
git rev-list --all --objects | awk 'NF>1' | while read -r sha path; do
  case "$path" in *bun.lock|*package-lock.json) continue ;; esac
  git cat-file -p "$sha" 2>/dev/null | grep -IqiE "$PATTERN" && echo "HIT $path $sha"
done; echo "blob sweep done"

# 3. No commit message matches.
git log --all -iE --grep="$PATTERN" --oneline | wc -l   # expect 0

# 4. The purged paths are gone from every ref.
git log --all --oneline -- tests/baselines tests/fixture/data.json | wc -l  # expect 0

# 5. Nothing else was lost: commit count and the shape of main.
git rev-list --all | wc -l
git log --oneline -15
```

Expect the commit count to be lower than 400 only if a commit's entire content
was purged... filter-repo prunes commits that become empty. Read the list it
prints and make sure every pruned commit is one whose only content was fixture
or baseline files.

## Step 4: the real run

Same commands, on a fresh clone of the backup mirror rather than the dry one.

```sh
cd ~/board-rewrite
rm -rf work && git clone --no-local board-backup.git work
cd work

git filter-repo \
  --paths-from-file ../in/paths.txt --invert-paths \
  --replace-text ../in/replace-text.txt \
  --replace-message ../in/replace-message.txt
```

## Step 5: put the synthetic fixture back

The path purge takes the new invented files with the old real ones, because
`--invert-paths` works on paths and not on content. Restore them from the
cleaned branch as one fresh commit:

```sh
# From a checkout that still has the post-scrub files (this branch, merged).
SRC=~/Documents/GitHub/board/.worktrees/fixture-scrub
cd ~/board-rewrite/work && git checkout -q main
mkdir -p tests/fixture tests/baselines
cp "$SRC"/tests/fixture/{data.json,discussions.json,review-report.md,README.md} tests/fixture/
cp "$SRC"/tests/baselines/*.png tests/baselines/
git add tests/fixture tests/baselines
git commit -m "restore the synthetic capture fixture and its baselines"

./scripts/repo-purity.sh
bun install && bun test
bun run capture && bun run capture:compare   # 20/20, zero pixels
```

An alternative that skips this step: `--strip-blobs-with-ids` takes a file of
blob SHAs and removes only those, so the new fixture survives the rewrite
untouched. It is more precise and less legible... you have to produce and
review a list of ~150 opaque SHAs. Path purging plus one restore commit is the
version a reviewer can check.

## Step 6: push

```sh
cd ~/board-rewrite/work
git remote add origin https://github.com/m4ttstack/board.git
git push --force --all
git push --force --tags
```

Then, on the local machines: delete every stale clone and worktree and clone
fresh. This repo currently has 15 local branches and several remote branches
beyond `main`; decide which of those still matter before the push, because the
force push rewrites the ones you push and leaves the rest pointing at history
that no longer exists.

## What the force push does not do

**It does not delete the old commits from GitHub.** A force push moves refs.
The old objects stay in GitHub's copy of the repository and remain fetchable by
SHA, so anyone who saw a commit id (a link in a PR, a CI log, an old clone, a
crawler) can still read the old fixture and the old baselines from it.

Making that stop requires all of:

1. Force-push the rewritten refs (this step).
2. Delete every pull request that referenced the old commits, or accept that
   `refs/pull/*` keeps them alive... those refs are not rewritten by a push.
3. Delete every fork. A fork keeps the objects in the shared network, and
   GitHub will not purge while one holds them.
4. Open a GitHub Support ticket asking them to garbage collect the
   unreachable objects, naming the repository. Until Support runs that, the
   orphans stay.

The repository being private right now is what actually contains the exposure;
treat "public again" as gated on step 4 coming back done, not on the rewrite
finishing.

Also worth knowing: existing GitHub Releases keep their attached binaries and
keep pointing at the pre-rewrite tag objects, and any archive URL
(`/archive/<sha>.tar.gz`) that was fetched before is cached downstream. The
rewrite cannot reach either.

## If it goes wrong

```sh
cd ~/board-rewrite/board-backup.git
git push --force --mirror https://github.com/m4ttstack/board.git
```

That restores every ref to its pre-rewrite state from the mirror. It does not
un-expose anything, it just gets the repository back to a known state so the
run can be repeated properly.
