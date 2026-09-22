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
GUEST_RUN="/Volumes/My Shared Files/run"
QUAR_VALUE="0083;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)"

# Every window on screen and the text inside it, appended under a label. The
# run samples four screenshots, so a dialog raised and answered between two of
# them leaves no trace at all; this leaves one the report can name.
probe_dialogs() {
  local label="$1" out
  out=$(vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
    "GUEST_RUN='$GUEST_RUN' bash '$GUEST_RUN/in/guest/dialogs.sh' dump 2>&1" || printf 'PROBE_UNREACHABLE')
  # An unreachable probe and an empty screen must not read alike: the old loop
  # treated both as "no dialog", which is how a broken probe passes as a pass.
  printf '[%s] %s\n%s\n' "$(vm_now)" "$label" "${out:-<no windows>}" >> "$VM_RUN_DIR/logs/dialogs.log"
  printf '%s' "$out"
}

# Clicks a button in the guest dialog whose text contains a phrase; prints the
# owning process, or nothing when no such dialog is up.
dialog_click() {
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
    "GUEST_RUN='$GUEST_RUN' bash '$GUEST_RUN/in/guest/dialogs.sh' click '$1' '$2' 2>/dev/null" || true
}

vm_phase_begin clone
tart clone "$GOLDEN" "$RUN_VM" >>"$VM_RUN_DIR/logs/tart.log" 2>&1 \
  && vm_phase_end clone pass || { vm_phase_end clone fail "tart clone failed (see logs/tart.log)"; exit 1; }

vm_phase_begin boot
# Graphics stay on: the claim is what a human sees on a double-click, which a
# headless run cannot show. The Tart window takes host keyboard focus while up.
tart run "$RUN_VM" --no-audio "--dir=run:$VM_RUN_DIR" >>"$VM_RUN_DIR/logs/tart.log" 2>&1 &
TART_PID=$!
TRUSTED=1; vm_trust_key "$RUN_VM" || TRUSTED=0
vm_wait_ssh "$VM_TESTER_USER" "$RUN_VM" 300 \
  && vm_phase_end boot pass \
  || { vm_phase_end boot fail "guest never answered ssh$([ "$TRUSTED" = 0 ] && echo "; the key re-trust step failed first, so this is auth, not boot")"; exit 1; }
"$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/00-booted.png" || true

vm_phase_begin stage
cp -R "$VM_ROOT/run/guest" "$VM_RUN_DIR/in/guest"
chmod -R a+rX "$VM_RUN_DIR/in/guest"
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
# Backgrounded so the probe can run alongside it: a copy into /Applications by
# a standard user raises an authorization prompt, and a foreground copy sits
# there until someone answers it, with nothing in the record naming what asked.
COPY_LOG="$VM_RUN_DIR/logs/finder-copy.log"
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
  "osascript -e 'tell application \"Finder\" to duplicate POSIX file \"$SRC_IN_GUEST\" to POSIX file \"$DEST\" with replacing' 2>&1 >/dev/null" \
  >"$COPY_LOG" 2>&1 &
COPY_PID=$!
ci=0; TCC_BLOCKED=0
while kill -0 "$COPY_PID" 2>/dev/null && [ "$ci" -lt 45 ]; do
  sleep 2; ci=$((ci+1))
  SEEN=$(probe_dialogs "install t=$((ci*2))s")
  case "$SEEN" in
    # Driving Finder over ssh makes sshd the automating process, and the golden
    # grants sshd-keygen-wrapper Apple Events access to System Events ONLY.
    # Automation is granted per client-target pair, so Finder is a separate
    # permission this image has never had, and gatekeeper-check is the only
    # script that drives Finder.
    #
    # It cannot be clicked away either: TCC consent dialogs ignore synthetic
    # events by design, which is the whole point of them. So this is recorded
    # and named rather than fought, and the attempt's own output is kept...
    # discarding it is what made the first run look like an opaque
    # "AppleEvent timed out" instead of a missing grant.
    *"wants access to control"*)
      TCC_BLOCKED=1
      printf '[%s] automation consent prompt; click attempt: %s\n' \
        "$(vm_now)" "$(dialog_click "wants access to control" OK)" >> "$VM_RUN_DIR/logs/dialogs.log" ;;
  esac
  case "$SEEN" in
    *SecurityAgent*|*"trying to modify"*|*"Touch ID or Password"*)
      vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
        "GUEST_RUN='$GUEST_RUN' bash '$GUEST_RUN/in/guest/dialogs.sh' admin" \
        >>"$VM_RUN_DIR/logs/dialogs.log" 2>&1 || true ;;
  esac
