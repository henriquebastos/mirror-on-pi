# Mirror

Mirror is a reflective companion that runs as plain Pi sessions. The session cwd is the content root. Mirror uses the identity, journey map, and journeys that exist there, without searching parents.
Each journey is a directory with the present state of one part of your life. A session starts without a journey; when the topic fits one, the mirror enters it and says so. If it chose wrong, tell it.
Memory is Pi's own session files: the model searches the earlier sessions of every journey with `jq` and `rg`, as Mirror's instructions say.
A few small Mirror extensions enter journeys, save journal entries and corrections, and append identity integrations you agree to in Soul Mode.

This repository is the code. A vault is a separate directory with its own Git repository. `scripts/mirror-init.sh <vault>` projects the repository into a vault: it creates the vault and its Git repository when needed, writes the files Mirror owns, copies the starter content into a new vault, and commits what changed. Run it again to update a vault. It never touches your own files.

## Start (development)

```sh
pnpm install
scripts/dev-setup.sh           # mirror-init into the development vault

scripts/dev-pi.sh              # new session, from any directory
scripts/dev-pi.sh -c           # continue the latest session
```

`dev-pi.sh` is `scripts/mirror.sh` with the development vault, `~/.local/state/mirror/vault-dev`. Development runs as production.
The first session asks whether to trust the vault: trust loads Mirror's extensions. In print mode, pass `-a`.
The model needs `jq` and `rg` on the `PATH`.

## Use with your own vault

Use a release, not this working tree: the vault loads Mirror from the directory that ran `mirror-init`, so a vault projected from here runs every uncommitted change.

```sh
git worktree add ~/.local/share/mirror/v0.2.0 v0.2.0 && pnpm -C ~/.local/share/mirror/v0.2.0 install
ln -sfn ~/.local/share/mirror/v0.2.0 ~/.local/share/mirror/current
~/.local/share/mirror/current/scripts/mirror-init.sh ~/my-vault                 # again after each upgrade
cd ~/my-vault && pi                                                              # trust the vault once
```

Start your own `pi` at the vault root. Pi loads Mirror, its extensions and the Soul skill, only in a session that starts there, after you trust the vault once. A session in any other directory, a directory below the vault root too, is a plain Pi session. Your sessions stay in your Pi session directory, and the mirror searches them there.

To upgrade, install the new tag the same way, run its `mirror-init`, and move `current`. To roll back, run the old release's `mirror-init` and move `current` back. Your own `pi` does not check its version: after a Pi update, run the evals of the installed release on the new version, or start Mirror with the launcher.

To start from a Mirror Mind home, migrate it into the new vault before the first `mirror-init`:

```sh
~/.local/share/mirror/current/scripts/mirror-migrate.sh ~/.mirror/<user> ~/.mirror/<user> ~/my-vault
```

The first home gives the identity, the second the conversations and memories; they can differ. The migration reads the homes and never writes them. It writes identity files and journeys (`journeys/<slug>/JOURNEY.md`) with their text unchanged, one Pi session per conversation (searchable like Mirror's own), and the memories as read-only archives in `journeys/<slug>/archive/`. Tasks are not migrated. It commits nothing: review the vault, then commit. A vault with its own identity gets no starter content.

The launcher, `scripts/mirror.sh`, is optional. Development uses it. It runs your installed `pi` at the vault root with Mirror's own Pi agent directory in the vault, `.pi/agent/`. Your personal Pi settings, context files, extensions, and sessions stay out; only `auth.json` is shared, by a symbolic link. Its sessions stay in that directory, and you can commit them with your notes. The vault's `.pi/.gitignore` keeps only the auth link, trust decisions, and caches out of Git.
It starts only when the installed `pi` is the version this repository pins and tests. This repository follows the latest Pi release; after an update here, update the installed `pi` too.

## How it fits together

| Part | Owner | Location |
|---|---|---|
| Mirror's instructions, including how to search earlier sessions | Mirror, added to the system prompt in a vault session, not in a subagent | `mirror-pi/instructions.md` |
| The vault map, `AGENTS.md`, with the list of journeys outside `journeys/` | You, after `mirror-init` copies the starter map once | `starter/AGENTS.md` |
| Identity and journeys | You, after `mirror-init` copies the starter content into a new vault | `starter/` |
| Journal, corrections, your files | You, in the vault | The vault |
| Conversation history and memory | Pi | `<Pi agent directory>/sessions/--<vault path>--/` |
| Instructions, journeys, journal, corrections, identity | One small Pi extension each, loaded as a Pi package from the vault's `.pi/settings.json` at the vault root | `mirror-pi/extensions/` |
| Soul Mode | A Pi skill in the Mirror package, offered only where Pi loads the package | `mirror-pi/skills/soul/` |
| The projection | `mirror-init` | `mirror-pi/src/projection.ts`, `scripts/mirror-init.sh` |
| Migration from Mirror Mind | `mirror-migrate` | `mirror-pi/src/mirror-mind.ts`, `mirror-pi/src/migration.ts`, `scripts/mirror-migrate.sh` |

- `mirror-pi/docs/` — architecture, TypeScript guidelines, evals, and the memory strategy comparison.
- `agent/settings.json` — Mirror's default Pi settings, with the model. The launcher copies them into a new vault's `.pi/agent/`, and the behavior evals use the same model.

## Checks

```sh
pnpm check                 # types, lint, contract evals
pnpm test:integration      # real Pi sessions with a scripted model
pnpm test:mutants          # break each guarantee and require the evals to fail
pnpm test:behavior         # the real chat model's observable behavior
```

The starter content in `starter/` is synthetic. See [NOTICE.md](NOTICE.md) for attribution.
