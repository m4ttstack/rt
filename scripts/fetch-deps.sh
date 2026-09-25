#!/bin/bash
# scripts/fetch-deps.sh [arm64]
# Downloads every bundled tool in rt-tray/deps.lock, verifies sha256 before
# extracting, and unpacks it into rt-tray/deps/<arch>/<name> (helpers) or
# rt-tray/deps/tools/<name> (build tools, dest derived from the lock's own
# bundlePath). Idempotent: a tool whose unpack stamp already matches the
# locked sha256 is skipped.
#
# To add a tool: download it once, run `shasum -a 256 <download>`, and paste
# the url plus that hash into rt-tray/deps.lock by hand, then re-run this
# script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="arm64"
for a in "$@"; do
  case "$a" in
    arm64) ARCH=arm64 ;;
    *) echo "usage: $0 [arm64]" >&2; exit 2 ;;
  esac
done

DEPS_LOCK_TS="$ROOT/scripts/lib/deps-lock.ts"
DEPS_ROOT="${RT_DEPS_ROOT:-$ROOT/rt-tray/deps}"
DEPS="$DEPS_ROOT/$ARCH"
TOOLS="$DEPS_ROOT/tools"
CACHE="${RT_DEPS_CACHE:-$HOME/Library/Caches/mattstack-deps}"
mkdir -p "$DEPS" "$TOOLS" "$CACHE"

LOCK_ARCH="$(bun "$DEPS_LOCK_TS" ${RT_DEPS_LOCK:+--lock "$RT_DEPS_LOCK"} --arch)"
if [ "$LOCK_ARCH" != "$ARCH" ]; then
  echo "  x deps.lock arch is $LOCK_ARCH, this run wants $ARCH" >&2
  exit 1
fi

# A make-src row compiles with the host toolchain's defaults, so an x86_64 Mac
# would drop an x86_64 binary into deps/arm64 and every downstream check would
# pass: the linkage gate reads library paths, never the CPU type.
HOST_ARCH="$(uname -m)"
if [ "$HOST_ARCH" != "arm64" ]; then
  echo "  x build host is $HOST_ARCH; deps/$ARCH must be built on arm64" >&2
  exit 1
fi

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

fetch() { # url sha → prints cached path
  local url="$1" want="$2" name dest
  name="$(basename "$url")"
  dest="$CACHE/${want:-nohash}-$name"
  if [ ! -f "$dest" ]; then
    curl -fsSL --retry 3 -o "$dest.part" "$url" || {
      rm -f "$dest.part"
      # A private repo's release asset (console, chat) refuses bare curl;
      # gh carries the caller's token (GH_TOKEN in CI, keychain locally).
      # The sha gate below still judges whatever arrives.
      case "$url" in
        https://github.com/*/releases/download/*)
          local path="${url#https://github.com/}"
          local owner_repo="${path%%/releases/download/*}"
          local rest="${path#*/releases/download/}"
          local tag="${rest%%/*}" file="${rest#*/}"
          echo "  → bare download refused; retrying $name via gh ($owner_repo $tag)" >&2
          command -v gh >/dev/null 2>&1 || { echo "  x download failed and gh is not available: $url" >&2; exit 1; }
          gh release download "$tag" --repo "$owner_repo" --pattern "$file" --output "$dest.part" --clobber || {
            rm -f "$dest.part"
            echo "  x download failed (curl and gh): $url" >&2
            exit 1
          } ;;
        *)
          echo "  x download failed: $url" >&2
          exit 1 ;;
      esac
    }
    mv "$dest.part" "$dest"
  fi
  if [ -n "$want" ] && [ "$(sha "$dest")" != "$want" ]; then
    echo "  x sha256 mismatch for $name (want $want, got $(sha "$dest"))" >&2
    rm -f "$dest"
    exit 1
  fi
  echo "$dest"
}

# Everything the bundle ships has to run on a Mac with no Homebrew, so a
# binary compiled HERE may link only libraries every Mac carries. Applies to
# what this script builds itself; an upstream release binary is the vendor's
# own contract, and its linkage is asserted by check-bundle's run smoke.
assert_arch() { # name path
  local name="$1" path="$2" archs
  archs="$(lipo -archs "$path" 2>/dev/null || true)"
  case " $archs " in
    *" $ARCH "*) ;;
    *) echo "  x $name is $archs, not $ARCH" >&2; rm -f "$path"; exit 1 ;;
  esac
}