done
# Bounded, because an unbounded wait on a copy still blocked behind a prompt
# this loop could not answer presents as a wedged guest, and that reads as an
# infrastructure problem rather than the dialog it actually is. dialogs.log
# names what was on screen when this fired.
if kill -0 "$COPY_PID" 2>/dev/null; then
  kill "$COPY_PID" 2>/dev/null || true
  vm_warn "the Finder copy was still running after 90s; killed it so the run reports instead of hanging"
fi
wait "$COPY_PID" 2>/dev/null || true
COPY_ERR=$(cat "$COPY_LOG" 2>/dev/null || true)
if ! vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "test -d '$DEST_APP'"; then
  # Named rather than left as the timeout it presents as. A missing Automation
  # grant surfaces only as "AppleEvent timed out (-1712)" after two minutes,
  # which reads as a slow or broken guest and sends the next person after the
  # VM instead of the golden's TCC grants.
  if [ "$TCC_BLOCKED" = 1 ]; then
    vm_phase_end install fail "the guest asked for Automation consent for sshd-keygen-wrapper to control Finder and nothing can answer it: TCC prompts ignore synthetic clicks. This golden grants Apple Events to System Events only, and Automation is per client-target pair, so it has never been able to drive Finder unattended. Fix it in the golden (add Finder to build-golden.sh's manual grant step), not here."
    exit 1
  fi
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

# ── control: prove this probe, in this session, can SEE a refusal ────────────
#
# Everything after this rests on a negative: no refusal appeared. That is only
# worth anything if the probe could have produced one, and tonight's blind
# CoreServicesUIAgent probe is the standing proof that assuming so is how a
# check passes while testing nothing. The old positive control asked whether
# System Events answers at all, which is a different question from whether it
# can see THIS class of dialog, so it stayed green while the probe it guarded
# was blind.
#
# So a deliberately unsigned app is launched first, through the same probe, in
# the same guest, and must classify as a block. It also proves the pattern
# list itself: the refusal wording changed across releases, and a list that
# matches no dialog a current guest shows is the same fail-open wearing a
# different hat. If the control is not seen the run fails HERE and never
# reports a verdict about the real app, which is what should have happened
# tonight.
#
# It runs before the real launch and is torn down first: its own dialog would
# otherwise still be on screen when the real app is probed.
vm_phase_begin control
CTRL_APP="$STAGE/GatekeeperControl.app"
vm_ssh "$VM_TESTER_USER" "$RUN_VM" "
  rm -rf '$CTRL_APP' && mkdir -p '$CTRL_APP/Contents/MacOS'
  printf '#!/bin/bash\nsleep 120\n' > '$CTRL_APP/Contents/MacOS/GatekeeperControl'
  chmod +x '$CTRL_APP/Contents/MacOS/GatekeeperControl'
  /usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string GatekeeperControl' \
    -c 'Add :CFBundleIdentifier string dev.mattstack.gkcontrol' \
    -c 'Add :CFBundlePackageType string APPL' -c Save '$CTRL_APP/Contents/Info.plist' >/dev/null
  xattr -w com.apple.quarantine '$QUAR_VALUE' '$CTRL_APP'"
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" \
  "osascript -e 'tell application \"Finder\" to open POSIX file \"$CTRL_APP\"'" \
  >>"$VM_RUN_DIR/logs/control.log" 2>&1 || true

CTRL_SEEN=""; CTRL_DEADLINE=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$CTRL_DEADLINE" ]; do
  sleep 1
  CTRL_SEEN=$(probe_dialogs "control")
  [ "$(vm_dialog_verdict "$CTRL_SEEN")" = block ] && break
  CTRL_SEEN=""
