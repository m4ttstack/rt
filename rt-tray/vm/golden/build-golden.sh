#!/bin/bash
# Build mattstack-golden-<ver>[-xcode] from the cirruslabs vanilla or xcode image.
# Usage: build-golden.sh <14|15|26> [--xcode] [--dry-run] [--rebuild]
# ORCHESTRATOR/MATT: downloads ~25 GB per image; pauses once for manual TCC clicks.
set -euo pipefail
source "$(cd "$(dirname "$0")/.." && pwd)/lib/common.sh"

VER="${1:-}"; shift || true
[ -n "$VER" ] || vm_die "usage: build-golden.sh <14|15|26> [--xcode] [--dry-run] [--rebuild]"
DRY=0; REBUILD=0; XCODE=0
for a in "$@"; do case "$a" in --xcode) XCODE=1;; --dry-run) DRY=1;; --rebuild) REBUILD=1;; *) vm_die "unknown arg $a";; esac; done

# Asserted before anything expensive, because the pause this script cannot
# skip is 15 minutes downstream of here. Without a terminal on stdin the
# first `read` returns EOF, `set -e` exits, the EXIT trap kills the VM, and
# the whole build vanishes with no error printed at all... so the failure
# presents as "the window disappeared" rather than "nobody could answer the
# prompt". That cost a full provisioning cycle once.
if [ "$DRY" = 0 ] && [ ! -t 0 ]; then
  vm_die "no terminal on stdin, and this build pauses for manual clicks that only a human can make.
  Run it from a real terminal. In Claude Code that means typing it yourself with a leading ! rather
  than having the agent run it, and note that ! does NOT give a tty either... use a normal shell."
fi

FLAVOUR=cleanroom; [ "$XCODE" = 1 ] && FLAVOUR=xcuitest
IMAGE=$(vm_image_for "$VER" "$FLAVOUR"); FINAL=$(vm_golden_name "$VER" "$FLAVOUR")
# Built under a scratch name and only promoted once verify-golden.sh passes.
# Deleting the old one up front meant any failure after that point left the
# estate with no golden at all, and every script that clones it broken...
# which is exactly what a crash at the manual step did.
GOLDEN="$FINAL-building"
run() { if [ "$DRY" = 1 ]; then vm_log "[dry-run] $*"; else "$@"; fi; }

# A pause with no terminal to answer it is the failure this guards; each read
# says which prompt went unanswered instead of letting `set -e` exit mute.
pause() { read -r -p "$1" _ || vm_die "stdin closed while waiting: $1"; }

vm_log "golden: $FINAL (building as $GOLDEN) ← $IMAGE"
if [ "$DRY" = 0 ]; then
  vm_require_cmd tart "brew install openai/tools/tart   (old tap: cirruslabs/cli/tart)"
  vm_require_cmd sshpass "brew install cirruslabs/cli/sshpass"
  mkdir -p "$VM_CACHE" "$VM_ARTIFACTS"
  [ -f "$VM_SSH_KEY" ] || ssh-keygen -q -t ed25519 -N '' -C mattstack-vm -f "$VM_SSH_KEY"
  if tart list 2>/dev/null | awk '{print $2}' | grep -qx "$FINAL"; then
    [ "$REBUILD" = 1 ] || vm_die "$FINAL exists; pass --rebuild to replace it"
    vm_log "$FINAL stays in place until the new one verifies"
  fi
  # A previous run that died mid-build leaves this behind; it is scratch by
  # definition, so reclaim it rather than refuse to start.
  if tart list 2>/dev/null | awk '{print $2}' | grep -qx "$GOLDEN"; then
    vm_warn "removing a leftover $GOLDEN from an earlier interrupted build"
    tart stop "$GOLDEN" 2>/dev/null || true; tart delete "$GOLDEN"
  fi
fi

run tart clone "$IMAGE" "$GOLDEN"
run tart set "$GOLDEN" --cpu 4 --memory 8192 --display 1600x1000

if [ "$DRY" = 1 ]; then
  vm_log "[dry-run] would: tart run $GOLDEN (with graphics) → provision-guest.sh over ssh → pause for TCC clicks → verify-golden.sh → tart stop"
  exit 0
