#!/bin/sh
# Migrate a Mirror Mind home (~/.mirror/<user>) into a new vault, before mirror-init. Reads the homes, never writes them.
# Writes only new files into the vault and commits nothing.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec node "$root/mirror-pi/cli/migrate.ts" "$@"
