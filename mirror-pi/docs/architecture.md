# Architecture

Mirror is plain Pi in a Markdown vault, plus a few small Mirror extensions. There is no launcher, no Mirror server, no Mirror database, and no memory service.

## Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| How the mirror answers | `vault/AGENTS.md` | Pi loads it as a context file from every directory below the vault. It tells the model to read the identity files and to search earlier sessions. |
| Identity | `identity/` in the vault, from `starter/identity/` | Markdown read by the model with Pi's `read` tool. Nothing composes or injects it. |
| Soul Mode | `vault/.agents/skills/soul/` | A Pi skill in the vault: the ritual in `SKILL.md`, one file per voice in `voices/`. Pi finds it from every journey directory. Cards and the fruit live in the conversation. A harvested fruit is saved with `mirror_save_journal`. |
| Identity integrations | `mirror-pi/extensions/identity.ts` | `mirror_integrate_identity`: after the user confirms the exact text in a dialog, appends a dated bullet to the layer's section (self, shadow, ego, or persona file). |
| A journey | `journeys/<slug>/` in the vault | A directory directly below `journeys/`. Its `AGENTS.md` holds the journey context. |
| Conversation history and memory | Pi session files | Pi stores sessions per working directory in `<agent dir>/sessions/--<path>--/`, so each journey has its own. The vault `AGENTS.md` gives the model a `jq` and `rg` command that searches the user's and the mirror's messages in them. |
| Journal entries | `mirror-pi/extensions/journal.ts` | `mirror_save_journal`: a Markdown file in the journey's `journal/`. |
| Corrections | `mirror-pi/extensions/corrections.ts` | `mirror_record_correction`: a Markdown file in the journey's `corrections/` that states what is true now. |

