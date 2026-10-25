# Architecture

Mirror is plain Pi at the root of a Markdown vault, plus a few small Mirror extensions. There is no Mirror server, no Mirror database, and no memory service.

## Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| How the mirror answers | `vault/AGENTS.md` | Pi loads it as a context file at the vault root. It tells the model to read the identity files, how to use journeys, and how to search earlier sessions. |
| Identity | `identity/` in the vault, from `starter/identity/` | Markdown read by the model with Pi's `read` tool. Nothing composes or injects it. |
| Soul Mode | `vault/.agents/skills/soul/` | A Pi skill in the vault: the ritual in `SKILL.md`, one file per voice in `voices/`. Cards and the fruit live in the conversation. A harvested fruit is saved with `mirror_save_journal`. |
| Identity integrations | `mirror-pi/extensions/identity.ts` | `mirror_integrate_identity`: after the user confirms the exact text in a dialog, appends a dated bullet to the layer's section (self, shadow, ego, or persona file). |
| A journey | `journeys/<slug>/` in the vault | A directory directly below `journeys/`: the present state of one topic and what is known about it. Its `AGENTS.md` holds the journey context. |
| Journeys in a session | `mirror-pi/extensions/journeys.ts` | See [Journeys](#journeys). |
| Conversation history and memory | Pi session files | Pi stores sessions per working directory in `<agent dir>/sessions/--<path>--/`. The vault `AGENTS.md` gives the model a `jq` and `rg` command that searches the user's and the mirror's messages in every session of the vault: the vault root and the older journey directories. |
| Journal entries | `mirror-pi/extensions/journal.ts` | `mirror_save_journal`: a Markdown file in the session journey's `journal/`. |
| Corrections | `mirror-pi/extensions/corrections.ts` | `mirror_record_correction`: a Markdown file in the session journey's `corrections/` that states what is true now. |
| A vault | `mirror-pi/src/projection.ts` | `mirror-init` projects this repository into a vault with its own Git repository. See [Vault projection](#vault-projection). |
| Loading the extensions | The vault's `.pi/settings.json` | Declares this repository as a Pi package. The `pi` manifest in `package.json` lists the four extensions. Pi loads them after the user trusts the vault. |

Each Mirror extension does one thing and works without the others. Shared code is in `mirror-pi/src/`.
[memory-strategies.md](memory-strategies.md) explains why memory is Pi's session files and not AI Memory.

## Journeys

A session starts at the vault root without a journey. The journey is a choice that the user confirms, not a directory.

| Step | Mechanism |
|---|---|
| No journey yet | Before each run, the extension adds a `mirror_journey` system prompt section that lists the journeys, with the `description` from each journey's front matter. |
| Proposal | The model calls `mirror_enter_journey(slug, reason)`. The user sees "Continue in health?" with the reason, and confirms or declines. Without an interactive user, the tool refuses. |
| Binding | A confirmed proposal appends a `mirror-journey` custom entry `{ slug }` to the session and names the session after the journey. The latest entry on the branch is the session's journey. |
| Context | From the next run on, the `mirror_journey` section holds the journey's `AGENTS.md` and names the other journeys. |
| Switch | The same tool and dialog. A later `mirror-journey` entry replaces the earlier one. |
| Decision record | Every proposal appends a `mirror-decision` custom entry `{ decision: enter or switch, slug, from, reason, outcome: confirmed, declined, or no-ui }`. These are the evidence for a later decision model. |
| Records | Journal entries and corrections go to the session's journey. Without one, the tools refuse. |

Reads cross journeys freely: every journey can read every other journey's files and sessions. Only the binding and the records follow the journey.
A session started inside a journey directory, as before, still belongs to that journey, and Pi loads that journey's `AGENTS.md` as a context file.

## Vault projection

The repository and a vault are separate directories. Pi loads every `AGENTS.md` from the working directory and its parents, so a vault inside this repository would load the developer guide into Mirror sessions.

| Repository | Vault | Rule |
|---|---|---|
| `vault/` | `AGENTS.md`, `README.md`, `.agents/skills/` | Mirror owns them. Every projection writes them. |
| this repository's path | `.pi/settings.json` | Mirror owns it. It declares this repository as a Pi package. |
| `vault/.pi/.gitignore` | `.pi/.gitignore` | Mirror owns it. The vault's Git keeps `.pi/agent/sessions/` and `settings.json`, and ignores every other file in `.pi/agent/`. |
| `starter/` | `identity/`, `journeys/` | Copied only into a new vault, one without `AGENTS.md`. They never replace a file. Then they are the user's. |
| none | everything else | Never touched. |

`scripts/mirror-init.sh <vault>` creates the directory and runs `git init` when it is not a Git repository. It refuses to replace a Mirror file that has uncommitted changes, and then writes nothing. It commits only its own files, Mirror's files and the starter files it copied, with the repository commit in the message, so each projection is one commit in the vault. Other staged work of the user stays staged.
Evals, the development vault, and the user's vault all use it.

## Launcher

`scripts/mirror.sh` starts Mirror with the installed `pi`, the same binary as personal Pi, and a separate configuration:

```text
<vault>/.pi/agent/                     PI_CODING_AGENT_DIR for Mirror
  settings.json                        the model, copied once from agent/settings.json, then the user's (in the vault's Git)
  sessions/                            Mirror's sessions (in the vault's Git)
  trust.json                           the saved trust decision for the vault (ignored)
  auth.json -> ~/.pi/agent/auth.json   the only shared file (ignored)
```

It then runs `pi` at the root of `MIRROR_VAULT`, with the arguments unchanged. It refuses to start when `pi --version` differs from the version pinned in `package.json`, because the evals run on that version.

## Development setup

`scripts/dev-setup.sh` projects this repository into `~/.local/state/mirror/vault-dev`, a vault with its own Git. `scripts/dev-pi.sh` runs `scripts/mirror.sh` with that vault, from any directory, so development sessions run exactly as production and stay in `vault-dev/.pi/agent/`. The search command in the vault `AGENTS.md` reads `PI_CODING_AGENT_DIR`, so it searches the sessions of the vault it runs in.

Evals do not use it: each eval process has its own temporary agent directory, and the behavior evals take the model from `agent/settings.json`.

## Session lifecycle

```text
cd vault && pi
  ├─ Pi loads vault/AGENTS.md and, in a trusted vault, Mirror's package from .pi/settings.json
  └─ Pi stores the session in <agent dir>/sessions/--…-vault--/

each run
  └─ the journeys extension adds the mirror_journey section: the journey list, or the journey's context

first answer
  ├─ the model reads identity/ files as AGENTS.md instructs
  └─ when the answer may depend on the past, the model searches the session files, journals, and corrections of every journey

the topic matches a journey
  └─ mirror_enter_journey → dialog → mirror-journey and mirror-decision entries

a record on request
  └─ mirror_save_journal or mirror_record_correction writes a file in journeys/<slug>/
```

## Guarantees and how they are enforced

| Guarantee | Mechanism | Eval |
|---|---|---|
| A session enters or switches a journey only when the user confirms | `mirror_enter_journey` binds only after a confirmed dialog. Without an interactive user, it refuses. | integration "a confirmed proposal", "a declined proposal", mutants on the dialog and on the missing user |
| Every proposal is recorded with its outcome | A `mirror-decision` entry for confirmed, declined, and no-ui. | same integration tests, mutant that records a declined proposal as confirmed |
| The model gets the session journey's context, and not another's | The `mirror_journey` section from the latest `mirror-journey` entry. | integration "a session in a journey gets that journey's context", mutant that drops the binding |
| Records go to the session's journey, also after a switch | The latest `mirror-journey` entry on the branch. | integration "after a switch", mutant that uses the first entry |
| Records need a journey | The record tools refuse without one. | integration "a session without a journey cannot save records", mutant |
| The search sees every journey, at the vault root and in older journey directories | A command that builds both directory names from the vault path. | integration "a later session finds earlier conversations of every journey", mutants on the path and on the journey directories |
| The search finds what the mirror said, not tool output | The command keeps user and assistant messages only. | same integration test, mutants on the message filter |
| The launcher runs only the tested Pi version, at the vault root, with Mirror's agent directory in the vault's `.pi/agent`, and keeps the user's settings | The version check and `PI_CODING_AGENT_DIR` in `scripts/mirror.sh`. | `launcher.test.ts` with a fake `pi`, five mutants |
| The sessions can be committed with the vault, and `auth.json` and trust decisions never are | The projected `.pi/.gitignore` allows only `sessions/` and `settings.json` in `.pi/agent/`. | `projection.test.ts`, two mutants |
| Mirror's extensions load in a trusted vault, and not in an untrusted one | The vault's `.pi/settings.json` package, under Pi's project trust. | integration "a trusted vault loads Mirror's extensions", mutants on the manifest and on the projected settings |
| A projection keeps the user's files and work | Starter files only into a new vault and never over a file; a refusal before any write when a Mirror file has uncommitted changes; a commit of only its own files. | `projection.test.ts`, six mutants |
| Records never overwrite | Exclusive file creation; a taken name gets the next number. | `records.test.ts`, mutant |
| Identity changes only with the user's confirmation | `mirror_integrate_identity` shows the exact text in a dialog and writes only when the user confirms. Without an interactive user, it refuses. | integration "declined dialog", "without an interactive user", mutant that ignores a declined dialog |
| Integrations append and never replace | The bullet goes at the end of the layer's section; every earlier line stays, in order. | `identity.test.ts`, mutants that replace the file or use another section |

Behavior that depends on the model, such as proposing a fitting journey, reading the identity, searching earlier sessions, recording corrections, following the Soul Mode ritual, or not editing identity files with other tools, is checked by the behavior evals, not enforced.

## Known limits

- The model must propose journeys, read the identity files, and search earlier sessions itself. The behavior evals check that it does.
- A journey's context reaches the model from the message after the binding. In the turn of the binding, the tool tells the model to read the journey's `AGENTS.md` itself.
- `pi -c` continues the latest session of the vault, whatever its journey. The session name shows the journey in `/resume`.
- Memory search is lexical. The model chooses the terms; a memory phrased with other words can be missed. The comparison used 24 sessions. Searching years of sessions was not tested and will cost more per question.
- The search output names the session file, not its journey.
- Moving the vault, or cloning it to another path, moves its sessions, but Pi names their directory after the vault path. Earlier sessions stay under the old name, outside the search, until you rename that directory. Renaming a journey leaves earlier bindings with the old name.
- The projection writes the repository's absolute path into the vault's `.pi/settings.json`. Moving the repository needs a new projection.
- Mirror never commits the vault's content: its sessions in `.pi/agent/sessions/`, journals, corrections, and identity files. They enter the vault's history when the user commits, with the workflow the user chooses. Only the projection commits, and only Mirror's own files.
- Started with personal Pi instead of the launcher, a vault session loads personal context files, extensions, and AI Memory capture. The evals do not cover that.
- Pi's default system prompt describes a coding assistant. The vault `AGENTS.md` replaces that role in words only.
- The model has Pi's default tools, including `bash`, `edit`, and `write`. Only the instructions stop it from editing identity files with them. The confirmation dialog guards only `mirror_integrate_identity` and `mirror_enter_journey`.
- Soul Mode is instructions only: nothing enforces the ritual's order, and there is no Soul state outside the conversation. A fruit that was not saved stays only in the session file.
- Soul Mode does not record integration provenance beyond the bullet's date. Mirror Mind also keeps an audit record with the origin and conversation.
- The projection does not delete a Mirror file that was removed from `vault/`. Remove it from the vault by hand.
- Explorer, tasks, and attachment search are not implemented.
- Shared skills in `~/.agents/skills` still load into Mirror and development sessions, whatever the agent directory.
- `auth.json` in Mirror's and the development agent directory is a symbolic link. Pi locks the link path, not its target, so an OAuth refresh in a Mirror session and in personal Pi at the same moment can race. The likely result is a new login.
