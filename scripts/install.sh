#!/bin/sh
# local installer — https://github.com/@@REPO@@
# Installs the `local` binary to ~/.mattstack/local/bin and runs `local setup`.
set -eu
REPO="@@REPO@@"
case "$REPO" in
  *@@*) echo "this is the unsubstituted template — run the copy published by a release, not this checked-out file directly" >&2; exit 1 ;;
esac

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="local-darwin-arm64" ;;
  Darwin-x86_64) ASSET="local-darwin-x64" ;;
  *) echo "local v1 supports macOS (Linux is designed-for, coming). Sorry!"; exit 1 ;;
esac

BIN_DIR="${HOME}/.mattstack/local/bin"
mkdir -p "${BIN_DIR}"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
echo "downloading ${URL} ..."
curl -fsSL -o "${BIN_DIR}/local" "${URL}"
chmod +x "${BIN_DIR}/local"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    # $BASH_VERSION reflects the installer's own interpreter (curl | sh runs
    # under /bin/sh, which IS bash on macOS), not the user's login shell --
    # check $SHELL instead, the OS-set path to the user's configured shell.
    case "${SHELL:-}" in
      */zsh) SHELL_RC="${HOME}/.zshrc" ;;
      */bash) SHELL_RC="${HOME}/.bashrc" ;;
      *) SHELL_RC="${HOME}/.zshrc" ;;  # zsh has been macOS's default login shell since Catalina
    esac
    printf '\nexport PATH="%s:$PATH"\n' "${BIN_DIR}" >> "${SHELL_RC}"
    echo "added ${BIN_DIR} to PATH in ${SHELL_RC} (open a new shell to pick it up)"
    ;;
esac

echo "running local setup ..."
"${BIN_DIR}/local" setup
