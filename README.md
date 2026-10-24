# Mirror

Mirror is a reflective companion that runs as plain Pi sessions in a Markdown vault.
Each journey is a directory. Pi reads the vault's `AGENTS.md` files and the model reads your identity files.
Memory is Pi's own session files: the model searches the earlier sessions of its journey with `jq` and `rg`, as `content/AGENTS.md` instructs.
A few small Mirror extensions save journal entries and corrections, and append identity integrations you confirm in Soul Mode.

## Start (development)

```sh
pnpm install
scripts/dev-setup.sh           # once: auth link and a development copy of the vault

cd ~/.local/state/mirror/vault-dev/journeys/health
~/me/mirror/scripts/dev-pi.sh       # new session
~/me/mirror/scripts/dev-pi.sh -c    # continue
```

`dev-pi.sh` is plain `pi` with `PI_CODING_AGENT_DIR=dev/pi-agent`. Mirror itself needs no launcher.
The model needs `jq` and `rg` on the `PATH`.

Start a session in another journey's directory to talk about that journey.
You can have many sessions per journey. Pi stores them per working directory, so each journey has its own.

## How it fits together

| Part | Owner | Location |
|---|---|---|
| Mirror's instructions, including how to search earlier sessions | The vault | `content/AGENTS.md` |
| Identity, journeys, journal, corrections, your files | You, in an Obsidian vault | `content/` |
| Conversation history and memory | Pi | `<Pi agent directory>/sessions/--<journey path>--/` |
| Journal, corrections, identity integrations | One small Pi extension each | `mirror-pi/extensions/` |
| Soul Mode | A Pi skill in the vault | `content/.agents/skills/soul/` |

- `mirror-pi/docs/` — architecture, TypeScript guidelines, evals, and the memory strategy comparison.
- `dev/pi-agent/` — the Pi agent directory for development sessions.

## Checks

```sh
pnpm check                 # types, lint, contract evals
pnpm test:integration      # real Pi sessions with a scripted model
pnpm test:mutants          # break each guarantee and require the evals to fail
pnpm test:behavior         # the real chat model's observable behavior
```

The starter content in `content/` is synthetic. See [NOTICE.md](NOTICE.md) for attribution.
