#!/usr/bin/env bash
# Prepare manual development sessions. Run again after changing vault/ to update the development vault.
# Run with --reset to replace the development vault.
# - Links dev/pi-agent/auth.json to your personal Pi auth file. No other file is shared.
# - Projects this repository into ~/.local/state/mirror/vault-dev with scripts/mirror-init.sh, as for any vault.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
agent_dir="$root/dev/pi-agent"
personal_auth="${MIRROR_PERSONAL_PI_AGENT_DIR:-$HOME/.pi/agent}/auth.json"
vault="${MIRROR_DEV_VAULT:-$HOME/.local/state/mirror/vault-dev}"

if [[ ! -e "$agent_dir/auth.json" && ! -L "$agent_dir/auth.json" ]]; then
  ln -s "$personal_auth" "$agent_dir/auth.json"
  echo "linked $agent_dir/auth.json -> $personal_auth"
fi

if [[ "${1:-}" == "--reset" && -d "$vault" ]]; then
  rm -rf "$vault"
fi
"$root/scripts/mirror-init.sh" "$vault"

cat <<MSG

Start a session in a journey directory:
  cd "$vault/journeys/health"
  "$root/scripts/dev-pi.sh"
MSG