done
"$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/05-control.png" || true
# Dismissed by the app's own name, which every refusal wording quotes, and
# never with the "Move to Trash" button sitting beside it: dialogs.sh refuses
# that name outright. The button label varies by release, so each candidate is
# tried in turn and a miss is not a failure.
for b in Done OK Cancel; do
  if [ -n "$(dialog_click GatekeeperControl "$b")" ]; then break; fi
done
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "rm -rf '$CTRL_APP'" >/dev/null 2>&1 || true
# Torn down before the real launch is probed, so a leftover control dialog
# cannot be mistaken for the app's own.
LEFT=$(probe_dialogs "control (after dismissal)")
if [ "$(vm_dialog_verdict "$LEFT")" = block ]; then
  vm_phase_end control fail "the control's refusal dialog is still on screen, so the launch probe below would read it as $APP_NAME's own" "05-control.png"
  exit 1
fi

if [ -z "$CTRL_SEEN" ]; then
  vm_phase_end control fail "an unsigned app raised no refusal this probe could see, so a clean result for $APP_NAME would prove nothing; logs/dialogs.log has every window that did appear" "05-control.png"
  exit 1
fi
vm_phase_end control pass "the probe classified an unsigned app as refused, so a clean result below is a real negative"

# ── launch: dialogs are told apart by what they SAY, not by who owns them.
#    A notarized app on a clean machine is expected to raise the "downloaded
#    from the Internet" prompt; only a refusal is a failure, and the two share
#    an owner. Screenshots are evidence, not the test. ─────────────────────────
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

BLOCK=""; APPROVED=""; RUNNING=0; i=0
# Bounded by wall clock, not iterations: one full window-and-text walk is a
# round trip of seconds, so a fixed iteration count is not a known timeout.
LAUNCH_DEADLINE=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$LAUNCH_DEADLINE" ]; do
  sleep 1; i=$((i+1))
  [ "$i" = 2 ] && "$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/02-open-t2.png" >/dev/null 2>&1 || true
  [ "$i" = 5 ] && "$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/03-open-t5.png" >/dev/null 2>&1 || true
  SEEN=$(probe_dialogs "launch i=$i")
  case "$(vm_dialog_verdict "$SEEN")" in
    block)
      BLOCK="$SEEN"; break ;;
    prompt)
      WHO=$(dialog_click "downloaded from the Internet" Open)
      [ -n "$WHO" ] && APPROVED="$WHO"
      continue ;;
  esac
  # Anchored to the installed bundle's own executable directory: pgrep -x on a
  # guessed process name misses whenever CFBundleExecutable is not the bundle
  # name, and a bare bundle-path match would catch unrelated processes. Logged
  # every pass, because last time this probe's silence was indistinguishable
  # from the app genuinely not running and cost a whole rerun to not answer.
  if vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "pgrep -lf '$DEST_APP/Contents/MacOS/'" \
      >>"$VM_RUN_DIR/logs/liveness.log" 2>&1; then
    RUNNING=1; break
  fi
  printf '[%s] i=%s not running\n' "$(vm_now)" "$i" >> "$VM_RUN_DIR/logs/liveness.log"
done
"$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/04-settled.png" || true

# One line, so the ledger's reason column stays parseable.
flatten() { printf '%s' "$1" | tr '\n' ';' | cut -c1-280; }

if [ -n "$BLOCK" ]; then
  vm_phase_end launch fail "Gatekeeper refused it: $(flatten "$BLOCK")" "04-settled.png"
elif [ "$RUNNING" = 1 ] && [ -n "$APPROVED" ]; then
  vm_phase_end launch pass "no refusal; the expected notarized prompt appeared (owner: $APPROVED), was approved, and $APP_EXEC is running" "04-settled.png"
elif [ "$RUNNING" = 1 ]; then
  vm_phase_end launch pass "no dialog of any kind; $APP_EXEC is running" "04-settled.png"
else
  vm_phase_end launch fail "$APP_EXEC never started and nothing refused it; logs/dialogs.log names every window that appeared and logs/liveness.log what the process probe saw each pass" "04-settled.png"
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
