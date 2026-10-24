# Mirror

Mirror is a reflective companion that runs as plain Pi sessions in a Markdown vault.
Each journey is a directory. Pi reads the vault's `AGENTS.md` files and the model reads your identity files.
Memory is Pi's own session files: the model searches the earlier sessions of its journey with `jq` and `rg`, as the vault's `AGENTS.md` instructs.
A few small Mirror extensions save journal entries and corrections, and append identity integrations you confirm in Soul Mode.

This repository is the code. A vault is a separate directory with its own Git repository. `scripts/mirror-init.sh <vault>` projects the repository into a vault: it creates the vault and its Git repository when needed, writes the files Mirror owns, copies the starter content into a new vault, and commits what changed. Run it again to update a vault. It never touches your own files.

## Start (development)

```sh
pnpm install
scripts/dev-setup.sh           # auth link, and mirror-init into the development vault

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
| Mirror's instructions, including how to search earlier sessions | Mirror, projected into the vault | `vault/AGENTS.md` |
| Identity and journeys | You, after `mirror-init` copies the starter content into a new vault | `starter/` |
| Journal, corrections, your files | You, in the vault | The vault |
| Conversation history and memory | Pi | `<Pi agent directory>/sessions/--<journey path>--/` |
| Journal, corrections, identity integrations | One small Pi extension each | `mirror-pi/extensions/` |
| Soul Mode | A Pi skill, projected into the vault | `vault/.agents/skills/soul/` |
| The projection | `mirror-init` | `mirror-pi/src/projection.ts`, `scripts/mirror-init.sh` |

- `mirror-pi/docs/` — architecture, TypeScript guidelines, evals, and the memory strategy comparison.
- `dev/pi-agent/` — the Pi agent directory for development sessions.

## Checks

```sh
pnpm check                 # types, lint, contract evals
pnpm test:integration      # real Pi sessions with a scripted model
pnpm test:mutants          # break each guarantee and require the evals to fail
pnpm test:behavior         # the real chat model's observable behavior
```

The starter content in `starter/` is synthetic. See [NOTICE.md](NOTICE.md) for attribution.
