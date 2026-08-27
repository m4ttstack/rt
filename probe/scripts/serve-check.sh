#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=11132 bun src/server/index.ts &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -fsS -m 1 127.0.0.1:11132/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS -m 5 127.0.0.1:11132/api/health | grep -q '"name":"probe"'
test "$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:11132/)" = 200
test "$(curl -s -o /dev/null -w '%{content_type}' 127.0.0.1:11132/)" = "text/html; charset=utf-8"
asset=$(curl -s 127.0.0.1:11132/ | grep -oE '/assets/[^"]+\.js' | head -1)
test -n "$asset"
test "$(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:11132$asset")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:11132/api/does-not-exist)" = 404
test "$(curl -s -o /dev/null -w '%{content_type}' 127.0.0.1:11132/api/does-not-exist)" = "application/json"
test "$(curl -s 127.0.0.1:11132/api/daemon | grep -c reachable)" = 1
echo "serve-check passed"
