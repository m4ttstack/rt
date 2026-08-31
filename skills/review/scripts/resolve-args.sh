#!/bin/sh
# resolve-args.sh -- resolve this parameterized skill's slot bindings.
#
# Contract v1 (authoritative copy: references/convention.md in the
# parameterized-skills skill):
#   Invoke: "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh" [options]
#   Options:
#     --manifest <path>         bindings manifest; default: nearest
#                               .mattstack/skills.jsonc walking up from PWD,
#                               then $HOME/.mattstack/skills.jsonc
#     --skills-dir <path>       installed-skills dir; default ~/.claude/skills
#     --plugin-list-cmd <cmd>   space-splittable command printing
#                               `claude plugin list --json` output
#   Exit 0: {"ok":true,"skill":<name>,"resolved":{<slot>:{binding,contract,source,path}}}
#           (unbound optional slot: {<slot>:{"binding":null}})
#   Exit 1: {"ok":false,"skill":<name>,"errors":[{slot,code,message}...]}
#   Exit 2: environment/usage error, same error shape with slot null.
# Requires: POSIX sh, awk, sed, jq. No bash-isms.

set -u

SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILL_MD="$SKILL_DIR/SKILL.md"

SKILLS_DIR="${HOME}/.claude/skills"
PLUGIN_LIST_CMD="claude plugin list --json"
MANIFEST=""

fail_env() { # $1=code $2=message (fixed strings, JSON-safe by construction)
  printf '{"ok":false,"skill":"%s","errors":[{"slot":null,"code":"%s","message":"%s"}]}\n' \
    "${WRAPPER_NAME:-}" "$1" "$2"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest)        MANIFEST="$2"; shift 2 ;;
    --skills-dir)      SKILLS_DIR="$2"; shift 2 ;;
    --plugin-list-cmd) PLUGIN_LIST_CMD="$2"; shift 2 ;;
    *) fail_env usage "unknown option; see convention.md for the v1 contract" ;;
  esac
done

command -v jq > /dev/null 2>&1 || fail_env jq-missing "jq is required but not on PATH"
[ -f "$SKILL_MD" ] || fail_env skill-md-missing "no SKILL.md next to scripts/ (looked at its parent dir)"

# --- frontmatter readers (constrained grammar; see convention.md) ---
fm_top() { # $1=key -> value of a top-level frontmatter key in $SKILL_MD
  awk -v key="$1" '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && index($0, key ":") == 1 {
      val = substr($0, length(key) + 2)
      sub(/^[[:space:]]*/, "", val)
      sub(/^"/, "", val); sub(/"$/, "", val)
      print val
      exit
    }
  ' "$SKILL_MD"
}

fm_meta() { # $1=SKILL.md path, $2=metadata key -> value
  awk -v key="$2" '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && $0 == "metadata:" { meta = 1; next }
    meta && $0 !~ /^[[:space:]]/ { meta = 0 }
    meta {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (index(line, key ":") == 1) {
        val = substr(line, length(key) + 2)
        sub(/^[[:space:]]*/, "", val)
        sub(/^"/, "", val); sub(/"$/, "", val)
        print val
        exit
      }
    }
  ' "$1"
}

WRAPPER_NAME=$(fm_top name)
[ -n "$WRAPPER_NAME" ] || fail_env name-missing "SKILL.md frontmatter has no name:"

SLOTS=$(fm_meta "$SKILL_MD" slots)
[ -n "$SLOTS" ] || fail_env no-slots "SKILL.md metadata declares no slots; this skill is not parameterized"

