#!/bin/sh
# Start Mirror: the installed pi at the root of your vault, with Mirror's own Pi agent directory.
# Your personal Pi configuration in ~/.pi/agent stays out; only auth.json is shared, by a symbolic link.
# Arguments go to pi unchanged. Pi asks once whether to trust the vault, which loads Mirror's extensions.
#   MIRROR_VAULT           the vault, projected with scripts/mirror-init.sh (required)
#   MIRROR_PI_AGENT_DIR    Mirror's Pi agent directory (default ~/.local/state/mirror/pi-agent)
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
if [ -z "${MIRROR_VAULT:-}" ]; then
  echo "Set MIRROR_VAULT to your vault, for example: MIRROR_VAULT=~/my-vault $0" >&2
  exit 2
fi

# Mirror is tested on the Pi version that this repository pins. Start only on that version.
pinned=$(node -p 'require(process.argv[1]).devDependencies["@earendil-works/pi-coding-agent"]' "$root/package.json")
installed=$(pi --version 2>&1)
if [ "$installed" != "$pinned" ]; then
  echo "Mirror is tested on Pi $pinned, but the installed pi is $installed." >&2
  echo "Install the tested version: pnpm add -g @earendil-works/pi-coding-agent@$pinned" >&2
  exit 1
fi

agent_dir="${MIRROR_PI_AGENT_DIR:-$HOME/.local/state/mirror/pi-agent}"
personal_auth="${MIRROR_PERSONAL_PI_AGENT_DIR:-$HOME/.pi/agent}/auth.json"
mkdir -p "$agent_dir"
# Mirror's settings are copied once; then they are yours to change.
[ -e "$agent_dir/settings.json" ] || cp "$root/agent/settings.json" "$agent_dir/settings.json"
[ -e "$agent_dir/auth.json" ] || [ -L "$agent_dir/auth.json" ] || ln -s "$personal_auth" "$agent_dir/auth.json"

export PI_CODING_AGENT_DIR="$agent_dir"
cd "$MIRROR_VAULT"
exec pi "$@"
