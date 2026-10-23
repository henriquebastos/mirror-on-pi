#!/bin/sh
# Manage the local development AI Memory service.
# It always tracks the latest published image and records the exact digest and version it resolved.
# Data lives in dev/ai-memory/data and never touches another AI Memory installation.
# The local embedding model is kept in dev/ai-memory/models, so a reset does not download it again.
# AI Memory enables hybrid search on the first start after the model is present.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
dir="$root/dev/ai-memory"
image="docker.io/akitaonrails/ai-memory:latest"
name="mirror-ai-memory-dev"
port="49390"
url="http://127.0.0.1:$port"

usage() {
  echo "Usage: scripts/ai-memory.sh up|down|pull|reset|status|logs" >&2
  exit 2
}

ensure_token() {
  if [ ! -f "$dir/.env" ]; then
    umask 077
    printf 'AI_MEMORY_AUTH_TOKEN=%s\n' "$(openssl rand -hex 24)" > "$dir/.env"
  fi
}

record_resolved() {
  digest=$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')
  version=$(docker run --rm "$image" --version | awk '{print $2}')
  created=$(docker image inspect "$image" --format '{{.Created}}')
  printf '{\n  "image": "%s",\n  "digest": "%s",\n  "version": "%s",\n  "created": "%s",\n  "resolvedAt": "%s"\n}\n' \
    "$image" "$digest" "$version" "$created" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/resolved.json"
  echo "AI Memory $version ($digest)"
}

wait_ready() {
  attempts=0
  until curl -fsS "$url/healthz" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -gt 60 ]; then
      echo "AI Memory did not become ready at $url" >&2
      docker logs --tail 40 "$name" >&2 || true
      exit 1
    fi
    sleep 1
  done
}

start() {
  ensure_token
  mkdir -p "$dir/data" "$dir/models"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" \
    -p "127.0.0.1:$port:49374" \
    -v "$dir/data:/data" \
    -v "$dir/models:/data/models" \
    --env-file "$dir/.env" \
    "$image" >/dev/null
  wait_ready
  record_resolved
  echo "AI Memory is ready at $url"
}

case "${1:-}" in
  pull)
    docker pull "$image"
    record_resolved
    ;;
  up)
    docker pull "$image" >/dev/null
    start
    ;;
  down)
    docker rm -f "$name" >/dev/null 2>&1 || true
    echo "AI Memory stopped"
    ;;
  reset)
    docker rm -f "$name" >/dev/null 2>&1 || true
    # Delete only this development data directory.
    rm -rf "$dir/data"
    start
    ;;
  status)
    if curl -fsS "$url/healthz" >/dev/null 2>&1; then echo "running at $url"; else echo "not running"; exit 1; fi
    cat "$dir/resolved.json" 2>/dev/null || true
    ;;
  logs)
    docker logs --tail 100 "$name"
    ;;
  *)
    usage
    ;;
esac
