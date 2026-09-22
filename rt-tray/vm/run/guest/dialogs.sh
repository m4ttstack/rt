#!/bin/bash
# Names every window on screen, and answers the prompts a first launch raises.
# Run inside the guest:
#   dialogs.sh dump                  every process with windows, its titles, its text
#   dialogs.sh click <text> <button> click <button> in the window whose text contains <text>
#   dialogs.sh admin                 answer a SecurityAgent credentials prompt, if one is up
#
# Identifying a dialog by its owning process was wrong twice over. The macOS 26
# Gatekeeper prompt is not a CoreServicesUIAgent window, so a probe keyed on
# that owner can only ever answer "no dialog": it cannot fail. And the benign
# notarized prompt shares an owner with a real refusal, so even a working
# owner-probe cannot tell an expected prompt from a block. The wording can.
set -uo pipefail
GUEST_RUN="${GUEST_RUN:-/Volumes/My Shared Files/run}"
# Asserted here rather than left to ax.sh: ax.sh's own guard `return`s when it
# is sourced, so without this the script would carry on to call helpers that
# were never defined and fail as "command not found" instead of saying why.
[ -d "$GUEST_RUN" ] || { printf 'dialogs.sh: %s is not mounted -- this must run against a guest\n' "$GUEST_RUN" >&2; exit 1; }
# shellcheck source=/dev/null
source "$GUEST_RUN/in/guest/ax.sh"

# Recursive because a modern alert nests its text inside groups; a flat
# `every static text of w` returns nothing on exactly the dialogs that matter.
DIALOGS_WALK="
using terms from application \"System Events\"
  on walkTexts(el, acc)
    try
      if (class of el) is static text then set end of acc to (value of el as text)
    end try
    try
      repeat with c in UI elements of el
        my walkTexts(c, acc)
      end repeat
    end try
  end walkTexts
  on findButton(el, wanted)
    try
      if (class of el) is button and (name of el as text) is wanted then return el
    end try
    try
      repeat with c in UI elements of el
        set r to my findButton(c, wanted)
        if r is not missing value then return r
      end repeat
    end try
    return missing value
  end findButton
end using terms from
"

# One line per window: "process || window title || every string it shows".
# `every application process`, not the visible ones: the agents that own system
# dialogs are background processes and never appear in a visible-only list.
dialogs_dump() {
  ax_osa "$DIALOGS_WALK
tell application \"System Events\"
  set out to {}
  repeat with p in (every application process)
    set n to 0
    try
      set n to count of windows of p
    end try
    if n > 0 then
      repeat with w in (every window of p)
        set acc to {}
        my walkTexts(w, acc)
        set AppleScript's text item delimiters to \" / \"
        set body to acc as text
        set wn to \"\"
        try
          set wn to name of w as text
        end try
        set end of out to (name of p as text) & \" || \" & wn & \" || \" & body
      end repeat
    end if
  end repeat
  set AppleScript's text item delimiters to linefeed
  return out as text
end tell"
}

# Clicks <button> in the first window whose text contains <needle>, and prints
# the owning process. Prints nothing when no such window is up, so a caller can
# tell "answered" from "nothing to answer" without reading an exit code.
#
# Matched on wording rather than owner for the same reason the classifier is:
# the caller knows which dialog it means, not which agent happens to own it.
dialogs_click() {
  local needle button
  needle=$(ax_esc "$1"); button=$(ax_esc "$2")
  # A refusal dialog offers "Move to Trash" beside its dismiss button, and a
  # mis-typed caller must not be able to reach it: this harness never deletes
  # anything in the guest, and a control app it destroyed would fail the NEXT
  # run with a missing fixture rather than here.
  case "$2" in
    "Move to Trash"|"Delete"|"Move to Bin")
      printf 'dialogs.sh: refusing to click a destructive button (%s)\n' "$2" >&2; return 2 ;;
  esac
  ax_osa "$DIALOGS_WALK
tell application \"System Events\"
  repeat with p in (every application process)
    set n to 0
    try
      set n to count of windows of p
    end try
    if n > 0 then
      repeat with w in (every window of p)
        set acc to {}
        my walkTexts(w, acc)
        set AppleScript's text item delimiters to \" / \"
        set body to acc as text
        if body contains \"$needle\" then
          set b to my findButton(w, \"$button\")
          if b is not missing value then
            try
              set frontmost of p to true
            end try
            click b
            return (name of p as text)
          end if
        end if
      end repeat
    end if
  end repeat
  return \"\"
end tell"
}

case "${1:-dump}" in
  dump)  dialogs_dump ;;
  click) [ $# -eq 3 ] || { printf 'usage: dialogs.sh click <text> <button>\n' >&2; exit 2; }
         dialogs_click "$2" "$3" ;;
  admin) ax_admin_auth_once && echo answered ;;
  *)     printf 'usage: dialogs.sh [dump|click <text> <button>|admin]\n' >&2; exit 2 ;;
esac