| A vault | `mirror-pi/src/projection.ts` | `mirror-init` projects this repository into a vault with its own Git repository. See [Vault projection](#vault-projection). |

Each Mirror extension does one thing and works without the others. Shared code is in `mirror-pi/src/`.
[memory-strategies.md](memory-strategies.md) explains why memory is Pi's session files and not AI Memory.

## Vault projection

The repository and a vault are separate directories. Pi loads every `AGENTS.md` from the working directory and its parents, so a vault inside this repository would load the developer guide into Mirror sessions.

| Repository | Vault | Rule |
|---|---|---|
| `vault/` | `AGENTS.md`, `README.md`, `.agents/skills/` | Mirror owns them. Every projection writes them. |
| `starter/` | `identity/`, `journeys/` | Copied only into a new vault, one without `AGENTS.md`. They never replace a file. Then they are the user's. |
| none | everything else | Never touched. |

`scripts/mirror-init.sh <vault>` creates the directory and runs `git init` when it is not a Git repository. It refuses to replace a Mirror file that has uncommitted changes, and then writes nothing. It commits only its own files, Mirror's files and the starter files it copied, with the repository commit in the message, so each projection is one commit in the vault. Other staged work of the user stays staged.
Evals, the development vault, and the user's vault all use it.

## Development setup

```text
dev/pi-agent/                 PI_CODING_AGENT_DIR for manual sessions
  settings.json               model and the three Mirror extensions (tracked)
  sessions/                   development sessions, one directory per journey (ignored)
  auth.json -> ~/.pi/agent/auth.json   (scripts/dev-setup.sh)
~/.local/state/mirror/vault-dev/       a projected vault with its own Git (scripts/dev-setup.sh)
```

`scripts/dev-pi.sh` runs `pi` with `PI_CODING_AGENT_DIR=dev/pi-agent`. The search command in the vault `AGENTS.md` reads the same variable, so it searches development sessions in development and personal sessions in personal Pi.

The separate agent directory keeps personal Pi settings, extensions, and sessions out of development sessions.

## Session lifecycle

```text
cd vault/journeys/health && pi
  ├─ Pi loads vault/AGENTS.md, then journeys/health/AGENTS.md
  └─ Pi stores the session in <agent dir>/sessions/--…-vault-journeys-health--/

first answer
  ├─ the model reads identity/ files as AGENTS.md instructs
  └─ when the answer may depend on the past, the model searches the journey's session files, journal, and corrections

a record on request
  └─ mirror_save_journal or mirror_record_correction writes a file in journeys/health/
```

## Guarantees and how they are enforced

| Guarantee | Mechanism | Eval |
|---|---|---|
| A session uses the journey of its directory | The nearest directory directly below `journeys/`, at or above the working directory. | `journey.test.ts`, mutants on the journey rule |
| A session's search sees only its own journey | Pi's session directory per working directory, and a command that builds the same path. | integration "a later session finds the earlier conversation", mutant on the path |
| The search finds what the mirror said, not tool output | The command keeps user and assistant messages only. | same integration test, mutants on the message filter |
| Records need a journey | The record tools refuse outside a journey directory. | integration "outside a journey directory", mutant |
| Mirror's instructions load in every journey | Pi's own context-file discovery. | integration "Pi loads Mirror's instructions" |
| A projection keeps the user's files and work | Starter files only into a new vault and never over a file; a refusal before any write when a Mirror file has uncommitted changes; a commit of only the projected files. | `projection.test.ts`, six mutants |
| Records never overwrite | Exclusive file creation; a taken name gets the next number. | `records.test.ts`, mutant |
| Identity changes only with the user's confirmation | `mirror_integrate_identity` shows the exact text in a dialog and writes only when the user confirms. Without an interactive user, it refuses. | integration "declined dialog", "without an interactive user", mutant that ignores a declined dialog |
| Integrations append and never replace | The bullet goes at the end of the layer's section; every earlier line stays, in order. | `identity.test.ts`, mutants that replace the file or use another section |

Behavior that depends on the model, such as reading the identity, searching earlier sessions, recording corrections, following the Soul Mode ritual, or not editing identity files with other tools, is checked by the behavior evals, not enforced.

## Known limits

- The model must read the identity files and search earlier sessions itself. The behavior evals check that it does.
- Memory search is lexical. The model chooses the terms; a memory phrased with other words can be missed. The comparison used 24 sessions. Searching years of sessions was not tested and will cost more per question.
- A session started in a subdirectory of a journey, such as `files/`, is stored and searched under that subdirectory, not under the journey.
- Renaming a journey or moving the vault changes the session directory name. Earlier sessions stay under the old name until you move or rename that directory.
- In personal Pi, the sessions are in `~/.pi/agent/sessions/`, so the dotfiles history archive also keeps them. The global AI Memory extension of personal Pi also captures Mirror sessions; Mirror does not use that capture.
- Pi's default system prompt describes a coding assistant. The vault `AGENTS.md` replaces that role in words only.
- The projection does not delete a Mirror file that was removed from `vault/`. Remove it from the vault by hand.
- Mirror's extensions load from the Pi agent directory's settings (`dev/pi-agent/settings.json` in development), not from the vault. A vault's `.pi/settings.json` would load only when Pi runs at the vault root, and sessions run in journey directories.
- The model has Pi's default tools, including `bash`, `edit`, and `write`. Only the instructions stop it from editing identity files with them. The confirmation dialog guards only `mirror_integrate_identity`.
- Soul Mode is instructions only: nothing enforces the ritual's order, and there is no Soul state outside the conversation. A fruit that was not saved stays only in the session file.
- Soul Mode does not record integration provenance beyond the bullet's date. Mirror Mind also keeps an audit record with the origin and conversation.
- Explorer, tasks, and attachment search are not implemented.
- Shared skills in `~/.agents/skills` still load into development sessions.
- `dev/pi-agent/auth.json` is a symbolic link. Pi locks the link path, not its target, so an OAuth refresh in a development session and in personal Pi at the same moment can race. The likely result is a new login.
