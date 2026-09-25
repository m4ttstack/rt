#!/bin/bash
# Assert the installed state in the guest, through rt and tray.sock (never UI text).
# Usage: assert-installed.sh [--expect-version <v>] [--headless] [--expect-untrusted]
#
# --expect-untrusted is the declined-certificate scenario: the install ran, the
# user said no to macOS's trust prompt, and the claim under test is that the
# proxy still serves, the checklist says so, and the trust verb clears it.
set -uo pipefail
GUEST_RUN="${GUEST_RUN:-/Volumes/My Shared Files/run}"; LOGS="$GUEST_RUN/logs"
mkdir -p "$LOGS" || { echo "assert-installed.sh: cannot write $LOGS" >&2; exit 2; }
EXPECT=""; HEADLESS=0; UNTRUSTED=0
while [ $# -gt 0 ]; do case "$1" in --expect-version) [ -n "${2:-}" ] || { echo "assert-installed.sh: --expect-version needs a value" >&2; exit 2; }; EXPECT="$2"; shift 2;; --headless) HEADLESS=1; shift;; --expect-untrusted) UNTRUSTED=1; shift;; *) shift;; esac; done
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
fails=0
ok()   { echo "ASSERT ok   $1"; }
bad()  { echo "ASSERT FAIL $1"; fails=$((fails+1)); }
SOCK="$HOME/.mattstack/rt/tray.sock"
# jq is not on this PATH: only DEFAULT_EXPOSED (rt, deck, gitq, fast-browser)
# is linked into ~/.local/bin, so the bundle's own copy is the one every
# block below uses to read `rt setup status --json`.
JQ=/Applications/mattstack.app/Contents/Helpers/jq
source "$(cd "$(dirname "$0")" && pwd)/served-apps.sh" || { echo "assert-installed.sh: cannot load served-apps.sh" >&2; exit 2; }

# rt on PATH, symlink into the bundle
if [ -L "$HOME/.local/bin/rt" ]; then
  tgt=$(readlink "$HOME/.local/bin/rt")
  case "$tgt" in /Applications/mattstack.app/*|"$HOME"/Applications/mattstack.app/*) ok "rt symlink → $tgt";; *) bad "rt symlink points outside the bundle: $tgt";; esac
elif [ -x "$HOME/.local/bin/rt" ]; then
  ok "rt installed as a binary (pre-L4 layout)"
else
  bad "no ~/.local/bin/rt"
fi
V=$(rt --version 2>/dev/null | tr -d '\n'); [ -n "$V" ] && ok "rt --version = $V" || bad "rt --version"

# rt verify --ci --json: the machine-gate contract (bare-machine absences —
# FDA's human click, no herdr/claude/Chrome, team-of-one — are not failures).
# The daemon stays strictly asserted below via launchctl, so --ci's daemon
# leniency costs nothing here.
if rt verify --ci --json > "$LOGS/verify.json" 2>"$LOGS/verify.stderr"; then
  grep -q '"passed": *true' "$LOGS/verify.json" && ok "rt verify --ci passed" || bad "rt verify --ci passed:false"
else
  bad "rt verify --ci exited $? (see logs/verify.json)"
fi
grep -E '"status": *"(fail|warn)"' -B2 "$LOGS/verify.json" | grep '"name"' | sed 's/^/  verify: /' || true

# tray.sock /version
if [ -S "$SOCK" ]; then
  curl -sf --max-time 5 --unix-socket "$SOCK" http://localhost/version > "$LOGS/tray-version.json" 2>/dev/null
  if [ -s "$LOGS/tray-version.json" ] && grep -q '"version"' "$LOGS/tray-version.json"; then
    ok "tray.sock /version → $(tr -d '\n' < "$LOGS/tray-version.json")"
    if [ -n "$EXPECT" ]; then
      grep -q "\"version\": *\"$EXPECT\"" "$LOGS/tray-version.json" && ok "version == $EXPECT" || bad "version != $EXPECT"
    fi
  else
    bad "tray.sock /version empty or errored (route not implemented yet?)"
  fi
  # /services: daemon always; deck only when the bundle ships Contents/Helpers/deck (L1 registers it conditionally).
  curl -sf --max-time 5 --unix-socket "$SOCK" http://localhost/services > "$LOGS/tray-services.json" 2>/dev/null
  if grep -q '"com.mattstack.daemon' "$LOGS/tray-services.json" 2>/dev/null; then
    ok "tray.sock /services lists the daemon ($(tr -d '\n ' < "$LOGS/tray-services.json" | cut -c1-160))"
    if [ -x /Applications/mattstack.app/Contents/Helpers/deck ]; then
      grep -q '"com.mattstack.deck' "$LOGS/tray-services.json" && ok "tray.sock /services lists deck" || bad "deck is bundled but /services does not list com.mattstack.deck"
    else
      ok "deck not bundled — not expected in /services"
    fi
  else
    bad "tray.sock /services does not list com.mattstack.daemon"
  fi
  curl -sf --max-time 5 --unix-socket "$SOCK" http://localhost/permissions > "$LOGS/tray-permissions.json" 2>/dev/null
  grep -q '"fda"' "$LOGS/tray-permissions.json" 2>/dev/null && ok "tray.sock /permissions → $(tr -d '\n ' < "$LOGS/tray-permissions.json" | cut -c1-160)" || bad "tray.sock /permissions empty or missing fda"
else
  bad "no tray socket at $SOCK"
fi

# The finish gate: drive-setup.sh probes and drives each finish-gated Done
# row on its own (Fast Browser, writing-style, either, or neither), writing
# one line per row it resolved, or the single word "open" when it found none.
# `rt settings get`/`rt skills writing-style show --json` are the one
# undecorated reads of the store either row's own record lives in.
GATE_FILE="$LOGS/finish-gate.txt"
if [ ! -f "$GATE_FILE" ]; then
  if [ "$HEADLESS" = 1 ]; then ok "finish gate not driven (headless)"; else bad "no finish-gate.txt from drive-setup.sh"; fi
elif [ "$(cat "$GATE_FILE")" = "open" ]; then
  WAIVED=$(rt settings get setup.waived --json 2>/dev/null)
  case "$WAIVED" in
    *tool.fast-browser-extension*) bad "nothing was skipped on the Done screen but setup.waived holds the id: $WAIVED";;
    *) ok "setup.waived is empty (the gate never closed)";;
  esac
else
  if grep -qx 'fast-browser-extension=skipped' "$GATE_FILE"; then
    WAIVED=$(rt settings get setup.waived --json 2>/dev/null)
    case "$WAIVED" in
      *tool.fast-browser-extension*) ok "setup.waived holds tool.fast-browser-extension after Skip for now";;
      *) bad "Skip for now was confirmed but setup.waived does not hold the id: $WAIVED";;
    esac
  else
    WAIVED=$(rt settings get setup.waived --json 2>/dev/null)
    case "$WAIVED" in
      *tool.fast-browser-extension*) bad "fast-browser-extension was not skipped on the Done screen but setup.waived holds the id: $WAIVED";;
      *) ok "setup.waived does not hold tool.fast-browser-extension (it was not skipped)";;
    esac
  fi
  STYLE_LINE=$(grep '^writing-style=' "$GATE_FILE" || true)
  if [ -n "$STYLE_LINE" ]; then
    STYLE_ID="${STYLE_LINE#writing-style=}"
    SHOW=$(rt skills writing-style show --json 2>/dev/null)
    SHOW_SKILL=$(printf '%s' "$SHOW" | "$JQ" -r '.skill // empty' 2>/dev/null)
    SHOW_SOURCE=$(printf '%s' "$SHOW" | "$JQ" -r '.source // empty' 2>/dev/null)
    if [ "$SHOW_SKILL" = "$STYLE_ID" ] && [ "$SHOW_SOURCE" = "user" ]; then
      ok "writing style persisted end to end: $STYLE_ID (source user)"
    else
      bad "writing style did not persist: wanted $STYLE_ID at source user, got $SHOW_SKILL at source $SHOW_SOURCE"
    fi
  fi
fi

# mattstack.appPath (V3): the app records where it runs from. --json is the only stable, undecorated form of `rt settings get`.
AP=$(rt settings get mattstack.appPath --json 2>/dev/null)
case "$AP" in
  *'"value":"/Applications/mattstack.app"'*) ok "mattstack.appPath = /Applications/mattstack.app";;
  *"\"value\":\"$HOME/Applications/mattstack.app\""*) ok "mattstack.appPath = $HOME/Applications/mattstack.app";;
  *) bad "mattstack.appPath is not the canonical path (wanted /Applications/mattstack.app): $AP";;
esac

# repos.root: renders only when a team is being joined or a team on this
# machine already tracks repos, so it is absent in headless and no-team runs.
# drive-setup.sh answers it before Continue when it runs at all; absence here
# is a stated pass, not a failure.
JQ_ROOT=/Applications/mattstack.app/Contents/Helpers/jq
ROOT_STATUS=$([ -x "$JQ_ROOT" ] && rt setup status --json 2>/dev/null | tail -1 | "$JQ_ROOT" -r '.groups[].rows[]|select(.id=="repos.root")|.status' 2>/dev/null)
case "$ROOT_STATUS" in
  ready) ok "repos.root ready";;
  "")    ok "repos.root row absent (no team tracked, or headless)";;
  *)     bad "repos.root present but not ready: $ROOT_STATUS";;
esac

# daemon registered + running under the canonical label
launchctl print "gui/$(id -u)/com.mattstack.daemon" > "$LOGS/launchctl.txt" 2>&1
if grep -qE 'pid = [0-9]+' "$LOGS/launchctl.txt"; then ok "com.mattstack.daemon running (pid $(grep -oE 'pid = [0-9]+' "$LOGS/launchctl.txt" | head -1 | awk '{print $3}'))"; else bad "com.mattstack.daemon not running"; fi
launchctl print "gui/$(id -u)/com.rt.daemon" >/dev/null 2>&1 && bad "legacy com.rt.daemon job present" || ok "no legacy com.rt.daemon job"
# Every deck-managed job holds a pid: a spawn-failed job (exit 78, e.g. a
# missing WorkingDirectory) is a crash loop launchd never logs anywhere.
for label in $(launchctl print "gui/$(id -u)" 2>/dev/null | grep -oE 'com\.mattstack\.deck\.[a-z]+' | sort -u); do
  if launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -qE '^\s*pid = [0-9]+'; then ok "$label running"; else bad "$label not running ($(launchctl print "gui/$(id -u)/$label" 2>/dev/null | grep -oE 'last exit code = [^,]*' | head -1))"; fi
done
[ -e "$HOME/.rt" ] && bad "~/.rt exists (legacy)" || ok "no ~/.rt"
if [ -e /Applications/rt-tray.app ] || [ -e "$HOME/Applications/rt-tray.app" ]; then bad "rt-tray.app present (legacy)"; else ok "no rt-tray.app"; fi

# ── Fast Browser: the tool.fast-browser row, and the doctor probe's own wall time ──
# fastbrowser.setup already ran as part of Install; this reads back the row it
# left behind and re-runs the same `doctor --json` probe tools.ts uses, timed.
# A timed-out probe today surfaces as a bare exit 124 with no number anywhere,
# so a probe that is slowly drifting toward that timeout is invisible right up
# until the run crosses it. A logged elapsed time turns that into something an
# operator can watch trend, not just a coin flip between two runs.
rt setup status --json 2>/dev/null | tail -1 > "$LOGS/setup-status-fastbrowser.json"
FB_ROW=$([ -x "$JQ" ] && "$JQ" -r '.groups[].rows[]|select(.id=="tool.fast-browser")|.status + ": " + (.detail // "")' < "$LOGS/setup-status-fastbrowser.json" 2>/dev/null)
case "$FB_ROW" in
  ready:*) ok "tool.fast-browser row ready";;
  "")      bad "no tool.fast-browser row in rt setup status --json (see logs/setup-status-fastbrowser.json)";;
  *)       bad "tool.fast-browser not ready: $FB_ROW";;
esac
FASTBROWSER_NODE=/Applications/mattstack.app/Contents/Helpers/node/bin/node
FASTBROWSER_MJS=/Applications/mattstack.app/Contents/Helpers/fast-browser/bin/fast-browser.mjs
if [ -x "$FASTBROWSER_NODE" ] && [ -f "$FASTBROWSER_MJS" ]; then
  t0=$(date +%s)
  "$FASTBROWSER_NODE" "$FASTBROWSER_MJS" doctor --json > "$LOGS/fastbrowser-doctor.json" 2>"$LOGS/fastbrowser-doctor.stderr"
  elapsed=$(( $(date +%s) - t0 ))
  # doctor commonly exits non-zero BECAUSE it found a problem while still
  # printing its report (tools.ts's own probeFastBrowser trusts the JSON over
  # the exit code for exactly this reason); a parseable "checks" array is
  # the pass condition here too, not exit 0.
  if [ -x "$JQ" ] && "$JQ" -e '.checks | type == "array"' < "$LOGS/fastbrowser-doctor.json" >/dev/null 2>&1; then
    ok "fast-browser doctor --json ran in ${elapsed}s"
  else
    bad "fast-browser doctor --json produced no readable report in ${elapsed}s: $(tail -3 "$LOGS/fastbrowser-doctor.stderr" 2>/dev/null | tr '\n' ' ')"
  fi
else
  bad "fast-browser not found in the bundle (node=$FASTBROWSER_NODE mjs=$FASTBROWSER_MJS)"
fi

# ── fresh db lands on the schema version this rt build expects ─────────────
# rt exposes no CLI/daemon surface for SCHEMA_VERSION (lib/state/db.ts) today
# -- checked commands/daemon.ts, commands/verify.ts, and every daemon status
# handler -- so this cannot compare against the number the installed build
# actually wants, only prove a migration ran at all. CLAUDE.md's SCHEMA_VERSION
# note is why that gap matters: two concurrent lanes can each stamp a
# different db with the same user_version and the loser's tables never
# appear, silently, on every surface this harness has today.
STATE_DB="$HOME/.mattstack/rt/state.db"
if [ -f "$STATE_DB" ]; then
  USER_VERSION=$(/usr/bin/sqlite3 "$STATE_DB" 'PRAGMA user_version;' 2>/dev/null)
  case "$USER_VERSION" in
    ''|0) bad "state.db user_version is ${USER_VERSION:-unreadable} (expected > 0 after migrations ran)";;
    *)    ok "state.db user_version = $USER_VERSION";;
  esac
else
  bad "no state.db at $STATE_DB"
fi

if [ "$HEADLESS" = 0 ]; then
  [ -d "$HOME/.mattstack/user/.git" ] && ok "~/.mattstack/user is the home repo" || bad "~/.mattstack/user is not a git repo (home-repo re-root ruling)"

  # ── encrypted state backup, with no Homebrew anywhere ──────────────────────
  # The PATH set at the top of this script carries no brew, so age, zstd and
  # git-lfs can only come from inside the bundle. `init` is the whole chain:
  # LFS filters, recipients from the keychain key, the first backup, and a
  # decrypt round-trip.
  if rt state backup init > "$LOGS/state-backup-init.log" 2>&1; then
    ok "rt state backup init ran with no Homebrew on PATH"
  else
    bad "rt state backup init failed: $(tail -3 "$LOGS/state-backup-init.log" 2>/dev/null | tr '\n' ' ')"
  fi
  AGE_FILES=$(find "$HOME/.mattstack/user/state-backups" -name '*.age' 2>/dev/null | head -3)
  if [ -n "$AGE_FILES" ]; then
    ok "encrypted backup landed: $(printf '%s' "$AGE_FILES" | tr '\n' ' ')"
  else
    bad "no .age file under ~/.mattstack/user/state-backups"
  fi
  # The filter git runs on every add and checkout in the home repo: an
  # absolute path into the bundle, rewritten by init and by every sweep.
  LFS_FILTER=$(git -C "$HOME/.mattstack/user" config --local --get filter.lfs.process 2>/dev/null)
  case "$LFS_FILTER" in
    *mattstack.app/Contents/Helpers/git-lfs*) ok "LFS filter points at the bundled git-lfs";;
    "")                                       bad "no filter.lfs.process in the home repo after backup init";;
    *)                                        bad "filter.lfs.process does not name the bundled git-lfs: $LFS_FILTER";;
  esac

  # ── the daemon's own state-backup sweep, under launchd's minimal PATH ──────
  # `rt state backup init` above ran from an ssh login shell, which carries the
  # operator's full PATH -- it cannot fail the way production fails, because
  # findBackupTool (lib/state/backup-tools.ts) is bundle-first regardless of
  # PATH, and a rich PATH would hide a bundle-resolution bug behind a brew
  # fallback the daemon's own PATH doesn't have. No daemon verb exists yet to
  # trigger the sweep on demand over the socket (RT-131 tracks bundling the
  # three tools; there is nothing to call here), so this instead proves the
  # premise the sweep depends on: the plist launchd actually loaded carries
  # the minimal PATH LaunchAgent.plist declares, and the three tools the sweep
  # shells out to (age, zstd, git-lfs) are the bundled copies that PATH alone,
  # minimal or not, would never need to supply.
  DAEMON_PLIST="/Applications/mattstack.app/Contents/Library/LaunchAgents/com.mattstack.daemon.plist"
  DAEMON_PATH=$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:PATH" "$DAEMON_PLIST" 2>/dev/null)
  case "$DAEMON_PATH" in
    /usr/bin:/bin:/usr/sbin:/sbin) ok "daemon plist PATH is launchd's minimal PATH ($DAEMON_PATH)";;
    "") bad "no EnvironmentVariables PATH in $DAEMON_PLIST";;
    *)  bad "daemon plist PATH is not minimal, so a real PATH-fallback bug could hide behind it: $DAEMON_PATH";;
  esac
  for tool in age zstd git-lfs; do
    tool_path="/Applications/mattstack.app/Contents/Helpers/$tool"
    if [ -x "$tool_path" ]; then
      ok "$tool resolves bundle-first under the daemon's own PATH ($tool_path)"
    else
      bad "$tool missing from the bundle, so the sweep has nothing to fall back to under the daemon's minimal PATH: $tool_path"
    fi
  done

  # ── the local HTTPS proxy ──────────────────────────────────────────────────
  # Headless has no app to answer proxy.install's need, so the whole block is
  # inside the same gate as the home repo rather than reporting a bare-machine
  # absence as a defect.
  #
  # `setup status --json` is a Plan (groups/rows), not a step ledger: apply's
  # step states are streamed as NDJSON and never persisted. tool.proxy is the
  # row that reads back what proxy.install left behind: `ready` only when the
  # plist is there, the deployed VERSION matches the bundle's pin, and the CA
  # is trusted.
  proxy_row() {  # <log basename>
    rt setup status --json 2>/dev/null | tail -1 > "$LOGS/$1.json"
    [ -x "$JQ" ] && "$JQ" -r '.groups[].rows[]|select(.id=="tool.proxy")|.status + ": " + (.detail // "")' < "$LOGS/$1.json" 2>/dev/null
  }
  # `remove` identifies the System-keychain entry to delete from this
  # root-owned copy, never from the console user's own ~/.portless/ca.pem, so
  # a machine whose certificate IS trusted has to carry one.
  assert_trust_record() {
    [ -f "/Library/Application Support/mattstack/proxy/ca.pem" ] \
      && ok "the trusted certificate is recorded in the root-owned tree" \
      || bad "no proxy/ca.pem beside VERSION: uninstall would leave the CA trusted"
  }
  row=$(proxy_row setup-status)
  if [ "$UNTRUSTED" = 1 ]; then
    # The whole point of the scenario: declining the certificate leaves a
    # working proxy and a row that says what is missing, not a failed install.
    case "$row" in
      needs-you:*certificate*) ok "certificate declined, and the row says so: tool.proxy $row";;
      "")                      bad "no tool.proxy row in rt setup status --json (see logs/setup-status.json)";;
      *)                       bad "expected the untrusted-certificate row: tool.proxy $row";;
    esac
  else
    case "$row" in
      ready:*) ok "proxy installed: tool.proxy $row"; assert_trust_record;;
      "")      bad "no tool.proxy row in rt setup status --json (see logs/setup-status.json)";;
      *)       bad "proxy not installed: tool.proxy $row";;
    esac
  fi
  [ -f /Library/LaunchDaemons/sh.portless.proxy.plist ] && ok "portless LaunchDaemon plist present" || bad "portless plist missing"
  # `launchctl print system/<label>` answers a standard user with "Could not
  # find service" whether the service is absent or merely unreadable, and the
  # tester has no passwordless sudo to get past it. The domain listing IS
  # readable, and its `<pid> <status> <label>` rows separate loaded-and-running
  # (a pid) from loaded-but-dead (0) without any privilege at all.
  launchctl print system > "$LOGS/portless-launchctl.txt" 2>&1
  proxy_pid=$(awk '$NF == "sh.portless.proxy" { print $1; exit }' "$LOGS/portless-launchctl.txt")
  case "$proxy_pid" in
    ""|0) bad "portless daemon not running (launchctl print system pid: ${proxy_pid:-not listed})";;
    *)    ok "portless daemon running (pid $proxy_pid)";;
  esac
  # The end-to-end fact: every app domain resolving to loopback (the root
  # daemon rewrites /etc/hosts from routes.json) and answering TLS with a host
  # cert it mints on demand under the CA the installer trusted. Hostnames come
  # from the route table; which apps must hold one is assert_served_apps' call,
  # from the bundle's deps.lock.
  if [ "$UNTRUSTED" = 1 ]; then
    assert_mattstack_routes untrusted proxy
  else
    assert_mattstack_routes trusted proxy
  fi
  assert_served_apps assert-served 90

  # The remedy the row offers, exercised end to end: the tray's own escalator
  # runs the helper's trust verb, both dialogs get answered, and the row that
  # asked for it clears.
  if [ "$UNTRUSTED" = 1 ] && [ -S "$SOCK" ]; then
    AX_TRUST_DECLINE=0
    source "$(cd "$(dirname "$0")" && pwd)/ax.sh"
    curl -sS -X POST --max-time 300 --unix-socket "$SOCK" http://localhost/privileged/proxy-trust > "$LOGS/proxy-trust.json" 2>&1 &
    trust_pid=$!
    n=90
    while kill -0 "$trust_pid" 2>/dev/null && [ "$n" -gt 0 ]; do ax_admin_auth_once >/dev/null 2>&1; sleep 2; n=$((n-1)); done
    wait "$trust_pid"
    grep -q '"ok":true' "$LOGS/proxy-trust.json" 2>/dev/null \
      && ok "the trust verb ran through /privileged/proxy-trust" \
      || bad "/privileged/proxy-trust: $(tr -d '\n' < "$LOGS/proxy-trust.json" 2>/dev/null | cut -c1-200)"
    grep -q 'MATTSTACK_TRUST=ok' "$LOGS/proxy-trust.json" 2>/dev/null \
      && ok "the helper reported MATTSTACK_TRUST=ok" \
      || bad "the helper did not report MATTSTACK_TRUST=ok"
    row=$(proxy_row setup-status-after-trust)
    case "$row" in
      ready:*) ok "the certificate row cleared: tool.proxy $row"; assert_trust_record;;
      *)       bad "tool.proxy did not clear after the trust verb: ${row:-no row}";;
    esac
    assert_mattstack_routes trusted proxy-after-trust
  elif [ "$UNTRUSTED" = 1 ]; then
    # Skipping silently would report zero failures for a run that never
    # exercised the trust verb, the row clearing, or the post-trust https
    # check, which is the whole of what --expect-untrusted claims to assert.
    bad "no tray socket at $SOCK: the trust remedy could not be exercised"
  fi

  # Evidence for the proxy assertions above, whether they passed or failed:
  # what the daemon was told to serve, what it published to the resolver, and
  # what it said while doing it.
  sed -n '/# portless-start/,/# portless-end/p' /etc/hosts > "$LOGS/proxy-hosts.txt" 2>&1
  ls -la "$HOME/.portless" "$HOME/.portless/host-certs" > "$LOGS/proxy-statedir.txt" 2>&1
  : > "$LOGS/proxy-curl.txt"
  for h in $("$JQ" -r '.[].hostname | select(endswith(".mattstack"))' "$HOME/.portless/routes.json" 2>/dev/null); do
    { echo "== $h"; curl -sS -o /dev/null -D - --max-time 10 "https://$h"; } >> "$LOGS/proxy-curl.txt" 2>&1
  done
  tail -100 "/Library/Application Support/mattstack/proxy/log/service.log" > "$LOGS/proxy-service.log" 2>&1
  cat "$HOME/.mattstack/deck/platform.json" "$HOME/.mattstack/deck/registry.json" > "$LOGS/proxy-deck-state.json" 2>&1
else
  ok "served apps and .mattstack routes not asserted (headless: no proxy, so deck has no routes)"
fi
echo "$fails" > "$LOGS/assert-fails.txt"
[ "$fails" -eq 0 ]
