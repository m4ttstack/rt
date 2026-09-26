#!/usr/bin/env bash
# Serves the built client and proves /api is not swallowed by the SPA
# fallback: an unmatched /api route must stay a JSON 404, since an RPC
# client checks res.ok and would otherwise throw parsing HTML.
set -euo pipefail

app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
port=${GATE_PORT:-$(bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop();')}
base="http://127.0.0.1:$port"

say() { echo "serve-check: $*" >&2; }

[ -d "$app_dir/dist" ] || { say "$app_dir/dist is missing; run bun run build first"; exit 1; }
if curl -s -m 1 -o /dev/null "$base/"; then
  say "GATE_PORT=$port already answers; choose a free port"
  exit 1
fi

work=$(mktemp -d)
mkdir -p "$work/home"
server=""
cleanup() {
  if [ -n "$server" ]; then
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  say "$*"
  if [ -f "$work/server.log" ]; then sed 's/^/  server: /' "$work/server.log" >&2; fi
  exit 1
}

# env -i: the server reads and writes the settings store under HOME.
(cd "$app_dir" && exec env -i HOME="$work/home" PATH="$PATH" PORT="$port" bun src/server/index.ts) > "$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 30); do
  curl -fsS -m 1 -o /dev/null "$base/api/health" 2>/dev/null && break
  kill -0 "$server" 2>/dev/null || fail "server exited before answering /api/health"
  sleep 1
done
curl -fsS -m 5 -o /dev/null "$base/api/health" || fail "never answered /api/health"

code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$base$1"; }
ctype() { curl -s -m 5 -o /dev/null -w '%{content_type}' "$base$1"; }

[ "$(code /)" = 200 ] || fail "/ answered $(code /)"
[ "$(ctype /)" = "text/html; charset=utf-8" ] || fail "/ is $(ctype /), not the built index"
index=$(curl -fsS -m 5 "$base/") || fail "index.html did not load"
re_js='(/assets/[^"]+\.js)'
[[ $index =~ $re_js ]] || fail "index.html references no /assets/*.js"
[ "$(code "${BASH_REMATCH[1]}")" = 200 ] || fail "${BASH_REMATCH[1]} answered $(code "${BASH_REMATCH[1]}")"
[ "$(code /api/does-not-exist)" = 404 ] || fail "/api/does-not-exist was swallowed by the SPA fallback"
[ "$(ctype /api/does-not-exist)" = "application/json" ] || fail "the /api 404 is $(ctype /api/does-not-exist), not JSON"

say "chat serves the built client and keeps /api out of the SPA fallback"
