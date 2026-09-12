#!/bin/sh
# PreToolUse hook, matcher AskUserQuestion (docs/superpowers/specs/
# 2026-09-11-executor-reconciler-design.md "AskUserQuestion hook"). Every
# `rt agent` launch stamps RT_AGENT_ID, RT_GATE_SUBJECT, RT_DAEMON_SOCK into
# this hook's env; RT_DAEMON_SOCK reaches `rt` itself by plain inheritance
# (packages/rt-client/src/transport.ts honors it).
#
# Decision order: daemon unreachable -> allow (degraded mode stays legal);
# an open or parked gate already exists for the subject -> allow (that is
# the wrapper's native-form face of a real gate); otherwise -> deny, so an
# improvised fork must become a gate instead.
set -u

# Claude Code sends the tool-call payload on stdin; the decision never reads
# it, but leaving it undrained can block the caller on a full pipe.
cat >/dev/null 2>&1

allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
}

deny() {
  # The two backslash-quote pairs put a literal `"` around the subject in
  # the decoded JSON string; RT_GATE_SUBJECT itself is escaped first so an
  # embedded quote or backslash can never break out of the JSON string.
  esc_subject=$(printf '%s' "$RT_GATE_SUBJECT" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  # shellcheck disable=SC2016 # %s is a printf format spec, not a shell expansion
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocking forks go through the gate protocol: run `rt gate open --subject \\"%s\\" --kind <scope> --questions <json>` and wait per the gate protocol skill, instead of AskUserQuestion."}}\n' "$esc_subject"
  exit 0
}

command -v rt >/dev/null 2>&1 || allow
[ -n "${RT_GATE_SUBJECT:-}" ] || allow

# `timeout`/`gtimeout` aren't guaranteed (BSD/macOS ships neither by
# default); fall back to no wrapper rather than hand-rolling a POSIX sh
# watchdog -- `rt gate list` already carries its own daemon-request timeout.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

if [ -n "$TIMEOUT_BIN" ]; then
  gates_json=$("$TIMEOUT_BIN" 5 rt gate list --subject-prefix "$RT_GATE_SUBJECT" 2>/dev/null) || allow
else
  gates_json=$(rt gate list --subject-prefix "$RT_GATE_SUBJECT" 2>/dev/null) || allow
fi
[ -n "$gates_json" ] || allow

# `rt gate list` has no exact-subject filter, only a prefix one, so a
# same-prefix sibling subject (e.g. "mr:1" vs "mr:10") can share this
# payload. Split gate ROWS onto their own line before grepping so a
# sibling's status can never be attributed to this subject's gate. Anchor
# the split on `{"id":"...","subject":` (a gate row's own first two
# fields, in that order) rather than on every `},{` boundary: a multi-
# question gate's own questions/options arrays contain `},{` boundaries
# of their own (and each question object starts with its own "id" field
# too), so splitting there would land a row's subject and status on
# different lines and misread every multi-question gate as unanswerable.
gate_lines=$(printf '%s' "$gates_json" | awk '{gsub(/\{"id":"[^"]*","subject":/, "\n&"); print}')
subject_lines=$(printf '%s\n' "$gate_lines" | grep -F "\"subject\":\"$RT_GATE_SUBJECT\"")

printf '%s\n' "$subject_lines" | grep -Eq '"status":"(open|parked)"' && allow
deny
