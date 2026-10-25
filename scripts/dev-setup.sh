#!/usr/bin/env bash
# Prepare manual development sessions. Run again after changing vault/ to update the development vault.
# Run with --reset to replace the development vault, including its sessions in .pi/agent.
# Projects this repository into ~/.local/state/mirror/vault-dev with scripts/mirror-init.sh, as for any vault.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
vault="${MIRROR_DEV_VAULT:-$HOME/.local/state/mirror/vault-dev}"

if [[ "${1:-}" == "--reset" && -d "$vault" ]]; then
  rm -rf "$vault"
fi
"$root/scripts/mirror-init.sh" "$vault"

cat <<MSG

Start a session at the vault root, from any directory:
  "$root/scripts/dev-pi.sh"
MSG
