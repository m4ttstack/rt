#!/bin/sh
# PreToolUse hook, matcher AskUserQuestion (docs/superpowers/specs/
# 2026-09-11-executor-reconciler-design.md "AskUserQuestion hook"). Every
# `rt agent` launch stamps RT_AGENT_ID, RT_GATE_SUBJECT, RT_DAEMON_SOCK into
# this hook's env; RT_DAEMON_SOCK reaches `rt` itself by plain inheritance
# (packages/rt-client/src/transport.ts honors it).
#
# The decision is `rt gate fork-check`'s, made daemon-side with the subject
# resolver `rt gate ask` files gates under, so the two cannot drift apart.
# This wrapper only keeps the fallbacks that must hold when rt cannot give a
# verdict at all: no rt, a crash, or an rt that predates the verb all allow
# (degraded mode stays legal).
set -u

allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
  exit 0
}

# Read the whole payload before any exit path: leaving stdin undrained can
# block Claude Code on a full pipe.
payload=$(cat 2>/dev/null)

command -v rt >/dev/null 2>&1 || allow

decision=$(printf '%s' "$payload" | rt gate fork-check 2>/dev/null) || allow
case "$decision" in
  '{"hookSpecificOutput":'*) printf '%s\n' "$decision" ;;
  *) allow ;;
esac
