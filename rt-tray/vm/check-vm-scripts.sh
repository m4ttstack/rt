#!/bin/bash
# Offline check of everything under rt-tray/vm: syntax, unit tests, dry-runs. No tart, no network.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
fails=0
t() { printf '  %-48s' "$1"; shift; if "$@" >/tmp/vmcheck.out 2>&1; then echo ok; else echo FAIL; sed 's/^/      /' /tmp/vmcheck.out | head -20; fails=$((fails+1)); fi; }
for f in lib/common.sh golden/*.sh run/*.sh run/guest/*.sh run/host/*.sh ../../scripts/e2e-cleanroom.sh check-vm-scripts.sh; do
  t "bash -n $f" bash -n "$f"
done
t "common.test.sh"               bash lib/__tests__/common.test.sh
t "appcast-server.test.ts"       bun test run/helpers/__tests__/appcast-server.test.ts
t "launchctl-print.test.ts"      bun test run/helpers/__tests__/launchctl-print.test.ts
t "catalog.test.ts"              bun test run/helpers/__tests__/catalog.test.ts
t "served-verdict.test.ts"       bun test run/helpers/__tests__/served-verdict.test.ts
t "served-apps-sh.test.ts"       bun test run/helpers/__tests__/served-apps-sh.test.ts
t "build-golden --dry-run"       bash golden/build-golden.sh 26 --dry-run
# A pause nobody can answer used to exit mute under set -e, killing the VM
# through the EXIT trap after 15 minutes of provisioning, with the failure
# presenting as "the window vanished". It must refuse before doing any work.
t "build-golden refuses without a tty" bash -c '
  out=$(bash golden/build-golden.sh 26 --rebuild < /dev/null 2>&1); rc=$?
  [ "$rc" -ne 0 ] && printf "%s" "$out" | grep -q "no terminal on stdin" \
    && ! printf "%s" "$out" | grep -q "clone"'
t "build-golden promotes only after verify" bash -c '
  build=$(grep -n "verify-golden.sh" golden/build-golden.sh | head -1 | cut -d: -f1)
  promote=$(grep -n "tart rename" golden/build-golden.sh | head -1 | cut -d: -f1)
  [ -n "$build" ] && [ -n "$promote" ] && [ "$build" -lt "$promote" ] \
    && grep -q "FINAL-building" golden/build-golden.sh'
t "verify-golden checks Finder automation separately" bash -c \
  'grep -qF "Finder automation allowed" golden/verify-golden.sh && grep -qF "to get name of home" golden/verify-golden.sh'
t "build-golden --xcode --dry-run selects the xcode image" bash -c \
  'out=$(bash golden/build-golden.sh 26 --xcode --dry-run 2>&1) && printf "%s" "$out" | grep -q "clone ghcr.io/cirruslabs/macos-tahoe-xcode:latest mattstack-golden-26-xcode"'
t "walkthrough --dry-run"        env VM_ARTIFACTS=/tmp/vmcheck-art bash run/walkthrough.sh --ver 26 --app ../mattstack.app --dry-run
t "walkthrough usage"            bash -c '! bash run/walkthrough.sh >/dev/null 2>&1'
t "walkthrough --fresh-team-repo --dry-run creates nothing" bash -c \
  'out=$(env VM_ARTIFACTS=/tmp/vmcheck-art bash run/walkthrough.sh --ver 26 --app ../mattstack.app --fresh-team-repo --dry-run 2>&1) && ! printf "%s" "$out" | grep -q "unknown arg"'
t "walkthrough --fresh-team-repo refuses join" bash -c \
  '! env VM_ARTIFACTS=/tmp/vmcheck-art bash run/walkthrough.sh --ver 26 --app ../mattstack.app --scenario join --fresh-team-repo --dry-run >/dev/null 2>&1'
t "xcuitest.sh usage (missing args)" bash -c \
  'out=$(bash run/xcuitest.sh 2>&1); rc=$?; [ "$rc" -ne 0 ] && printf "%s" "$out" | grep -q "usage: xcuitest.sh"'
# --ver 99 keeps this deterministic: no ghcr image maps to 99, so no real -xcode golden can
# ever exist for it, and the gate must skip on every host regardless of Xcode/project.yml state.
t "xcuitest.sh gates clean without a built -xcode golden" bash -c '
  rm -rf /tmp/vmcheck-xcui-art; touch /tmp/vmcheck-xcui.dmg
  out=$(env VM_ARTIFACTS=/tmp/vmcheck-xcui-art bash run/xcuitest.sh --ver 99 --dmg /tmp/vmcheck-xcui.dmg 2>&1); rc=$?
  rm -rf /tmp/vmcheck-xcui-art /tmp/vmcheck-xcui.dmg
  [ "$rc" -eq 0 ] && printf "%s" "$out" | grep -q "gate skipped:"
'
t "team-setup status (no pat)"   env MATTSTACK_VMTEST_PAT= bash run/team-setup.sh status
t "team-setup invite stub (no gh, no pat)" env PATH="/usr/bin:/bin" MATTSTACK_VMTEST_PAT= bash run/team-setup.sh invite --handle vmcheck --out /tmp/vmcheck-invite.txt
t "team-setup reset refuses non-vmtest org"  bash -c '! env MATTSTACK_VMTEST_PAT=x MATTSTACK_VMTEST_ORG=someorg MATTSTACK_VMTEST_ORG_CONFIRM= bash run/team-setup.sh reset >/dev/null 2>&1'
t "team-setup reset guard message names CONFIRM" bash -c 'env MATTSTACK_VMTEST_PAT=x MATTSTACK_VMTEST_ORG=someorg bash run/team-setup.sh reset 2>&1 | grep -q MATTSTACK_VMTEST_ORG_CONFIRM'
t "second-user create"           bash run/second-user.sh create

mkdir -p /tmp/vmcheck-ax/in /tmp/vmcheck-ax/logs
printf '{"graphics":0}\n' > /tmp/vmcheck-ax/in/params.json
t "ax.sh refuses when GUEST_RUN unmounted"        bash -c '! (env -u GUEST_RUN AX_APP=x bash run/guest/ax.sh >/dev/null 2>&1)'

# dialogs.sh is never RUN here, only compiled. Its whole job is to enumerate
# every window on screen, so executing it on the host would walk the
# operator's own desktop: slow, and an assertion whose answer depends on which
# apps happen to be open. Substituting an ax_osa that prints instead of
# executes turns the same code path into a deterministic parse check, and
# osascript exits 1 on a compile error and a runtime miss alike, so nothing
# short of a real compile distinguishes an AppleScript that never parsed.
mkdir -p /tmp/vmcheck-dlg/in/guest /tmp/vmcheck-dlg/logs
printf '%s\n' 'ax_osa() { printf "%s" "$1"; }' 'ax_admin_auth_once() { return 1; }' > /tmp/vmcheck-dlg/in/guest/ax.sh
t "dialogs.sh refuses when GUEST_RUN unmounted"   bash -c 'out=$(env -u GUEST_RUN bash run/guest/dialogs.sh dump 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "is not mounted"'
t "dialogs.sh rejects an unknown subcommand"      bash -c '! (env GUEST_RUN=/tmp/vmcheck-dlg bash run/guest/dialogs.sh bogus >/dev/null 2>&1)'
t "dialogs.sh AppleScript compiles"               bash -c '
  env GUEST_RUN=/tmp/vmcheck-dlg bash run/guest/dialogs.sh dump > /tmp/vmcheck-dlg/dump.applescript || exit 1
  env GUEST_RUN=/tmp/vmcheck-dlg bash run/guest/dialogs.sh click "downloaded from the Internet" Open > /tmp/vmcheck-dlg/click.applescript || exit 1
  for sub in dump click; do
    osacompile -o "/tmp/vmcheck-dlg/$sub.scpt" "/tmp/vmcheck-dlg/$sub.applescript" || exit 1
  done'
t "dialogs.sh calls helpers ax.sh defines"        bash -c 'grep -q "^ax_osa()" run/guest/ax.sh && grep -q "^ax_admin_auth_once()" run/guest/ax.sh'
t "dialogs.sh click needs both arguments"         bash -c '! (env GUEST_RUN=/tmp/vmcheck-dlg bash run/guest/dialogs.sh click "only one" >/dev/null 2>&1)'
# The harness never deletes anything in the guest, and the button sits right
# beside the one the control phase means to click.
t "dialogs.sh refuses a destructive button"       bash -c '
  out=$(env GUEST_RUN=/tmp/vmcheck-dlg bash run/guest/dialogs.sh click "anything" "Move to Trash" 2>&1); rc=$?
  [ "$rc" -eq 2 ] && printf "%s" "$out" | grep -q "refusing to click a destructive button"'

t "gatekeeper-check usage (no artifact)"          bash -c \
  'out=$(bash run/gatekeeper-check.sh 2>&1); rc=$?; [ "$rc" -ne 0 ] && printf "%s" "$out" | grep -q "usage: gatekeeper-check.sh"'
t "gatekeeper-check --dmg and --app are exclusive" bash -c \
  '! bash run/gatekeeper-check.sh --dmg /tmp/x.dmg --app /tmp/x.app >/dev/null 2>&1'
t "gatekeeper-check --dry-run"                    env VM_ARTIFACTS=/tmp/vmcheck-art bash run/gatekeeper-check.sh --app ../mattstack.app --dry-run
t "gatekeeper-check judges dialogs by text, not owner" bash -c \
  '! grep -q "windows of process .CoreServicesUIAgent" run/gatekeeper-check.sh && grep -q "vm_dialog_verdict" run/gatekeeper-check.sh'
# The control has to run before the real launch and has to be able to fail the
# run, or it is decoration: a probe that cannot produce a refusal makes every
# clean result meaningless, which is the defect this whole phase answers.
# A script-backed bundle never reaches Gatekeeper: LaunchServices finds no
# native code and offers Rosetta instead, so the control failed for a reason
# unrelated to the probe. And spctl is asked BEFORE the launch so an accepted
# fixture reports as a broken fixture, not as a blind probe.
t "gatekeeper-check control app is a real Mach-O" bash -c \
  '! grep -q "printf .#!/bin/bash" run/gatekeeper-check.sh && grep -qF "cp /bin/sleep" run/gatekeeper-check.sh'
t "gatekeeper-check asserts the fixture is rejected before launching it" bash -c '
  ctrl=$(grep -n CTRL_APP run/gatekeeper-check.sh)
  assess=$(printf "%s\n" "$ctrl" | grep -F "spctl --assess" | head -1 | cut -d: -f1)
  open=$(printf "%s\n" "$ctrl" | grep -F "open POSIX file" | head -1 | cut -d: -f1)
  [ -n "$assess" ] && [ -n "$open" ] && [ "$assess" -lt "$open" ] \
    && grep -qF "not a valid known-bad fixture" run/gatekeeper-check.sh'
t "setup assistant suppressed per-run and in provisioning" bash -c \
  'grep -q "^vm_dismiss_setup_assistant()" lib/common.sh \
   && grep -q "vm_dismiss_setup_assistant" run/gatekeeper-check.sh \
   && grep -q "vm_dismiss_setup_assistant" run/walkthrough.sh \
   && grep -q "DidSeeCloudSetup" golden/provision-guest.sh'
t "gatekeeper-check proves the probe on a known-bad app first" bash -c '
  ctrl=$(grep -n "vm_phase_begin control" run/gatekeeper-check.sh | cut -d: -f1)
  launch=$(grep -n "vm_phase_begin launch" run/gatekeeper-check.sh | cut -d: -f1)
  [ -n "$ctrl" ] && [ -n "$launch" ] && [ "$ctrl" -lt "$launch" ] \
    && grep -q "vm_phase_end control fail" run/gatekeeper-check.sh'
t "gatekeeper-check bounds the backgrounded copy" bash -c \
  'grep -q "killed it so the run reports instead of hanging" run/gatekeeper-check.sh'
t "gatekeeper-check answers the automation consent prompt" bash -c \
  'grep -q "wants access to control" run/gatekeeper-check.sh'
# The "no syntax error" half of this assertion is load-bearing, not decoration: osascript exits 1
# on both a clean "not found" runtime error and a broken-script compile error alike, so an
# exit-code-only check can green-light a walk() AppleScript that never even compiles.
t "ax.sh sources + fails clean against no app"    env GUEST_RUN=/tmp/vmcheck-ax AX_APP=definitely-not-running bash -c 'source run/guest/ax.sh && ! ax_wait_window x 1 && ! ax_find setup.welcome.screen >/dev/null 2>&1 && ! ax_wait_screen welcome 1 && ! grep -qi "script error\|Expected \|syntax error" "$AX_LOG"'
t "ax_shot skips instantly under --no-graphics"   env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x bash -c 'source run/guest/ax.sh; s=$SECONDS; ax_shot probe >/dev/null; [ $((SECONDS-s)) -le 3 ] && grep -q "skipped (--no-graphics)" "$AX_LOG"'
# On a host there is no SecurityAgent process, so this probe pays its full
# osascript-miss cost (measured 3.26-3.28s across three runs here) instead of
# the sub-second hit it gets in a guest with a real dialog up. $SECONDS only
# has whole-second resolution, so a 3s bound flipped pass/fail on which side
# of the tick boundary the miss happened to land -- millisecond timing plus
# 10s of headroom still catches a genuine hang without being a coin flip.
t "ax_admin_auth_once returns fast with no SecurityAgent" env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x bash -c 'source run/guest/ax.sh; s=$SECONDS; ax_admin_auth_once; rc=$?; [ "$rc" -eq 1 ] && [ $((SECONDS-s)) -le 10 ]'
t "ax_set_field escapes an embedded quote/backslash" env GUEST_RUN=/tmp/vmcheck-ax AX_APP=definitely-not-running bash -c 'source run/guest/ax.sh; ( ax_set_field setup.team.create.name "weird\"value\\here" ) 2>/dev/null; [ $? -eq 1 ] && ! grep -qi "script error\|Expected \|syntax error" "$AX_LOG"'
t "ax finish-gate helpers source + fail clean against no app" env GUEST_RUN=/tmp/vmcheck-ax AX_APP=definitely-not-running bash -c 'source run/guest/ax.sh && declare -F ax_enabled ax_wait_enabled ax_wait_text ax_click_sheet_button ax_find_sheet_id ax_click_sheet_id >/dev/null && ! ax_enabled x >/dev/null 2>&1 && ! ax_wait_enabled x 1 && ! ax_wait_text "Skip the Fast Browser extension?" 1 && ! ax_click_sheet_button "Skip for now" && ! ax_find_sheet_id x >/dev/null 2>&1 && ! ax_click_sheet_id x >/dev/null 2>&1 && ! grep -qi "script error\|Expected \|syntax error" "$AX_LOG"'
t "drive-setup.sh drives Skip for now by its wording"   bash -c 'grep -q "ax_click_sheet_button \"Skip for now\"" run/guest/drive-setup.sh && grep -q "Skip the Fast Browser extension?" run/guest/drive-setup.sh'
t "drive-setup.sh probes the Still to do row by its .status id, not the bare row id" bash -c \
  'grep -q "setup.done.stillToDo.tool.fast-browser-extension.status" run/guest/drive-setup.sh'
t "drive-setup.sh records the finish-gate outcome"      bash -c 'grep -q "finish-gate.txt" run/guest/drive-setup.sh && grep -q "finish-gate.txt" run/guest/assert-installed.sh'
t "drive-setup.sh waits for the Done gate to settle before branching" bash -c 'grep -q "ax_wait_done_gate 60" run/guest/drive-setup.sh && grep -q "^ax_wait_done_gate()" run/guest/ax.sh'
# Every finish-gated row is probed and handled by its own .action id; neither
# row may be inferred from the other or from the section merely showing --
# a VM guest with only the writing-style row (no Chrome) must not fail on a
# missing Fast Browser row the way the old unconditional ax_fail did.
t "drive-setup.sh probes each finish-gated row by its own .action id" bash -c \
  'grep -q "setup.done.beforeYouFinish.tool.fast-browser-extension.action" run/guest/drive-setup.sh \
   && grep -q "setup.done.beforeYouFinish.skills.writing-style.action" run/guest/drive-setup.sh'
t "drive-setup.sh never requires the Fast Browser row just because the section shows" bash -c \
  '! grep -q "Before you finish is shown without the extension row" run/guest/drive-setup.sh'
t "drive-setup.sh takes the writing-style row through the choose sheet by option id" bash -c \
  'grep -q "ax_click_sheet_id \"setup.choose.option.\$style\"" run/guest/drive-setup.sh \
   && grep -q "ax_click_sheet_id setup.choose.submit" run/guest/drive-setup.sh'
t "ax.sh gained sheet-scoped AXIdentifier helpers alongside ax_click_sheet_button" bash -c \
  'grep -q "^ax_find_sheet_id()" run/guest/ax.sh && grep -q "^ax_click_sheet_id()" run/guest/ax.sh'
t "ax_wait_done_gate also settles on a finish-gated row's own .action id, not just the section or Finish" bash -c \
  'grep -q "ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action" run/guest/ax.sh \
   && grep -q "ax_find setup.done.beforeYouFinish.skills.writing-style.action" run/guest/ax.sh'
t "ax.sh gained a bounded sheet-content wait, not a one-shot check" bash -c \
  'grep -q "^ax_wait_sheet_id()" run/guest/ax.sh'
t "ax.sh gained sheet-scoped enabled helpers so a driver can wait before clicking a sheet button" bash -c \
  'grep -q "^ax_enabled_sheet()" run/guest/ax.sh && grep -q "^ax_wait_sheet_enabled()" run/guest/ax.sh'
t "drive-setup.sh waits for the sheet with a bounded poll before looking for the option" bash -c \
  'grep -q "ax_wait_sheet_id \"setup.choose.option.\$style\"" run/guest/drive-setup.sh'
t "drive-setup.sh waits for Use this style to enable before clicking it" bash -c \
  'grep -q "ax_wait_sheet_enabled setup.choose.submit" run/guest/drive-setup.sh'
t "assert-installed.sh parses finish-gate.txt's per-row line format, not just skipped/open" bash -c \
  'grep -q "fast-browser-extension=skipped" run/guest/assert-installed.sh \
   && grep -q "writing-style=" run/guest/assert-installed.sh \
   && grep -q "writing-style show --json" run/guest/assert-installed.sh'
t "assert-installed.sh asserts setup.waived is empty when no fast-browser-extension=skipped line is present" bash -c \
  'grep -q "was not skipped on the Done screen but setup.waived holds the id" run/guest/assert-installed.sh'
t "ax_enabled_or_fail names a missing axid"             env GUEST_RUN=/tmp/vmcheck-ax AX_APP=definitely-not-running bash -c 'source run/guest/ax.sh; out=$( (ax_enabled_or_fail setup.done.continue) 2>&1 ); [ $? -ne 0 ] && printf "%s" "$out" | grep -q "setup.done.continue not found"'
t "assert-installed.sh asserts setup.waived"            bash -c 'grep -q "rt settings get setup.waived --json" run/guest/assert-installed.sh'
t "assert-installed.sh takes a backup and asserts the .age plus the LFS filter" bash -c \
  'grep -q "rt state backup init" run/guest/assert-installed.sh && grep -q "state-backups" run/guest/assert-installed.sh && grep -q "filter.lfs.process" run/guest/assert-installed.sh'
t "assert-team.sh asserts requiredMissing is empty, naming the row + detail" bash -c \
  'grep -q "requiredMissing\[\]?" run/guest/assert-team.sh && grep -q "requiredMissing: \$id" run/guest/assert-team.sh'
t "kitchen-sink fixture declares slack + switchboard, matching accounts.ts" bash -c \
  'jq -e ".\"mattstack.integrations\".slack.clientId and .\"mattstack.integrations\".switchboard.url" fixtures/team-kitchen-sink/settings.team.json >/dev/null \
   && grep -q "clientId" ../../lib/setup/validators/accounts.ts && grep -q "switchboard" ../../lib/setup/validators/accounts.ts'
t "assert-installed.sh asserts tool.fast-browser ready and times doctor --json" bash -c \
  'grep -q "tool.fast-browser\")" run/guest/assert-installed.sh && grep -q "fastbrowser-doctor.json" run/guest/assert-installed.sh && grep -q "elapsed}s" run/guest/assert-installed.sh'
t "assert-installed.sh asserts state.db user_version, honestly uncompared" bash -c \
  'grep -q "PRAGMA user_version" run/guest/assert-installed.sh && grep -q "rt exposes no CLI/daemon surface for SCHEMA_VERSION" run/guest/assert-installed.sh'
t "assert-installed.sh checks the daemon plist PATH and the three backup tools" bash -c \
  'grep -q "Library/LaunchAgents/com.mattstack.daemon.plist" run/guest/assert-installed.sh && grep -q "for tool in age zstd git-lfs" run/guest/assert-installed.sh'
t "team-setup.sh invite asserts forgeAccess, failing on skipped" bash -c \
  'grep -q "forgeAccess" run/team-setup.sh && grep -q "forge access was skipped" run/team-setup.sh'
t "drive-setup.sh refuses when GUEST_RUN unmounted" bash -c '! (env -u GUEST_RUN AX_APP=x bash run/guest/drive-setup.sh create >/dev/null 2>&1)'
t "drive-setup.sh rejects unknown scenario"       bash -c '! (env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x bash run/guest/drive-setup.sh bogus >/dev/null 2>&1)'
t "drive-setup.sh rejects unknown forge"          bash -c '! (env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x bash run/guest/drive-setup.sh create --forge bitbucket >/dev/null 2>&1)'
t "drive-setup.sh derives gitlab from the remote" bash -c 'env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x TEAM_REMOTE=https://gitlab.com/g/r.git bash run/guest/drive-setup.sh create 2>&1 | grep -q "forge=gitlab"'
t "drive-setup.sh rejects unknown flag"           bash -c '! (env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x bash run/guest/drive-setup.sh create --nope >/dev/null 2>&1)'
t "walkthrough --decline-trust --dry-run"         env VM_ARTIFACTS=/tmp/vmcheck-art bash run/walkthrough.sh --ver 26 --app ../mattstack.app --decline-trust --dry-run
t "walkthrough --decline-trust refuses headless"  bash -c \
  '! env VM_ARTIFACTS=/tmp/vmcheck-art bash run/walkthrough.sh --ver 26 --app ../mattstack.app --scenario headless --decline-trust --dry-run >/dev/null 2>&1'
# The declining branch must be as fast as the answering one: screen_install
# polls this every couple of seconds for the whole install. Same host-vs-guest
# timing note as the no-SecurityAgent check above applies here too.
t "ax_admin_auth_once returns fast when declining" env GUEST_RUN=/tmp/vmcheck-ax AX_APP=x AX_TRUST_DECLINE=1 bash -c 'source run/guest/ax.sh; s=$SECONDS; ax_admin_auth_once; rc=$?; [ "$rc" -eq 1 ] && [ $((SECONDS-s)) -le 10 ]'
t "assert-installed.sh takes --expect-untrusted"  bash -c 'grep -q -- "--expect-untrusted" run/guest/assert-installed.sh'
t "drive-setup.sh answers repos.root before Continue" bash -c 'grep -q "setup repo-root set" run/guest/drive-setup.sh'
t "drive-setup.sh rechecks after setting the root"    bash -c 'grep -q "setup.checklist.recheck" run/guest/drive-setup.sh'
t "assert-installed.sh handles repos.root absent"     bash -c 'grep -q "repos.root" run/guest/assert-installed.sh'


rm -rf /tmp/vmcheck-tu
mkdir -p /tmp/vmcheck-tu/upd
: > /tmp/vmcheck-tu/upd/appcast.xml
t "trigger-update.sh usage (no update-dir)"       bash -c 'out=$(GUEST_RUN=/tmp/vmcheck-ax bash run/guest/trigger-update.sh /nonexistent 1.2.3 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "^usage: trigger-update.sh"'
t "trigger-update.sh usage (appcast-server missing/not executable)" bash -c 'out=$(GUEST_RUN=/tmp/vmcheck-ax bash run/guest/trigger-update.sh /tmp/vmcheck-tu/upd 1.2.3 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "^usage: trigger-update.sh"'
touch /tmp/vmcheck-tu/upd/appcast-server; chmod +x /tmp/vmcheck-tu/upd/appcast-server
t "trigger-update.sh usage (missing new-version arg)" bash -c 'out=$(GUEST_RUN=/tmp/vmcheck-ax bash run/guest/trigger-update.sh /tmp/vmcheck-tu/upd 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "^usage: trigger-update.sh"'
t "trigger-update.sh usage (malformed new-version)" bash -c 'out=$(GUEST_RUN=/tmp/vmcheck-ax bash run/guest/trigger-update.sh /tmp/vmcheck-tu/upd 2.9 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "^usage: trigger-update.sh"'
t "trigger-update.sh ax.sh mount guard actually aborts" bash -c 'out=$(env GUEST_RUN=/tmp/vmcheck-tu-nonexistent bash run/guest/trigger-update.sh /tmp/vmcheck-tu/upd 1.2.3 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "is not mounted" && ! printf "%s" "$out" | grep -q ASSERT'

t "e2e-cleanroom usage"          bash -c '! bash ../../scripts/e2e-cleanroom.sh >/dev/null 2>&1'
t "winid compiles"               swiftc -O -o /tmp/vmcheck-winid run/host/winid.swift
t "appcast-server compiles"      bun build --compile run/helpers/appcast-server.ts --outfile /tmp/vmcheck-appcast
rm -rf /tmp/vmcheck-art /tmp/vmcheck-winid /tmp/vmcheck-appcast /tmp/vmcheck.out /tmp/vmcheck-invite.txt /tmp/vmcheck-ax /tmp/vmcheck-tu /tmp/vmcheck-tu-nonexistent
echo; [ "$fails" -eq 0 ] && echo "  all vm checks ok" || { echo "  $fails check(s) failed"; exit 1; }
