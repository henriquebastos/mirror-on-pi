# Mirror

Mirror is a reflective companion that runs as plain Pi sessions in a Markdown vault.
Each journey is a directory. Pi reads the vault's `AGENTS.md` files, the model reads your identity files, and a few small extensions remember across sessions through AI Memory and save journal entries and corrections when you ask.

## Start (development)

```sh
pnpm install
scripts/ai-memory.sh up --llm  # local development AI Memory on 127.0.0.1:49390
scripts/model-bridge.sh start  # lets AI Memory consolidate with your Pi models
scripts/dev-setup.sh           # once: auth link and a development copy of the vault

cd ~/.local/state/mirror/vault-dev/journeys/health
PI_CODING_AGENT_DIR=~/me/mirror/dev/pi-agent ~/me/mirror/node_modules/.bin/pi       # new session
PI_CODING_AGENT_DIR=~/me/mirror/dev/pi-agent ~/me/mirror/node_modules/.bin/pi -c    # continue
```

Start a session in another journey's directory to talk about that journey.
You can have many sessions per journey. They share the journey's AI Memory project.

## How it fits together

| Part | Owner | Location |
|---|---|---|
| Mirror's instructions | The vault | `content/AGENTS.md` |
| Identity, journeys, journal, corrections, your files | You, in an Obsidian vault | `content/` |
| A journey's AI Memory scope | The journey directory | `content/journeys/<slug>/.ai-memory.toml` |
| Conversation history | Pi | Sessions per working directory, in the Pi agent directory |
| Recall and consolidation across sessions | AI Memory | One project per journey |
| Capture, recall, journal, corrections | One small Pi extension each | `mirror-pi/extensions/` |

- `mirror-pi/docs/` — architecture, TypeScript guidelines, and evals.
- `dev/pi-agent/` — the Pi agent directory for development sessions.
- `dev/ai-memory/`, `dev/pi-model-bridge/` — local AI Memory and the model bridge.

## Checks

```sh
pnpm check                 # types, lint, contract evals
pnpm test:integration      # real Pi sessions against the local AI Memory
pnpm test:mutants          # break each guarantee and require the evals to fail
pnpm test:llm              # AI Memory consolidation with a real model
pnpm test:behavior         # the real chat model's observable behavior
```

The starter content in `content/` is synthetic. See [NOTICE.md](NOTICE.md) for attribution.
