#!/bin/sh
# repo-purity.sh -- the whole tracked tree greps clean of employer/domain terms.
#
# board is a public, general-purpose merge-request dashboard. Nothing about any
# particular employer, customer, or internal system belongs in it -- not in
# code, not in fixtures, not in docs, not in plans. This sweeps everything git
# tracks, so program artifacts and design documents are held to the same line
# as source.
#
# The bar exists because it was crossed: tests/fixture/data.json was a verbatim
# snapshot of a real private board, carrying real teammate names and usernames
# (two of them with the employer's name inside the username), real ticket ids,
# real project paths and real chat permalinks -- and the twenty PNGs in
# tests/baselines/ rendered every one of them. A word list cannot certify what
# it was never told to look for, so add to it whenever a new term shows up
# rather than assuming this list is complete.
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

PATTERN="$A1|$A2|$A3|$A4|$A5|$A6|$A7|$A8|$A9|$A10"

# Lockfiles are excluded: their base64 integrity hashes collide with the short
# patterns often enough to be pure noise, and nothing is authored in them.
# grep -I skips binaries, which is what keeps tests/baselines/*.png from
# reporting a match on a coincidental byte run.
HITS=$(cd "$ROOT" \
  && git ls-files -z \
  | grep -zvE '(bun\.lock|package-lock\.json)$' \
  | xargs -0 grep -IniE "$PATTERN" 2>/dev/null \
  | grep -v '^scripts/repo-purity.sh:' || true)
if [ -n "$HITS" ]; then
  echo "FAIL repo-purity:"
  printf '%s\n' "$HITS"
  echo ""
  echo "board is public. Use neutral placeholders (acme, ACME-1234, gitlab.example.com)."
  echo "Fixture data must be invented, never copied from a real board."
  exit 1
fi
echo "ok   repo-purity"