assert_system_linkage() { # name path
  local name="$1" path="$2" line lib bad=0
  while IFS= read -r line; do
    lib="${line%% (*}"
    lib="${lib#"${lib%%[![:space:]]*}"}"
    case "$lib" in
      ""|/usr/lib/*|/System/*) ;;
      *) echo "  x $name links outside the system libraries: $lib" >&2; bad=1 ;;
    esac
  done < <(otool -L "$path" | tail -n +2)
  if [ "$bad" -ne 0 ]; then
    rm -f "$path"
    exit 1
  fi
}

unpack() { # name archive-file archive-kind extract-path dest
  local name="$1" file="$2" kind="$3" extract="$4" dest="$5" tmp
  # Skills and identity are cleared for every archive kind, not just the tar
  # branch that can write them: a tool migrating from tar.gz to raw would
  # otherwise keep a stale tree that the post-unpack stamp then re-blesses
  # under the new sha.
  rm -rf "$dest" "$dest-skills" "$dest-identity"
  mkdir -p "$(dirname "$dest")"
  case "$kind" in
    raw)
      cp "$file" "$dest"
      chmod 755 "$dest" ;;
    tar.gz|tar.xz|npm)
      tmp="$(mktemp -d)"
      tar -xf "$file" -C "$tmp"
      if [ -n "$extract" ]; then
        if [ ! -e "$tmp/$extract" ]; then
          echo "  x $name: archive no longer contains $extract" >&2
          rm -rf "$tmp"
          exit 1
        fi
        cp -R "$tmp/$extract" "$dest"
      else
        cp -R "$tmp" "$dest"
      fi
      if [ -d "$tmp/skills" ]; then
        cp -R "$tmp/skills" "$dest-skills"
      fi
      if [ -d "$tmp/identity" ]; then
        cp -R "$tmp/identity" "$dest-identity"
      fi
      rm -rf "$tmp" ;;
    go-src)
      # Built from source so rt-tray/patches/<name>.patch can restyle it.
      # Version is stamped so check-bundle's smoke matches.
      command -v go >/dev/null || { echo "  x $name: go toolchain required for go-src builds" >&2; exit 1; }
      tmp="$(mktemp -d)"
      tar -xf "$file" -C "$tmp"
      if [ ! -d "$tmp/$extract" ]; then
        echo "  x $name: archive no longer contains $extract" >&2
        rm -rf "$tmp"
        exit 1
      fi
      patchfile="$ROOT/rt-tray/patches/$name.patch"
      if [ -f "$patchfile" ]; then
        patch -p1 -d "$tmp/$extract" --silent < "$patchfile" || {
          echo "  x $name: patch $patchfile no longer applies to $extract" >&2
          rm -rf "$tmp"
          exit 1
        }
      fi
      version_for_build="${extract#*-}"
      (cd "$tmp/$extract" && go build -trimpath -ldflags "-s -w -X main.version=$version_for_build -X main.revision=rtpatch" -o "$dest" .) || {
        echo "  x $name: go build failed" >&2
        rm -rf "$tmp"
        exit 1
      }
      rm -rf "$tmp"
      chmod 755 "$dest" ;;
    make-src)
      # Compiled from a sha-pinned source release because the project ships no
      # darwin-arm64 binary, and a Homebrew bottle links dylibs that live only
      # under /opt/homebrew. The Makefile target is the tool's own name.
      tmp="$(mktemp -d)"
      tar -xf "$file" -C "$tmp"
      if [ ! -d "$tmp/$extract" ]; then
        echo "  x $name: archive no longer contains $extract" >&2
        rm -rf "$tmp"
        exit 1
      fi
      if ! make -C "$tmp/$extract" "$name" -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" > "$tmp/make.log" 2>&1; then
        echo "  x $name: make failed" >&2
        tail -20 "$tmp/make.log" >&2
        rm -rf "$tmp"
        exit 1
      fi
      if [ ! -e "$tmp/$extract/$name" ]; then
        echo "  x $name: make produced no $name under $extract" >&2
        rm -rf "$tmp"
        exit 1
      fi
      # Plain cp, which dereferences: the target commonly lands as a symlink
      # into a subdirectory that is about to be deleted with $tmp.
      cp "$tmp/$extract/$name" "$dest"
      chmod 755 "$dest"
      rm -rf "$tmp"
      assert_arch "$name" "$dest"
      assert_system_linkage "$name" "$dest" ;;
    zip)
      tmp="$(mktemp -d)"
      ditto -x -k "$file" "$tmp"
      if [ ! -e "$tmp/$extract" ]; then
        echo "  x $name: archive no longer contains $extract" >&2
        rm -rf "$tmp"
        exit 1
      fi
      cp -R "$tmp/$extract" "$dest"
      rm -rf "$tmp" ;;
    *) echo "  x $name: unknown archive kind $kind" >&2; exit 1 ;;
  esac
  [ -d "$dest" ] || chmod 755 "$dest"
}

# The lock's bundlePath/exec are already traversal-safe (parseDepsLock rejects
# ".." and absolute paths); "name" drives the fetch destination directly and
# isn't validated there, so it gets its own guard before it reaches a path.
assert_safe_name() {
  case "$1" in
    */*|..|*..*) echo "  x refusing unsafe tool name: $1" >&2; exit 1 ;;
  esac
}

