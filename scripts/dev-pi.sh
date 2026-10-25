#!/bin/sh
# Start a development Mirror session from any directory: scripts/mirror.sh with the development vault.
# Development runs exactly as production: the installed pi, with the agent directory in the vault's .pi/agent.
# Arguments go to pi unchanged. In print mode (-p), pass -a to trust the vault.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
MIRROR_VAULT="${MIRROR_DEV_VAULT:-$HOME/.local/state/mirror/vault-dev}" exec "$root/scripts/mirror.sh" "$@"
