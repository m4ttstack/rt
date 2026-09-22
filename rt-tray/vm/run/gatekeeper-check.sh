#!/bin/bash
# Clean-room Gatekeeper assessment of a signed, notarized, stapled app.
#
# Proves one claim and one only: a first-ever launch on a machine that has
# never seen this app, or this developer, shows no Gatekeeper warning. It
# proves nothing about the app working... the golden has no brew, no CLT and
# nothing preinstalled, so anything the app shells out to will be missing.
#
# Usage:
#   gatekeeper-check.sh --dmg <path.dmg> [options]
#   gatekeeper-check.sh --app <path.app> [options]
# Options:
#   --ver <14|15|26>   golden macOS version (default 26)
#   --dest <dir>       install destination in the guest (default /Applications)
#   --keep             keep the clone after a pass (a failure always keeps it)
#   --dry-run          exercise the orchestrator with no Tart and no artifact
set -euo pipefail
source "$(cd "$(dirname "$0")/.." && pwd)/lib/common.sh"

DMG=""; APP=""; VER=26; DEST="/Applications"; KEEP=0; DRY=0
# Without this, a value-less flag makes `shift 2` fail and set -e exits mute.
need_val() { [ -n "${2:-}" ] || vm_die "$1 needs a value"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dmg) need_val --dmg "${2:-}"; DMG="$2"; shift 2;;
    --app) need_val --app "${2:-}"; APP="$2"; shift 2;;
    --ver) need_val --ver "${2:-}"; VER="$2"; shift 2;;
    --dest) need_val --dest "${2:-}"; DEST="$2"; shift 2;;
    --keep) KEEP=1; shift;;
    --dry-run) DRY=1; shift;;
    -h|--help) sed -n '2,16p' "$0"; exit 0;;
    *) vm_die "unknown argument: $1";;
  esac
done
[ -n "$DMG" ] || [ -n "$APP" ] || vm_die "usage: gatekeeper-check.sh --dmg <path.dmg> | --app <path.app> [--ver 26] [--dest <dir>] [--keep] [--dry-run]"
[ -z "$DMG" ] || [ -z "$APP" ] || vm_die "--dmg and --app are mutually exclusive"

GOLDEN="$(vm_golden_name "$VER")"
RUN_VM="gkcheck-$(date +%H%M%S)"
[ "$RUN_VM" != "$GOLDEN" ] || vm_die "refusing to run the golden itself"

vm_run_init "gatekeeper-$VER"
TART_PID=""
HOST_MNT=""
cleanup() {
  local failed; failed=$(vm_phases_failed)
  # Every vm_die between the host mount and here would otherwise leak it, and
  # the next run's mount lands at "<name> 1" instead of the path it expects.
  if [ -n "$HOST_MNT" ]; then
    hdiutil detach "$HOST_MNT" -quiet 2>/dev/null || true
    rmdir "$HOST_MNT" 2>/dev/null || true
    HOST_MNT=""
  fi
  if [ "$KEEP" = 1 ] || [ "${failed:-0}" != 0 ]; then
    vm_warn "keeping $RUN_VM for diagnosis; remove with: tart stop $RUN_VM && tart delete $RUN_VM"
  else
    tart stop "$RUN_VM" 2>/dev/null || true
    [ -n "$TART_PID" ] && wait "$TART_PID" 2>/dev/null
    tart delete "$RUN_VM" 2>/dev/null || true
  fi
  # A vm_die before the first phase ends leaves no ledger, and rendering one
  # then buries the real error under a missing-file complaint.
  [ -f "$VM_RUN_DIR/phases.jsonl" ] && vm_render_report
}
trap cleanup EXIT

# ── preflight: the artifact must be what the run claims, before any VM boots ──
vm_phase_begin preflight
if [ "$DRY" = 1 ]; then
  vm_phase_end preflight skip "dry run"