fi

tart run "$GOLDEN" --no-audio > "$VM_ARTIFACTS/$GOLDEN-tart.log" 2>&1 &
TART_PID=$!
trap 'kill $TART_PID 2>/dev/null || true' EXIT
vm_log "waiting for ssh as admin (password)…"
start=$(date +%s)
until vm_ssh_pw_try "$VM_ADMIN_USER" "$VM_ADMIN_PASS" "$GOLDEN" true 2>/dev/null; do
  [ $(( $(date +%s) - start )) -gt 600 ] && vm_die "ssh never came up"
  sleep 5
done

PUB=$(cat "$VM_SSH_KEY.pub")
vm_ssh_pw "$VM_ADMIN_USER" "$VM_ADMIN_PASS" "$GOLDEN" "cat > /tmp/provision-guest.sh" < "$VM_ROOT/golden/provision-guest.sh"
vm_ssh_pw "$VM_ADMIN_USER" "$VM_ADMIN_PASS" "$GOLDEN" "SKIP_CLEANROOM=$XCODE bash /tmp/provision-guest.sh '$VER' '$VM_TESTER_PASS' '$PUB'"

vm_log "rebooting into tester's auto-login session…"
vm_ssh_try "$VM_ADMIN_USER" "$GOLDEN" "sudo reboot" || true
sleep 20
vm_wait_ssh "$VM_TESTER_USER" "$GOLDEN" 600 || vm_die "tester ssh never came up after reboot"
vm_ssh_try "$VM_TESTER_USER" "$GOLDEN" "sysadminctl -screenLock off -password '$VM_TESTER_PASS'" || true

cat <<EOF

  ┌─ MANUAL STEP (once per golden) ─────────────────────────────────────────┐
  │ In the Tart window (logged in as tester):                                │
  │  1. System Settings → Privacy & Security → Accessibility → "+" →         │
  │     ⌘⇧G, add /usr/libexec/sshd-keygen-wrapper, then /usr/bin/osascript;  │
  │     toggle both ON (authenticate with admin / admin).                    │
  │  2. Privacy & Security → Security → "Allow applications from" →          │
  │     "App Store & Known Developers" (authenticate admin / admin).         │
  │     The image ships App-Store-only, which rejects notarized             │
  │     Developer ID apps — stricter than a real Mac's default.             │
  │  3. Back in this terminal press Enter; the script sends two osascripts   │
  │     over ssh — approve BOTH Automation prompts in the VM with OK:        │
  │     "…wants to control System Events" and "…wants to control Finder".    │
  │     Both are needed. Automation is granted per client-target pair, so    │
  │     approving one grants nothing for the other, and the missing Finder   │
  │     grant surfaces much later as a two-minute "AppleEvent timed out"     │
  │     that reads like a broken guest. A TCC prompt cannot be clicked by    │
  │     a script, so this is the only place it can be answered.              │
  └──────────────────────────────────────────────────────────────────────────┘
EOF
pause "  Press Enter after steps 1–2… "
vm_ssh_try "$VM_TESTER_USER" "$GOLDEN" 'osascript -e "tell application \"System Events\" to get name of first process whose frontmost is true"' || true
pause "  Approved the System Events prompt? Press Enter for the Finder one… "
vm_ssh_try "$VM_TESTER_USER" "$GOLDEN" 'osascript -e "tell application \"Finder\" to get name of home"' || true
pause "  Approved the Finder prompt? Press Enter to verify… "

"$VM_ROOT/golden/verify-golden.sh" "$VER" "$GOLDEN"
vm_log "stopping $GOLDEN (never run the golden again; clone it)"
tart stop "$GOLDEN"
wait $TART_PID 2>/dev/null || true
trap - EXIT

# Promoted only here, with a verified build in hand: until this line the old
# golden is still the one every other script clones.
if tart list 2>/dev/null | awk '{print $2}' | grep -qx "$FINAL"; then
  tart delete "$FINAL"
fi
tart rename "$GOLDEN" "$FINAL"
vm_log "golden $FINAL ready"
