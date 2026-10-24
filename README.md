# Mirror

Mirror is a reflective companion that runs as plain Pi sessions in a Markdown vault.
Each journey is a directory. Pi reads the vault's `AGENTS.md` files and the model reads your identity files.
The AI Memory Pi extension that personal Pi already uses captures each session. A few small Mirror extensions recall memory and save journal entries and corrections.

## Start (development)

```sh
pnpm install
scripts/ai-memory.sh up --llm  # local development AI Memory on 127.0.0.1:49390
scripts/model-bridge.sh start  # lets AI Memory consolidate with your Pi models
scripts/dev-setup.sh           # once: auth link, AI Memory extension, and a development copy of the vault

cd ~/.local/state/mirror/vault-dev/journeys/health
~/me/mirror/scripts/dev-pi.sh       # new session
~/me/mirror/scripts/dev-pi.sh -c    # continue
```

`dev-pi.sh` is plain `pi` with development values for `PI_CODING_AGENT_DIR`, `AI_MEMORY_AUTH_TOKEN`, and `AI_MEMORY_DATA_DIR`.
Personal Pi gets the same variables from your environment. Mirror itself needs no launcher.

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
| Capture | The AI Memory Pi extension, as in personal Pi | `dev/pi-agent/extensions/ai-memory-pi.ts` (generated) |
| Recall, journal, corrections | One small Pi extension each | `mirror-pi/extensions/` |

- `mirror-pi/docs/` — architecture, TypeScript guidelines, and evals.
- `dev/pi-agent/` — the Pi agent directory for development sessions.
- `dev/ai-memory/`, `dev/pi-model-bridge/` — local AI Memory and the model bridge.
- `scripts/ai-memory-extension.sh` — regenerates the AI Memory extension from the release pinned in the dotfiles.

## Checks

```sh
pnpm check                 # types, lint, contract evals
pnpm test:integration      # real Pi sessions against the local AI Memory
pnpm test:mutants          # break each guarantee and require the evals to fail
pnpm test:llm              # AI Memory consolidation with a real model
pnpm test:behavior         # the real chat model's observable behavior
```

The starter content in `content/` is synthetic. See [NOTICE.md](NOTICE.md) for attribution.
