#!/bin/sh
# repo-purity.sh -- the whole tracked tree greps clean of employer/domain terms.
#
# mattstack-apps is public. Nothing about any particular employer, customer,
# or internal system belongs anywhere in it -- not in code, not in fixtures,
# not in docs, not in plans. This sweeps everything git tracks, root to leaf,
# so program artifacts and design documents are held to the same line as
# source.
#
# The bar exists because it was crossed twice. tests/fixture/data.json in
# board was a verbatim snapshot of a real board, carrying real teammate names
# and usernames (two of them with the employer's name inside the username),
# real ticket ids, real project paths and real chat permalinks, with the
# twenty PNGs in tests/baselines/ rendering every one of them. Separately,
# a sibling repo (rt) was public for six months carrying an internal GitLab
# host, real ticket ids and titles, internal repo names, and two named
# customers wired to database resource names in test fixtures. A word list
# cannot certify what it was never told to look for, so add to it whenever a
# new term shows up rather than assuming this list is complete.
#
# This used to be two copies, one under apps/board/scripts and one under
# apps/console/scripts, each scanning only its own app. That left
# apps/boxscore, apps/chat, apps/deck and packages/* unscanned by either
# copy, and the two lists had already drifted (board carried a tenth term
# console lacked, and their binary-file exclusions differed). One gate at
# the root, one word list, whole tree.
#
# Run bare from anywhere: scripts/repo-purity.sh. Exit 0 = clean.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)

# Assembled from fragments so this file greps clean for its own banned words
# (the same technique rt's and the skills repo's copies use).
A1=$(printf '%s%s' 'ass' 'ured')
A2=$(printf '%s%s' 'claim' 'view')
A3=$(printf '%s%s' 'cv-' '[0-9]')
A4=$(printf '%s%s' 'CV-' '[0-9]')
A5=$(printf '%s%s' 'pgr' '-qa')
A6=$(printf '%s%s' 'am' 'fam')
A7=$(printf '%s%s' 'adjus' 'ter')
A8=$(printf '%s%s' 'hog' 'warts')
A9=$(printf '%s%s' 'CV' 'I')
A10=$(printf '%s%s' 'progres' 'sive')

# A10 is also a plain English word ("progressively"), so it alone gets word
# boundaries: (^|non-word)term(non-word|$). A POSIX bracket-expression
# boundary rather than \b, since \b is a GNU extension grep -E does not
# portably support and this must behave the same under macOS grep (local)
# and GNU grep (CI, ubuntu).
A10B="(^|[^[:alnum:]])$A10([^[:alnum:]]|\$)"

PATTERN="$A1|$A2|$A3|$A4|$A5|$A6|$A7|$A8|$A9|$A10B"

# Lockfiles are excluded: their base64 integrity hashes collide with the short
# patterns often enough to be pure noise, and nothing is authored in them.
# PNGs are excluded too: raw compressed bytes collide with the same short
# patterns, and nothing is authored in them either. grep -I skips other
# binaries, which is what keeps things like tests/baselines/*.png (had they
# not already been PNG-excluded) from reporting a match on a coincidental
# byte run.
HITS=$(cd "$ROOT" \
  && git ls-files -z \
  | grep -zvE '(bun\.lock|package-lock\.json|\.png)$' \
  | xargs -0 grep -IniE "$PATTERN" 2>/dev/null \
  | grep -v '^scripts/repo-purity.sh:' || true)
if [ -n "$HITS" ]; then
  echo "FAIL repo-purity:"
  printf '%s\n' "$HITS"
  echo ""
  echo "mattstack-apps is public. Use neutral placeholders (acme, ACME-1234, gitlab.example.com)."
  echo "Fixture data must be invented, never copied from a real board or console."
  exit 1
fi
echo "ok   repo-purity"