else
  vm_require_cmd tart "brew install openai/tools/tart"
  vm_require_cmd swiftc "Apple CLT required for the host-side screenshot"
  SRC="$APP"
  if [ -n "$DMG" ]; then
    [ -f "$DMG" ] || vm_die "no dmg at $DMG"
    MNT=$(mktemp -d)
    hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" >/dev/null \
      || { rmdir "$MNT" 2>/dev/null || true; vm_die "could not mount $DMG on the host"; }
    HOST_MNT="$MNT"
    SRC=$(find "$HOST_MNT" -maxdepth 1 -name '*.app' -print -quit)
    [ -n "$SRC" ] || vm_die "no .app at the top level of $DMG"
  fi
  [ -d "$SRC" ] || vm_die "no app bundle at $SRC"
  APP_NAME="$(basename "$SRC")"
  # CFBundleExecutable, not the bundle name: the two differ often enough that
  # assuming them equal would report "never started" for a launch that worked.
  APP_EXEC=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$SRC/Contents/Info.plist" 2>/dev/null || true)
  [ -n "$APP_EXEC" ] || APP_EXEC="${APP_NAME%.app}"

  # Stapling is asserted on the host because the golden has no CLT to run
  # stapler: an unstapled build still passes inside the VM whenever the guest
  # can reach Apple, which is a weaker claim than this run makes.
  PF_FAIL=""
  codesign --verify --deep --strict "$SRC" 2>>"$VM_RUN_DIR/logs/preflight.log" \
    || PF_FAIL="$PF_FAIL codesign"
  spctl --assess --type execute -vv "$SRC" 2>>"$VM_RUN_DIR/logs/preflight.log" \
    || PF_FAIL="$PF_FAIL spctl"
  xcrun stapler validate "$SRC" >>"$VM_RUN_DIR/logs/preflight.log" 2>&1 \
    || PF_FAIL="$PF_FAIL staple"
  if [ -n "$HOST_MNT" ]; then
    hdiutil detach "$HOST_MNT" -quiet 2>/dev/null || true
    rmdir "$HOST_MNT" 2>/dev/null || true
    HOST_MNT=""
  fi
  if [ -n "$PF_FAIL" ]; then
    vm_phase_end preflight fail "host checks failed:$PF_FAIL (see logs/preflight.log)"
    exit 1
  fi
  # awk, not grep -q: -q exits on its first match, SIGPIPEs the producer, and
  # under pipefail the pipeline then returns 141, inverting the guard exactly
  # when the match is found. awk drains its input, so the status is the answer.
  tart list 2>/dev/null | awk -v g="$GOLDEN" '$2==g{f=1} END{exit !f}' \
    || { vm_phase_end preflight fail "no golden image $GOLDEN (run golden/build-golden.sh $VER)"; exit 1; }
  vm_phase_end preflight pass "$APP_NAME signed, accepted and stapled on the host"
fi

if [ "$DRY" = 1 ]; then
  vm_phase_begin dry-run
  vm_log "[dry-run] would: tart clone $GOLDEN $RUN_VM; boot with graphics; stage; stamp quarantine; Finder-copy to $DEST; open; assert no CoreServicesUIAgent window; teardown"
  vm_phase_end dry-run pass "orchestrator exercised, no VM touched"
  exit 0
fi

STAGE="/Users/$VM_TESTER_USER/gk"
QUAR_VALUE="0083;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)"

vm_phase_begin clone
tart clone "$GOLDEN" "$RUN_VM" >>"$VM_RUN_DIR/logs/tart.log" 2>&1 \
  && vm_phase_end clone pass || { vm_phase_end clone fail "tart clone failed (see logs/tart.log)"; exit 1; }

