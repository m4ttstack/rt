#!/usr/bin/env bash
# Serves the compiled boxscore the way deck runs it in prod: from
# $HOME/.mattstack/boxscore under a fresh HOME, with no source tree to fall
# back on, and with a hostile .env and bunfig.toml in that working directory.
# bundle-apps and check-bundle only run --version, which exits before any
# boxscore code loads, so this is the one proof the binary serves and opens
# its SQLite store.
set -euo pipefail

app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin=${BINARY:-$app_dir/dist-bin/boxscore}
port=${GATE_PORT:-$(bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop();')}
base="http://127.0.0.1:$port"
hidden="$app_dir/dist-bin/dist-hidden"

say() { echo "binary-gate: $*" >&2; }

[ -x "$bin" ] || { say "$bin is missing; run bun run build:binary first"; exit 1; }
[ ! -e "$hidden" ] || { say "$hidden is left from an interrupted run; move it back to $app_dir/dist"; exit 1; }
if curl -s -m 1 -o /dev/null "$base/"; then
  say "GATE_PORT=$port already answers; choose a free port"
  exit 1
fi
expected=$(bun -p "require('$app_dir/package.json').version")

work=$(mktemp -d)
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

home="$work/home"
run_dir="$home/.mattstack/boxscore"
mkdir -p "$run_dir"
cp "$bin" "$run_dir/boxscore"
printf 'BOXSCORE_DB=%s\n' "$work/dotenv.sqlite" > "$run_dir/.env"
printf 'preload = ["./poison.ts"]\n' > "$run_dir/bunfig.toml"
printf 'require("node:fs").writeFileSync("%s", "ran");\n' "$work/preloaded" > "$run_dir/poison.ts"

if [ -d "$app_dir/dist" ]; then
  mkdir -p "$app_dir/dist-bin"
  mv "$app_dir/dist" "$hidden"
  moved=1
fi

version=$(cd "$run_dir" && env -i HOME="$home" ./boxscore --version) || fail "--version exited non-zero"
[ "$version" = "$expected" ] || fail "--version printed '$version', expected bare '$expected'"

(cd "$run_dir" && exec env -i HOME="$home" PORT="$port" ./boxscore) > "$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 30); do
  curl -fsS -m 1 -o /dev/null "$base/api/health" 2>/dev/null && break
  kill -0 "$server" 2>/dev/null || fail "binary exited before answering /api/health"
  sleep 1
done
health=$(curl -fsS -m 5 "$base/api/health") || fail "never answered /api/health"
[ "$health" = "{\"ok\":true,\"name\":\"boxscore\",\"version\":\"$expected\"}" ] || fail "/api/health said $health"

code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$base$1"; }
ctype() { curl -s -m 5 -o /dev/null -w '%{content_type}' "$base$1"; }
mediatype() {
  local full
  full=$(ctype "$1")
  echo "${full%%;*}"
}

[ "$(code /)" = 200 ] || fail "/ answered $(code /); the embedded index is missing"
[ "$(ctype /)" = "text/html; charset=utf-8" ] || fail "/ is $(ctype /), not the embedded index"
[ "$(code /favicon.svg)" = 200 ] || fail "/favicon.svg answered $(code /favicon.svg)"
[ "$(mediatype /favicon.svg)" = "image/svg+xml" ] || fail "/favicon.svg is $(ctype /favicon.svg)"

index=$(curl -fsS -m 5 "$base/")
icons=$(grep -oE 'href="/[^"?]+\.(ico|png|svg)' <<<"$index" | sed 's/^href="//') || fail "index.html links no icons"
for icon in $icons; do
  [ "$(code "$icon")" = 200 ] || fail "$icon answered $(code "$icon")"
  case "$(mediatype "$icon")" in
    image/*) ;;
    *) fail "$icon is $(ctype "$icon"), not an image" ;;
  esac
done
re_js='(/assets/[^"]+\.js)'
re_css='(/assets/[^"]+\.css)'
re_font='(/assets/[^)"]+\.woff2)'
[[ $index =~ $re_js ]] || fail "index.html references no /assets/*.js"
js=${BASH_REMATCH[1]}
[ "$(code "$js")" = 200 ] || fail "$js answered $(code "$js")"
[[ $index =~ $re_css ]] || fail "index.html references no /assets/*.css"
css=$(curl -fsS -m 5 "$base${BASH_REMATCH[1]}") || fail "the stylesheet did not load"
[[ $css =~ $re_font ]] || fail "the stylesheet references no /assets/*.woff2"
font=${BASH_REMATCH[1]}
[ "$(code "$font")" = 200 ] || fail "$font answered $(code "$font")"
[ "$(mediatype "$font")" = "font/woff2" ] || fail "$font is $(ctype "$font"), not font/woff2"

[ "$(code /api/does-not-exist)" = 404 ] || fail "/api/does-not-exist was swallowed by the SPA fallback"
[ "$(mediatype /api/does-not-exist)" = "application/json" ] || fail "the /api 404 is $(ctype /api/does-not-exist), not JSON"

stats=$(curl -fsS -m 10 "$base/api/cache/stats") || fail "/api/cache/stats failed; the store did not open"
[ "$stats" = '{"mrDetails":0,"mrList":0,"linearIds":{"valid":0,"invalid":0}}' ] || fail "/api/cache/stats said $stats"
if [ -e "$work/dotenv.sqlite" ] || [ -e "$work/preloaded" ]; then
  fail "a .env or bunfig.toml in the working directory was honored"
fi
[ -f "$run_dir/boxscore.sqlite" ] || fail "the store is not at \$HOME/.mattstack/boxscore/boxscore.sqlite"

say "boxscore $expected serves its embedded assets and opens its store"
