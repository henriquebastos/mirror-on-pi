#!/bin/sh
# Start Pi for development in the current directory, usually a journey directory of the development vault.
# The development agent directory keeps personal Pi settings, extensions, and sessions out. Arguments go to pi unchanged.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
export PI_CODING_AGENT_DIR="$root/dev/pi-agent"
exec "$root/node_modules/.bin/pi" "$@"
