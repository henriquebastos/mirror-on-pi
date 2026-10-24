#!/usr/bin/env bash
# Prepare manual development sessions. Run once; run with --reset to replace the development vault.
# - Links dev/pi-agent/auth.json to your personal Pi auth file. No other file is shared.
# - Generates the AI Memory Pi extension in dev/pi-agent/extensions when it is missing (scripts/ai-memory-extension.sh).
# - Copies the synthetic vault to ~/.local/state/mirror/vault-dev, outside this repository,
#   so this repository's AGENTS.md does not load into Mirror sessions.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
agent_dir="$root/dev/pi-agent"
personal_auth="${MIRROR_PERSONAL_PI_AGENT_DIR:-$HOME/.pi/agent}/auth.json"
vault="${MIRROR_DEV_VAULT:-$HOME/.local/state/mirror/vault-dev}"

if [[ ! -e "$agent_dir/auth.json" && ! -L "$agent_dir/auth.json" ]]; then
  ln -s "$personal_auth" "$agent_dir/auth.json"
  echo "linked $agent_dir/auth.json -> $personal_auth"
fi

if [[ ! -f "$agent_dir/extensions/ai-memory-pi.ts" ]]; then
  "$root/scripts/ai-memory-extension.sh"
fi

if [[ "${1:-}" == "--reset" && -d "$vault" ]]; then
  rm -rf "$vault"
fi
if [[ ! -d "$vault" ]]; then
  mkdir -p "$(dirname "$vault")"
  cp -R "$root/content" "$vault"
  rm -rf "$vault/journeys"/*/journal "$vault/journeys"/*/corrections
  echo "copied the synthetic vault to $vault"
fi

cat <<MSG

Start a session in a journey directory:
  cd "$vault/journeys/health"
  "$root/scripts/dev-pi.sh"
MSG
