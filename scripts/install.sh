#!/bin/sh
# local installer — https://github.com/@@REPO@@
# Installs the `local` binary to ~/.mattstack/local/bin and runs `local setup`.
set -eu
REPO="@@REPO@@"

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
    SHELL_RC="${HOME}/.zshrc"
    [ -n "${BASH_VERSION:-}" ] && SHELL_RC="${HOME}/.bashrc"
    printf '\nexport PATH="%s:$PATH"\n' "${BIN_DIR}" >> "${SHELL_RC}"
    echo "added ${BIN_DIR} to PATH in ${SHELL_RC} (open a new shell to pick it up)"
    ;;
esac

echo "running local setup ..."
"${BIN_DIR}/local" setup
