#!/bin/sh
# Start Pi for development in the current directory, usually a journey directory of the development vault.
# Personal Pi gets AI_MEMORY_AUTH_TOKEN and AI_MEMORY_DATA_DIR from your environment. This sets the same
# variables to development values, so the AI Memory extension sends events, spools failures, and drains
# its spool only for the local development AI Memory. Arguments go to pi unchanged.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
token=$(sed -n 's/^AI_MEMORY_AUTH_TOKEN=//p' "$root/dev/ai-memory/.env" 2>/dev/null || true)
if [ -z "$token" ]; then
  echo "No development AI Memory token. Run scripts/ai-memory.sh up first." >&2
  exit 1
fi

unset AI_MEMORY_SERVER_URL AI_MEMORY_PROJECT_STRATEGY
export AI_MEMORY_AUTH_TOKEN="$token"
export AI_MEMORY_DATA_DIR="$root/dev/ai-memory/client"
export PI_CODING_AGENT_DIR="$root/dev/pi-agent"
exec "$root/node_modules/.bin/pi" "$@"
