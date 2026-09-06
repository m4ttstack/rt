#!/usr/bin/env bash
# Serves design/wiring/render over http and prints the URLs to screenshot.
# It cannot drive the browser itself -- capture runs through the agent's
# browser tools -- so this half is the part that has to be reproducible:
# the port, the page list, and the destination.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${PORT:-8901}
RENDER="$HERE/render"

# `file:` is refused by the browser, so the pages must come over http.
[ -d "$RENDER" ] || { echo "no render/ -- run build-references.mjs first" >&2; exit 1; }

python3 -m http.server "$PORT" --directory "$RENDER" >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  curl -fsS -m 1 "localhost:$PORT/Main.light.html" >/dev/null 2>&1 && break
  sleep 0.25
done

echo "serving on :$PORT — capture each at 1440 wide, fullPage, scale=css:"
for f in "$RENDER"/*.html; do
  echo "  http://localhost:$PORT/$(basename "$f")"
done
cat <<EOF

Screenshots can only be written under ~/.fast-browser or the repo-tools
checkout, so shoot to ~/.fast-browser/wiring-ref/<Name>.<scheme>.png, then:

  cp ~/.fast-browser/wiring-ref/*.png $HERE/reference/
  node $HERE/normalize-captures.mjs $HERE/reference

The normalize step is not optional. Chromium tags screenshots with its own
display profile and the raw pixels are in THAT space, so a panel authored as
#eff0f5 samples as #edeef3 -- a flat offset that makes any pixel comparison
against the artboards or against tokyo-theme.css read as a code defect.

Press ctrl-c when the captures are done.
EOF
wait "$server"
