#!/bin/sh
# Build, certify, and publish a GitHub release. Usage: scripts/release.sh v1.0.0
set -eu
TAG="${1:?usage: release.sh vX.Y.Z}"
REPO="m4ttheweric/deck"

PKG_VERSION="$(bun -e 'console.log(require("./package.json").version)')"
TAG_VERSION="${TAG#v}"
if [ "${TAG_VERSION}" != "${PKG_VERSION}" ]; then
  echo "FAIL: tag ${TAG} does not match package.json version ${PKG_VERSION}" >&2
  exit 1
fi

./scripts/certify.sh

bun build --compile --target=bun-darwin-arm64 src/main.ts --outfile dist/deck-darwin-arm64
bun build --compile --target=bun-darwin-x64  src/main.ts --outfile dist/deck-darwin-x64

# The installer ships as a release asset too, pinned to this repo (updater-drift
# rule: installer and updater read the same releases).
sed "s|@@REPO@@|${REPO}|g" scripts/install.sh > dist/install.sh

gh release create "${TAG}" \
  dist/deck-darwin-arm64 dist/deck-darwin-x64 dist/install.sh \
  --repo "${REPO}" --title "Deck ${TAG}" --generate-notes
echo "released ${TAG}"
