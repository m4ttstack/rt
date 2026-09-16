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

# One JSON string escaper for both consumers: the deny payload (where a raw
# control character is invalid JSON) and the grep -F patterns (where a raw
# newline splits one pattern into two, so a sibling subject's row can answer
# for this one, and where a raw tab can never match the payload's own `\t`).
# awk, not sed: BSD sed reads `\t` in a pattern as a literal `t`.
json_escape() {
  printf '%s' "$1" | awk '
    {
      gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r");
      if (NR > 1) printf "\\n";
      printf "%s", $0
    }'
}

deny() {
  # The two backslash-quote pairs put a literal `"` around the subject in
  # the decoded JSON string; RT_GATE_SUBJECT itself is escaped first so an
  # embedded quote, backslash, or control character can never break out of
  # the JSON string.
  esc_subject=$(json_escape "$RT_GATE_SUBJECT")
  # shellcheck disable=SC2016 # %s is a printf format spec, not a shell expansion
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocking forks go through the gate protocol: run `rt gate ask --questions <json>` (the daemon resolves this pane'\''s subject on its own; this pane'\''s recorded subject is \\"%s\\"; add --context for the decision material), then background `rt gate wait <id>` per the gate protocol skill, instead of AskUserQuestion."}}\n' "$esc_subject"
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
subject_lines=$(printf '%s\n' "$gate_lines" | grep -F "\"subject\":\"$(json_escape "$RT_GATE_SUBJECT")\"")

printf '%s\n' "$subject_lines" | grep -Eq '"status":"(open|parked)"' && allow

# A pipeline gate opened by a run in THIS worktree is this worker's own
# gate under a run: subject the exact-subject check cannot see (RT-162
# finding 2). Same row-split discipline as above; worktree matching is
# exact-string on the JSON-escaped cwd, checked for both $PWD and the
# physical pwd so a symlinked worktree path still matches.
#
# The match is per-worktree, not per-caller, on purpose: any pane in a tree
# with an open run gate inherits this allow. Narrowing it to the gate's own
# origin.paneId would deny a relaunched pane whose gate still carries the
# pane id it had before the relaunch, and this hook degrades to allow
# everywhere else it cannot verify something.
if [ -n "$TIMEOUT_BIN" ]; then
  run_json=$("$TIMEOUT_BIN" 5 rt gate list --subject-prefix "run:" --open 2>/dev/null) || allow
else
  run_json=$(rt gate list --subject-prefix "run:" --open 2>/dev/null) || allow
fi
# Empty output is unverifiable, and unverifiable degrades to allow, the
# same posture as the first list branch ([ -n "$gates_json" ] || allow).
# A daemon that really has zero run gates prints a non-empty envelope
# ({"ok":true,"gates":[],"cursor":0}), which correctly falls through.
[ -n "$run_json" ] || allow
# --open is a server-side status=open filter (not "unanswered, unparked" as
# a whole -- parked rows are excluded), so a parked run gate never appears
# here and cannot allow through this branch: it is deliberately not-live,
# the same contract a form-presentation gate enforces. The owner resumes
# the pane first. This also keeps the page under the daemon's un-flagged
# list cap (500 rows, oldest first): --open bounds it to the live count
# instead of the whole run: history, which would otherwise grow past the
# cap and silently stop seeing the newest (live) row.
run_lines=$(printf '%s' "$run_json" | awk '{gsub(/\{"id":"[^"]*","subject":/, "\n&"); print}')
for dir in "$PWD" "$(pwd -P)"; do
  esc_dir=$(json_escape "$dir")
  printf '%s\n' "$run_lines" | grep -F "\"worktree\":\"$esc_dir\"" | grep -Eq '"status":"open"' && allow
done

deny
