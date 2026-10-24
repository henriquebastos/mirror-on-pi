#!/bin/sh
# Project this repository into a vault: create it and its Git repository when needed, write the files Mirror owns,
# copy the starter content into a new vault, and commit what changed. Safe to run again.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec node "$root/mirror-pi/cli/init.ts" "$@"