vm_phase_begin boot
# Graphics stay on: the claim is what a human sees on a double-click, which a
# headless run cannot show. The Tart window takes host keyboard focus while up.
tart run "$RUN_VM" --no-audio "--dir=run:$VM_RUN_DIR" >>"$VM_RUN_DIR/logs/tart.log" 2>&1 &
TART_PID=$!
# The tester key baked into a golden can drift from .cache (a rebuilt cache
# regenerates the pair; goldens are never re-provisioned), so key auth can
# fail against a perfectly healthy guest. The admin password is the same
# bootstrap credential build-golden used, so re-trust the current key in the
# CLONE. walkthrough.sh does this for the same reason; without it
# vm_wait_ssh below times out and reports a boot failure for what is really
# an auth failure. Goldens stay unbooted and immutable either way.
if vm_ip "$RUN_VM" 90 >/dev/null; then
  for keyuser in "$VM_TESTER_USER" "$VM_ADMIN_USER"; do
    vm_ssh_pw_try "$VM_ADMIN_USER" "$VM_ADMIN_PASS" "$RUN_VM" \
      "sudo install -d -m 700 -o $keyuser -g staff /Users/$keyuser/.ssh && echo '$(cat "$VM_SSH_KEY.pub")' | sudo tee /Users/$keyuser/.ssh/authorized_keys >/dev/null && sudo chown $keyuser:staff /Users/$keyuser/.ssh/authorized_keys && sudo chmod 600 /Users/$keyuser/.ssh/authorized_keys" \
      >>"$VM_RUN_DIR/logs/tart.log" 2>&1 || true
  done
fi
vm_wait_ssh "$VM_TESTER_USER" "$RUN_VM" 300 \
  && vm_phase_end boot pass || { vm_phase_end boot fail "guest never answered ssh"; exit 1; }
"$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/00-booted.png" || true

vm_phase_begin stage
vm_ssh "$VM_TESTER_USER" "$RUN_VM" "rm -rf '$STAGE' && mkdir -p '$STAGE'"
if [ -n "$DMG" ]; then
  vm_scp "$VM_TESTER_USER" "$RUN_VM" "$DMG" "$STAGE/"
  STAGED="$STAGE/$(basename "$DMG")"
else
  # ditto through a zip is the only transport that preserves the bundle's own
  # xattrs and symlinks across scp; a plain scp -r breaks the signature seal.
  ZIP="$VM_RUN_DIR/in/app.zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  vm_scp "$VM_TESTER_USER" "$RUN_VM" "$ZIP" "$STAGE/"
  vm_ssh "$VM_TESTER_USER" "$RUN_VM" "cd '$STAGE' && ditto -x -k app.zip . && rm app.zip"
  STAGED="$STAGE/$APP_NAME"
fi
vm_phase_end stage pass "staged at $STAGED"

# ── quarantine: stamped, then proven present. Without the xattr the run is a
#    launch test wearing a Gatekeeper test's name. ─────────────────────────────
vm_phase_begin quarantine
vm_ssh "$VM_TESTER_USER" "$RUN_VM" "xattr -w com.apple.quarantine '$QUAR_VALUE' '$STAGED'"
LANDED=$(vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "xattr -p com.apple.quarantine '$STAGED' 2>/dev/null" || true)
if [ -z "$LANDED" ]; then
  vm_phase_end quarantine fail "xattr did not land on $STAGED, so the Gatekeeper path would NOT be exercised"
  exit 1
fi
vm_phase_end quarantine pass "com.apple.quarantine = $LANDED"

vm_phase_begin install
DEST_APP="$DEST/$APP_NAME"
# ~/Applications does not exist on a stock account and Finder's duplicate fails
# on a missing destination. /Applications is left alone: it always exists, and
# creating it would mask a typo'd --dest.
if [ "$DEST" != "/Applications" ]; then
  vm_ssh "$VM_TESTER_USER" "$RUN_VM" "mkdir -p '$DEST'"
fi
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "test ! -e '$DEST_APP'" \
  || { vm_phase_end install fail "$DEST_APP already exists, so this guest is not clean"; exit 1; }
if [ -n "$DMG" ]; then
  vm_ssh "$VM_TESTER_USER" "$RUN_VM" "hdiutil attach '$STAGED' -nobrowse -mountpoint /tmp/gkvol >/dev/null"
  SRC_IN_GUEST="/tmp/gkvol/$APP_NAME"
else
  SRC_IN_GUEST="$STAGED"
fi
# Finder does the copy, not ditto: a Finder copy marks the quarantine
# user-approved, which is what keeps the launch out of App Translocation. A
# privilege error here must not fall back to ditto, which would translocate the
# launch and quietly answer a different question.
COPY_ERR=$(vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
  "osascript -e 'tell application \"Finder\" to duplicate POSIX file \"$SRC_IN_GUEST\" to POSIX file \"$DEST\" with replacing' 2>&1 >/dev/null" || true)
if ! vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "test -d '$DEST_APP'"; then
  vm_phase_end install fail "Finder copy to $DEST failed: ${COPY_ERR:-unknown}. On a privilege error rerun with --dest /Users/$VM_TESTER_USER/Applications; do not work around it with ditto."
  exit 1
fi
STILL=$(vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "xattr -p com.apple.quarantine '$DEST_APP' 2>/dev/null" || true)
if [ -z "$STILL" ]; then
  vm_phase_end install fail "quarantine absent on $DEST_APP after the copy, so first launch would not be assessed"
  exit 1
fi
vm_phase_end install pass "Finder-copied to $DEST_APP, quarantine intact"
"$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/01-installed.png" || true

# ── launch: a Gatekeeper warning is a CoreServicesUIAgent window and an admin
#    prompt is SecurityAgent, so the two are told apart by owning process
#    rather than by reading pixels. Screenshots are evidence, not the test. ────
vm_phase_begin launch
# Positive control before the assertion that matters: an absent dialog and an
# unreachable System Events both read as "no windows", so without this the
# phase would pass whenever Accessibility is not granted in the guest.
CONTROL=$(vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
  "osascript -e 'tell application \"System Events\" to get name of every process whose visible is true' 2>/dev/null" || true)
if [ -z "$CONTROL" ]; then
  vm_phase_end launch fail "System Events answered nothing for a known-good query, so Accessibility is not granted here and an absent Gatekeeper dialog cannot be told from a broken probe"
  exit 1
fi
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
  "osascript -e 'tell application \"Finder\" to open POSIX file \"$DEST_APP\"'" \
  >>"$VM_RUN_DIR/logs/launch.log" 2>&1 || true

GK_WINDOWS=""; RUNNING=0; i=0
while [ "$i" -lt 12 ]; do
  sleep 1; i=$((i+1))
  [ "$i" = 2 ] && "$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/02-open-t2.png" >/dev/null 2>&1 || true
  [ "$i" = 5 ] && "$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/03-open-t5.png" >/dev/null 2>&1 || true
  GK_WINDOWS=$(vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
    "osascript -e 'tell application \"System Events\" to get name of windows of process \"CoreServicesUIAgent\"' 2>/dev/null" || true)
  [ -n "$GK_WINDOWS" ] && break
  # Anchored to the installed bundle's own executable directory: pgrep -x on a
  # guessed process name misses whenever CFBundleExecutable is not the bundle
  # name, and a bare bundle-path match would catch unrelated processes.
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "pgrep -f '$DEST_APP/Contents/MacOS/' >/dev/null" \
    && { RUNNING=1; break; }
done
"$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/04-settled.png" || true

if [ -n "$GK_WINDOWS" ]; then
  vm_phase_end launch fail "Gatekeeper warning shown: $GK_WINDOWS" "04-settled.png"
elif [ "$RUNNING" = 1 ]; then
  vm_phase_end launch pass "no CoreServicesUIAgent window; $APP_EXEC is running" "04-settled.png"
else
  vm_phase_end launch fail "$APP_EXEC never started and no warning appeared, so something else blocked it" "04-settled.png"
fi

vm_phase_begin assess
{
  echo "== spctl (guest) =="
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "spctl --assess --type execute -vv '$DEST_APP' 2>&1" || true
  echo; echo "== codesign (guest) =="
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "codesign -dv --verbose=2 '$DEST_APP' 2>&1" || true
  echo; echo "== quarantine after launch =="
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "xattr -p com.apple.quarantine '$DEST_APP' 2>&1" || true
  echo; echo "== visible processes =="
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
    "osascript -e 'tell application \"System Events\" to get name of every process whose visible is true' 2>&1" || true
} > "$VM_RUN_DIR/logs/assess.log" 2>&1
vm_phase_end assess pass "evidence in logs/assess.log"

FAILED=$(vm_phases_failed)
[ "${FAILED:-0}" = 0 ] || exit 1
vm_log "PASS: $APP_NAME opened with no Gatekeeper warning on a machine that had never seen it."
vm_log "This says nothing about the app working; the golden has no tooling installed."
