#!/bin/sh
# Run the local Pi model bridge that AI Memory uses for LLM consolidation.
# It listens on 127.0.0.1 and uses your existing Pi authentication directly.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
run="$root/dev/pi-model-bridge/run"
pidfile="$run/bridge.pid"
log="$run/bridge.log"

running() {
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

case "${1:-}" in
  start)
    if running; then echo "bridge already running (pid $(cat "$pidfile"))"; exit 0; fi
    mkdir -p "$run"
    nohup node "$root/dev/pi-model-bridge/main.ts" >> "$log" 2>&1 &
    echo $! > "$pidfile"
    sleep 2
    if running; then tail -n 1 "$log"; else echo "bridge failed to start:" >&2; tail -n 20 "$log" >&2; exit 1; fi
    ;;
  stop)
    if running; then kill "$(cat "$pidfile")"; fi
    rm -f "$pidfile"
    echo "bridge stopped"
    ;;
  status)
    if running; then echo "running (pid $(cat "$pidfile"))"; else echo "not running"; exit 1; fi
    ;;
  *)
    echo "Usage: scripts/model-bridge.sh start|stop|status" >&2
    exit 2
    ;;
esac
