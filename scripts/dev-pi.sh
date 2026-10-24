#!/bin/sh
# Start a development Mirror session from any directory: plain pi at the development vault root.
# The development agent directory keeps personal Pi settings, extensions, and sessions out. Arguments go to pi unchanged.
# Pi asks once whether to trust the vault, which loads Mirror's extensions. In print mode (-p), pass -a to trust it.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
vault="${MIRROR_DEV_VAULT:-$HOME/.local/state/mirror/vault-dev}"
export PI_CODING_AGENT_DIR="$root/dev/pi-agent"
cd "$vault"
exec "$root/node_modules/.bin/pi" "$@"