# bash's `read` treats tab as "IFS whitespace" and collapses runs of it even
# when IFS is set to only tab, dropping empty TSV fields and shifting every
# later field left. Split by hand so an empty field stays a field. Kept in
# sync by hand with the identical copies in rt-tray/build.sh and
# rt-tray/check-bundle.sh.
split_tsv() {
  local rest="$1" field
  FIELDS=()
  while [[ "$rest" == *$'\t'* ]]; do
    field="${rest%%$'\t'*}"
    FIELDS+=("$field")
    rest="${rest#*$'\t'}"
  done
  FIELDS+=("$rest")
}

# Materialized to a file rather than streamed through `done < <(cmd)`: a
# process-substitution loop never sees cmd's exit status, even under
# `set -o pipefail` — an emitter crash (malformed lock, bun missing) would
# otherwise iterate zero rows and this script would report Done. and exit 0.
TSV="$(mktemp)"
trap 'rm -f "$TSV"' EXIT
bun "$DEPS_LOCK_TS" ${RT_DEPS_LOCK:+--lock "$RT_DEPS_LOCK"} > "$TSV"
ROWS="$(wc -l < "$TSV" | tr -d ' ')"
if [ "$ROWS" -eq 0 ]; then
  echo "  x deps.lock produced no rows" >&2
  exit 1
fi

while IFS= read -r line; do
  split_tsv "$line"
  if [ "${#FIELDS[@]}" -ne 11 ]; then
    echo "  x deps.lock TSV row has ${#FIELDS[@]} fields, expected 11: $line" >&2
    exit 1
  fi
  name="${FIELDS[0]}"; version="${FIELDS[1]}"; url="${FIELDS[2]}"; sha="${FIELDS[3]}"
  archive="${FIELDS[4]}"; extract="${FIELDS[5]}"; bundlePath="${FIELDS[6]}"
  status="${FIELDS[8]}"; kind="${FIELDS[9]}"
  if [ "$status" != "bundled" ]; then
    echo "  . $name: pending (not bundled in this build)"
    continue
  fi
  assert_safe_name "$name"
  if [ "$kind" = "buildtool" ]; then dest="$DEPS_ROOT/$bundlePath"; else dest="$DEPS/$name"; fi
  stamp="$dest.sha256"

  already=false
  if [ -e "$dest" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$sha" ]; then
    already=true
    # A raw dest *is* the downloaded file byte-for-byte, so re-hash it
    # directly instead of trusting the stamp alone.
    if [ "$archive" = "raw" ] && [ "$(sha "$dest")" != "$sha" ]; then
      already=false
    fi
    # A skills stamp promises a skills dir; a deleted dir must re-materialize.
    if [ -f "$dest-skills.sha256" ] && [ "$(cat "$dest-skills.sha256")" = "$sha" ] && [ ! -d "$dest-skills" ]; then
      already=false
    fi
    if [ -f "$dest-identity.sha256" ] && [ "$(cat "$dest-identity.sha256")" = "$sha" ] && [ ! -d "$dest-identity" ]; then
      already=false
    fi
  fi
  if $already; then
    echo "  = $name $version already unpacked (archive ${sha:0:12} verified) -> ${dest#$ROOT/}"
    continue
  fi

  file="$(fetch "$url" "$sha")"
  unpack "$name" "$file" "$archive" "$extract" "$dest"
  echo "$sha" > "$stamp"
  if [ -d "$dest-skills" ]; then
    echo "$sha" > "$dest-skills.sha256"
  else
    rm -f "$dest-skills.sha256"
  fi
  if [ -d "$dest-identity" ]; then
    echo "$sha" > "$dest-identity.sha256"
  else
    rm -f "$dest-identity.sha256"
  fi
  echo "  + $name $version -> ${dest#$ROOT/}"
done < "$TSV"

# Sparkle's tools are an xz tarball with bin/ at its root; --help proves they run.
if [ -x "$TOOLS/sparkle/bin/generate_appcast" ]; then
  if "$TOOLS/sparkle/bin/generate_appcast" --help >/dev/null 2>&1; then
    echo "  + sparkle tools runnable"
  else
    echo "  x sparkle tools present but not runnable" >&2
    exit 1
  fi
fi
echo "  Done."
