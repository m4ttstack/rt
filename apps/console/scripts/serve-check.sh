#!/usr/bin/env bash
# console ships a self-contained binary; the only honest test is to run it
# where dist/ is not: a binary built without the codegen step falls back to
# disk mode and 404s every page, which passes silently anywhere the source
# tree happens to sit next to it.
set -euo pipefail

app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin="$app_dir/dist-bin/console"
port=${GATE_PORT:-$(bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop();')}
base="http://127.0.0.1:$port"
hidden="$app_dir/dist-bin/dist-hidden"

say() { echo "serve-check: $*" >&2; }

[ -x "$bin" ] || { say "$bin is missing; run bun run build:binary first"; exit 1; }
[ ! -e "$hidden" ] || { say "$hidden is left from an interrupted run; move it back to $app_dir/dist"; exit 1; }
if curl -s -m 1 -o /dev/null "$base/"; then
  say "GATE_PORT=$port already answers; choose a free port"
  exit 1
fi

work=$(mktemp -d)
mkdir -p "$work/home"
moved=0
server=""
cleanup() {
  if [ -n "$server" ]; then
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
  fi
  if [ "$moved" = 1 ]; then mv "$hidden" "$app_dir/dist"; fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  say "$*"
  if [ -f "$work/server.log" ]; then sed 's/^/  server: /' "$work/server.log" >&2; fi
  exit 1
}

cp "$bin" "$work/console"
if [ -d "$app_dir/dist" ]; then
  mv "$app_dir/dist" "$hidden"
  moved=1
fi

# env -i: on boot the binary writes rt.notify.eventBridges to the user
# settings store under HOME.
(cd "$work" && exec env -i HOME="$work/home" PATH="$PATH" PORT="$port" ./console) > "$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 30); do
  curl -fsS -m 1 -o /dev/null "$base/api/health" 2>/dev/null && break
  kill -0 "$server" 2>/dev/null || fail "binary exited before answering /api/health"
  sleep 1
done
curl -fsS -m 5 -o /dev/null "$base/api/health" || fail "never answered /api/health"

code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$base$1"; }
ctype() { curl -s -m 5 -o /dev/null -w '%{content_type}' "$base$1"; }

[ "$(code /)" = 200 ] || fail "/ answered $(code /); the embedded index is missing"
[ "$(code /search)" = 200 ] || fail "/search answered $(code /search)"
index=$(curl -fsS -m 5 "$base/") || fail "index.html did not load"
re_js='(/assets/[^"]+\.js)'
re_css='(/assets/[^"]+\.css)'
re_font='(/assets/[^)"]+\.woff2)'
[[ $index =~ $re_js ]] || fail "index.html references no /assets/*.js"
[ "$(code "${BASH_REMATCH[1]}")" = 200 ] || fail "${BASH_REMATCH[1]} answered $(code "${BASH_REMATCH[1]}")"
[[ $index =~ $re_css ]] || fail "index.html references no /assets/*.css"
css=$(curl -fsS -m 5 "$base${BASH_REMATCH[1]}") || fail "the stylesheet did not load"
# The font ships inside @mattstack/mantine-tokyo, so Vite emits it as a
# content-hashed /assets/ URL; assert the content type, not just the status,
# because a catch-all can answer any path with 200.
[[ $css =~ $re_font ]] || fail "the stylesheet references no /assets/*.woff2"
font=${BASH_REMATCH[1]}
[ "$(code "$font")" = 200 ] || fail "$font answered $(code "$font")"
[ "$(ctype "$font")" = "font/woff2" ] || fail "$font is $(ctype "$font"), not font/woff2"

say "console's binary serves its own assets with no source tree"
