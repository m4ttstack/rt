#!/bin/bash
# Sourced by assert-installed.sh and trigger-update.sh, which define ok/bad and LOGS.
# The expected set is deps.lock's serve rows, never a list kept here.
SERVED_JQ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/jq"
: "${SERVED_APP:=/Applications/mattstack.app}"
: "${SERVED_CURL:=curl}"
: "${SERVED_LAUNCHCTL:=launchctl}"
: "${SERVED_POLL_S:=5}"
SERVED_JQ="$SERVED_APP/Contents/Helpers/jq"

served_deck_port() {
  local p
  p=$("$SERVED_JQ" -r '.port // empty' "$HOME/.mattstack/deck/api.json" 2>/dev/null)
  [ -n "$p" ] || p=$("$SERVED_JQ" -r '.apps.deck.port // empty' "$HOME/.mattstack/deck/registry.json" 2>/dev/null)
  printf '%s' "$p"
}

served_snapshot() {  # <dir>: status.json, routes.json and launchd.json for one verdict pass
  local dir="$1" port n
  port=$(served_deck_port)
  if [ -n "$port" ] && "$SERVED_CURL" -sf --max-time 10 "http://127.0.0.1:$port/api/v1/status" > "$dir/status.raw" 2>/dev/null \
     && "$SERVED_JQ" -e 'type == "object"' "$dir/status.raw" >/dev/null 2>&1; then
    cp "$dir/status.raw" "$dir/status.json"
  else
    echo null > "$dir/status.json"
  fi
  if ! "$SERVED_JQ" -e 'type == "array"' "$HOME/.portless/routes.json" > /dev/null 2>&1; then
    echo null > "$dir/routes.json"
  else
    cp "$HOME/.portless/routes.json" "$dir/routes.json"
  fi
  for n in $("$SERVED_JQ" -r '.apps[].name, .tools[]' "$dir/catalog.json"); do
    "$SERVED_LAUNCHCTL" print "gui/$(id -u)/com.mattstack.deck.$n" > "$dir/launchctl-$n.txt" 2>&1
    "$SERVED_JQ" -R -s -c -f "$SERVED_JQ_DIR/launchctl-print.jq" < "$dir/launchctl-$n.txt" \
      | "$SERVED_JQ" -c --arg n "$n" '{($n): .}'
  done | "$SERVED_JQ" -s 'add // {}' > "$dir/launchd.json"
}

assert_served_apps() {  # <log-name> <timeout-s>
  local dir="$LOGS/$1" deadline=$((SECONDS + $2)) lock="$SERVED_APP/Contents/Resources/deps.lock" verdict kind msg
  mkdir -p "$dir"
  if ! "$SERVED_JQ" -c -f "$SERVED_JQ_DIR/catalog.jq" "$lock" > "$dir/catalog.json" 2> "$dir/catalog.stderr"; then
    bad "cannot read the served-app catalog from $lock: $(head -c 200 "$dir/catalog.stderr")"
    return
  fi
  while :; do
    served_snapshot "$dir"
    verdict=$("$SERVED_JQ" -r -n \
      --slurpfile catalog "$dir/catalog.json" --slurpfile status "$dir/status.json" \
      --slurpfile launchd "$dir/launchd.json" --slurpfile routes "$dir/routes.json" \
      --arg helpers "$SERVED_APP/Contents/Helpers" --arg home "$HOME" \
      -f "$SERVED_JQ_DIR/served-verdict.jq" 2> "$dir/verdict.stderr") \
      || verdict="bad"$'\t'"served-verdict.jq failed: $(tr "\n" " " < "$dir/verdict.stderr" | head -c 200)"
    grep -q '^bad' <<< "$verdict" || break
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$SERVED_POLL_S"
  done
  while IFS=$'\t' read -r kind msg; do
    case "$kind" in
      ok)  ok "$msg";;
      bad) bad "$msg";;
      *)   bad "served-verdict.jq printed an unexpected line: $kind $msg";;
    esac
  done <<< "$verdict"
}

assert_mattstack_routes() {  # <trusted|untrusted> <log-name>
  local mode="$1" hosts h
  cp "$HOME/.portless/routes.json" "$LOGS/$2-routes.json" 2>/dev/null
  hosts=$("$SERVED_JQ" -r '.[].hostname | select(endswith(".mattstack"))' "$HOME/.portless/routes.json" 2>/dev/null)
  if [ -z "$hosts" ]; then
    bad "no .mattstack route in ~/.portless/routes.json for the proxy to serve"
    return
  fi
  for h in $hosts; do
    if [ "$mode" = untrusted ]; then
      # Serving and being trusted are separate claims: curl without --insecure
      # uses the same trust store a browser does.
      "$SERVED_CURL" -fsS --insecure --max-time 10 "https://$h" >/dev/null 2>&1 \
        && ok "$h answers over https through the untrusted proxy" \
        || bad "$h is routed but does not answer through the proxy"
      "$SERVED_CURL" -fsS --max-time 10 "https://$h" >/dev/null 2>&1 \
        && bad "$h verified against the system trust store, so the certificate was not declined" \
        || ok "$h is not trusted yet, as the declined scenario expects"
    else
      "$SERVED_CURL" -fsS --max-time 10 "https://$h" >/dev/null 2>&1 \
        && ok "$h answers over https through the proxy" \
        || bad "$h is routed but does not answer through the proxy"
    fi
  done
}
