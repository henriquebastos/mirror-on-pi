#!/usr/bin/env bash
# Generate dev/pi-agent/extensions/ai-memory-pi.ts: the AI Memory Pi extension that personal Pi uses,
# from the same pinned release and options, pointed at the local development AI Memory.
# Keep VERSION and SHA256 equal to the pin in the dotfiles' scripts/setup-ai-memory.
# Pi loads every file in <agent dir>/extensions/, so development sessions load it as personal Pi does.
set -euo pipefail

VERSION="2.2.2"
SHA256="2ed926c1944b2e936e5570b03984cef46883841d1227001da5af4703f1cde523"
ARCHIVE_URL="https://github.com/akitaonrails/ai-memory/releases/download/v${VERSION}/ai-memory-macos-aarch64.tar.gz"
SERVER_URL="http://127.0.0.1:49390"

root=$(cd "$(dirname "$0")/.." && pwd -P)
release="$root/dev/ai-memory/cli/v$VERSION"
binary="$release/ai-memory"
target="$root/dev/pi-agent/extensions/ai-memory-pi.ts"
production="${MIRROR_PERSONAL_PI_AGENT_DIR:-$HOME/.pi/agent}/extensions/ai-memory-pi.ts"

if [[ ! -x "$binary" || "$("$binary" --version 2>/dev/null)" != "ai-memory $VERSION" ]]; then
  archive="$(mktemp -d)/ai-memory.tar.gz"
  curl -fsSL "$ARCHIVE_URL" -o "$archive"
  printf '%s  %s\n' "$SHA256" "$archive" | shasum -a 256 -c - >/dev/null
  mkdir -p "$release"
  tar -xzf "$archive" -C "$release"
fi

# No token is passed, so the extension reads AI_MEMORY_AUTH_TOKEN at run time, as the personal one does.
# The installer's own state goes to the development client directory, never to the personal one.
mkdir -p "$(dirname "$target")" "$root/dev/ai-memory/client"
log=$(mktemp)
env -u AI_MEMORY_AUTH_TOKEN -u AI_MEMORY_SERVER_URL -u AI_MEMORY_PROJECT_STRATEGY \
  AI_MEMORY_DATA_DIR="$root/dev/ai-memory/client" PI_CODING_AGENT_DIR="$root/dev/pi-agent" \
  "$binary" install-hooks --agent pi --apply --server-url "$SERVER_URL" --project-strategy repo-root \
  --config-file "$target" --hooks-dir "$release/hooks" >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
rm -f "$target".bak-*
chmod 644 "$target"
echo "generated $target with AI Memory $VERSION"

# The only intended difference from the personal extension is the server address.
if [[ -f "$production" ]]; then
  if diff <(grep -v '^const SERVER = ' "$production") <(grep -v '^const SERVER = ' "$target") >/dev/null; then
    echo "matches $production except the server address"
  else
    echo "warning: differs from $production beyond the server address; check the pinned version" >&2
  fi
fi