# --- find the manifest: walk up from PWD, then $HOME fallback ---
if [ -z "$MANIFEST" ]; then
  d=$PWD
  while :; do
    [ "$d" = "$HOME" ] && break
    if [ -f "$d/.mattstack/skills.jsonc" ]; then
      MANIFEST="$d/.mattstack/skills.jsonc"
      break
    fi
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done
  if [ -z "$MANIFEST" ]; then
    # Per-repo manifest, keyed by the normalized origin remote.
    # Known limitation: an explicit port (ssh://host:2222/path) stays in
    # the slug; both writer and readers share this, so they agree.
    REPO_REMOTE=$(git remote get-url origin 2> /dev/null || true)
    if [ -n "$REPO_REMOTE" ]; then
      u=${REPO_REMOTE%.git}
      u=${u#ssh://}; u=${u#https://}; u=${u#http://}; u=${u#git://}
      u=${u#*@}
      u=$(printf %s "$u" | sed 's|:|/|')
      _host=${u%%/*}; _path=${u#*/}
      REPO_SLUG="$(printf %s "$_host" | tr 'A-Z' 'a-z')-$(printf %s "$_path" | tr '/' '-')"
      if [ -f "$HOME/.mattstack/repos/$REPO_SLUG/skills.jsonc" ]; then
        MANIFEST="$HOME/.mattstack/repos/$REPO_SLUG/skills.jsonc"
      fi
    fi
  fi
  if [ -z "$MANIFEST" ] && [ -f "$HOME/.mattstack/skills.jsonc" ]; then
    MANIFEST="$HOME/.mattstack/skills.jsonc"
  fi
fi

# Missing manifest = empty bindings; required slots then fail as unbound.
BINDINGS_JSON='{}'
MANIFEST_NOTE="no manifest: not in an upward .mattstack/skills.jsonc from $PWD (stopping before \$HOME), not in \$HOME/.mattstack/repos/<slug>/skills.jsonc for this repo's remote, not in \$HOME/.mattstack/skills.jsonc"
MANIFEST_INVALID=0
if [ -n "$MANIFEST" ] && [ -f "$MANIFEST" ]; then
  MANIFEST_NOTE=$MANIFEST
  # JSONC rule: strip full-line // comments only (see skills-manifest.md).
  if MANIFEST_JSON=$(sed 's|^[[:space:]]*//.*$||' "$MANIFEST" | jq -c . 2> /dev/null); then
    # Lookup by bare frontmatter name first, then the plugin-qualified
    # "mattstack:<name>" key existing manifests use.
    BINDINGS_JSON=$(printf '%s' "$MANIFEST_JSON" | jq -c --arg s "$WRAPPER_NAME" '.bindings[$s] // .bindings["mattstack:" + $s] // {}')
  else
    MANIFEST_INVALID=1
  fi
fi

RES_FILE=$(mktemp "${TMPDIR:-/tmp}/resolve-args.res.XXXXXX") || fail_env tmp-failed "mktemp failed"
ERR_FILE=$(mktemp "${TMPDIR:-/tmp}/resolve-args.err.XXXXXX") || fail_env tmp-failed "mktemp failed"
trap 'rm -f "$RES_FILE" "$ERR_FILE"' EXIT

err() { # $1=slot-or-null $2=code $3=message
  if [ "$1" = null ]; then
    jq -n --arg code "$2" --arg msg "$3" \
      '{slot: null, code: $code, message: $msg}' >> "$ERR_FILE"
  else
    jq -n --arg slot "$1" --arg code "$2" --arg msg "$3" \
      '{slot: $slot, code: $code, message: $msg}' >> "$ERR_FILE"
  fi
}

if [ "$MANIFEST_INVALID" = 1 ]; then
  err null manifest-invalid "manifest is not valid JSONC: $MANIFEST"
else
  # Plugin inventory: tolerate a missing claude CLI or bad output as an
  # empty list; skills-dir bindings must keep working without it.
  PLUGIN_JSON=$($PLUGIN_LIST_CMD 2> /dev/null) || PLUGIN_JSON='[]'
  printf '%s' "$PLUGIN_JSON" | jq -e . > /dev/null 2>&1 || PLUGIN_JSON='[]'

  OLD_IFS=$IFS
  IFS=','
  for RAW_SLOT in $SLOTS; do
    IFS=$OLD_IFS
    SLOT=$(printf '%s' "$RAW_SLOT" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    [ -n "$SLOT" ] || continue

    DECL=$(fm_meta "$SKILL_MD" "slot-$SLOT")
    if [ -z "$DECL" ]; then
      err "$SLOT" slot-decl-invalid "metadata.slots names \"$SLOT\" but metadata has no slot-$SLOT key"
      continue
    fi

    REQUIREMENT=${DECL%% *}
    REST=${DECL#* }
    CONTRACT_FULL=${REST%% *}
    case "$REQUIREMENT" in
      required|optional) : ;;
      *)
        err "$SLOT" slot-decl-invalid "slot-$SLOT must start with required|optional, got \"$REQUIREMENT\""
        continue
        ;;
    esac
    case "$CONTRACT_FULL" in
      *@*)
        CONTRACT=${CONTRACT_FULL%@*}
        MAJOR=${CONTRACT_FULL#*@}
        ;;
      *)
        err "$SLOT" slot-decl-invalid "slot-$SLOT contract must be <name>@<major>, got \"$CONTRACT_FULL\""
        continue
        ;;
    esac
    case "$MAJOR" in
      ''|*[!0-9]*)
        err "$SLOT" slot-decl-invalid "slot-$SLOT contract major must be an integer, got \"$MAJOR\""
        continue
        ;;
    esac

    BINDING=$(printf '%s' "$BINDINGS_JSON" | jq -r --arg slot "$SLOT" '.[$slot] // empty')
    if [ -z "$BINDING" ]; then
      if [ "$REQUIREMENT" = optional ]; then
        jq -n --arg slot "$SLOT" '{slot: $slot, binding: null}' >> "$RES_FILE"
      else
        err "$SLOT" unbound "required slot \"$SLOT\" of \"$WRAPPER_NAME\" has no binding ($MANIFEST_NOTE)"
      fi
      continue
    fi

    # Locate the bound skill: skills dir (literal dir name) first, then plugins.
    INNER_DIR=""
    SOURCE=""
    if [ -f "$SKILLS_DIR/$BINDING/SKILL.md" ]; then
      INNER_DIR="$SKILLS_DIR/$BINDING"
      SOURCE=skills-dir
    else
      case "$BINDING" in
        *:*)
          PLUGIN_NAME=${BINDING%%:*}
          INNER_SKILL=${BINDING#*:}
          INSTALL_PATH=$(printf '%s' "$PLUGIN_JSON" | jq -r --arg p "$PLUGIN_NAME" \
            '[.[] | select(.enabled and (.id | startswith($p + "@")))][0].installPath // empty')
          if [ -n "$INSTALL_PATH" ]; then
            # Flat layout first, then one category level (a plugin whose
            # manifest lists skills/<category> dirs installs the categories).
            if [ -f "$INSTALL_PATH/skills/$INNER_SKILL/SKILL.md" ]; then
              INNER_DIR="$INSTALL_PATH/skills/$INNER_SKILL"
              SOURCE=plugin
            else
              for CAT_DIR in "$INSTALL_PATH"/skills/*/"$INNER_SKILL"; do
                if [ -f "$CAT_DIR/SKILL.md" ]; then
                  INNER_DIR="$CAT_DIR"
                  SOURCE=plugin
                  break
                fi
              done
            fi
            if [ -z "$INNER_DIR" ]; then
              # Same flat-then-one-category-level shape as skills/ above --
              # an engine moved out of skills/ keeps its group nesting.
              if [ -f "$INSTALL_PATH/attachments/$INNER_SKILL/SKILL.md" ]; then
                INNER_DIR="$INSTALL_PATH/attachments/$INNER_SKILL"
                SOURCE=attachments
              else
                for CAT_DIR in "$INSTALL_PATH"/attachments/*/"$INNER_SKILL"; do
                  if [ -f "$CAT_DIR/SKILL.md" ]; then
                    INNER_DIR="$CAT_DIR"
                    SOURCE=attachments
                    break
                  fi
                done
              fi
            fi
          fi
          ;;
      esac
    fi
    if [ -z "$INNER_DIR" ]; then
      err "$SLOT" skill-not-installed "slot \"$SLOT\" is bound to \"$BINDING\" but it is not in $SKILLS_DIR, and no enabled plugin has it under skills/ or attachments/ (flat or one group level)"
      continue
    fi

    # Trust-but-declare fulfillment check (v1).
    PROVIDES=$(fm_meta "$INNER_DIR/SKILL.md" provides)
    if [ -z "$PROVIDES" ]; then
      err "$SLOT" provides-missing "\"$BINDING\" declares no metadata.provides (slot \"$SLOT\" needs $CONTRACT@$MAJOR)"
      continue
    fi
    MATCH=no
    for P in $PROVIDES; do
      [ "$P" = "$CONTRACT@$MAJOR" ] && MATCH=yes
    done
    if [ "$MATCH" = no ]; then
      err "$SLOT" provides-mismatch "slot \"$SLOT\" needs $CONTRACT@$MAJOR but \"$BINDING\" provides \"$PROVIDES\""
      continue
    fi

    jq -n --arg slot "$SLOT" --arg binding "$BINDING" \
      --arg contract "$CONTRACT@$MAJOR" --arg source "$SOURCE" --arg path "$INNER_DIR" \
      '{slot: $slot, binding: $binding, contract: $contract, source: $source, path: $path}' >> "$RES_FILE"
  done
  IFS=$OLD_IFS
fi

if [ -s "$ERR_FILE" ]; then
  jq -s --arg skill "$WRAPPER_NAME" '{ok: false, skill: $skill, errors: .}' "$ERR_FILE"
  exit 1
fi
jq -s --arg skill "$WRAPPER_NAME" \
  '{ok: true, skill: $skill, resolved: (map({(.slot): del(.slot)}) | add // {})}' "$RES_FILE"
exit 0
