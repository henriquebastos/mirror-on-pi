# Mirror

Mirror is a reflective companion that runs as plain Pi sessions at the root of a Markdown vault.
Each journey is a directory with the present state of one part of your life. A session starts without a journey; when the topic fits one, the mirror proposes it and you confirm.
Memory is Pi's own session files: the model searches the earlier sessions of every journey with `jq` and `rg`, as the vault's `AGENTS.md` instructs.
A few small Mirror extensions enter journeys, save journal entries and corrections, and append identity integrations you confirm in Soul Mode.

This repository is the code. A vault is a separate directory with its own Git repository. `scripts/mirror-init.sh <vault>` projects the repository into a vault: it creates the vault and its Git repository when needed, writes the files Mirror owns, copies the starter content into a new vault, and commits what changed. Run it again to update a vault. It never touches your own files.

## Start (development)

```sh
pnpm install
scripts/dev-setup.sh           # auth link, and mirror-init into the development vault

scripts/dev-pi.sh              # new session, from any directory
scripts/dev-pi.sh -c           # continue the latest session
```

`dev-pi.sh` is plain `pi` at the development vault root with `PI_CODING_AGENT_DIR=dev/pi-agent`.
The first session asks whether to trust the vault: trust loads Mirror's extensions. In print mode, pass `-a`.
The model needs `jq` and `rg` on the `PATH`.

## Use with your own vault

```sh
scripts/mirror-init.sh ~/my-vault                                    # once, and again after each update of this repository
alias mirror='MIRROR_VAULT=~/my-vault ~/me/mirror/scripts/mirror.sh'  # in your shell profile
```

`scripts/mirror.sh` runs your installed `pi` at the vault root with Mirror's own Pi agent directory in the vault, `.pi/agent/`. Your personal Pi settings, context files, extensions, and sessions stay out; only `auth.json` is shared, by a symbolic link. Mirror's sessions stay in that directory, so they move with the vault. The vault's `.pi/.gitignore` keeps the directory out of the vault's Git.
It starts only when the installed `pi` is the version this repository pins and tests. This repository follows the latest Pi release; after an update here, update the installed `pi` too.

## How it fits together

| Part | Owner | Location |
|---|---|---|
| Mirror's instructions, including how to search earlier sessions | Mirror, projected into the vault | `vault/AGENTS.md` |
| Identity and journeys | You, after `mirror-init` copies the starter content into a new vault | `starter/` |
| Journal, corrections, your files | You, in the vault | The vault |
| Conversation history and memory | Pi | `<Pi agent directory>/sessions/--<vault path>--/` |
| Journeys, journal, corrections, identity integrations | One small Pi extension each, loaded as a Pi package from the vault's `.pi/settings.json` | `mirror-pi/extensions/` |
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
