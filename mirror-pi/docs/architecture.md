# Architecture

Mirror is plain Pi with a few small extensions. The session cwd is the content root. Each feature uses its conventional files independently, when they exist. No marker, configured root, or parent search selects a vault. There is no Mirror server, no Mirror database, and no memory service.

## Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| How the mirror answers | `mirror-pi/instructions.md`, added by `mirror-pi/extensions/instructions.ts` | Before each non-subagent run with the package loaded, a `mirror_instructions` system prompt section holds them, even without identity or journeys. They tell the model when to read the identity files, how to use journeys, and how to search earlier sessions. They come from the release, not from a vault file. |
| The vault map | The vault's `AGENTS.md`, from `starter/AGENTS.md` | The user's file. Pi loads it as a context file for every agent that starts in the vault. Its `## Journeys` section lists journeys outside `journeys/`. |
| Subagents | `isSubagent()` in `mirror-pi/src/pi.ts` | In a pi-subagents child process (`PI_SUBAGENT_CHILD=1`), Mirror adds no system prompt section. A subagent is the agent it was started as, with the vault map if it inherits project context. A fork copies the parent's whole prompt, so a fork is still the mirror. |
| Identity | `identity/` in the vault, from `starter/identity/` | Markdown. The model reads the files only for personal or reflective conversation, not for work. |
| Identity in every session | `mirror-pi/extensions/identity.ts`, `mirror-pi/src/identity-context.ts` | Before each run, a `mirror_identity` system prompt section holds the hard constraints (`identity/ego/constraints.md`) in full and one line per other identity file, personas with their name and description. A vault without identity files gets no section. |
| Soul Mode | `mirror-pi/skills/soul/` | A Pi skill in the Mirror package: the ritual in `SKILL.md`, one file per voice in `voices/`. Pi offers it only in a session that loads the package, so not in a directory below the vault root. Cards and the fruit live in the conversation. A harvested fruit is saved with `mirror_save_journal`. |
| Identity integrations | `mirror-pi/extensions/identity.ts` | `mirror_integrate_identity`: after the user agrees in the chat to the exact text, appends a dated bullet to the layer's section (self, shadow, ego, or persona file). |
| A journey | A directory in the vault | The cwd itself when it holds `JOURNEY.md`, a directory directly below `journeys/`, or a directory listed in the `## Journeys` section of the vault map as `` - `slug`: `path/` ``: the present state of one topic and what is known about it. Its `JOURNEY.md` holds the journey context, for the mirror only: Pi does not load it as a context file, so other agents in that directory do not get it. A listed directory that is missing on this machine, or outside the vault, is not a journey. |
| Journeys in a session | `mirror-pi/extensions/journeys.ts` | See [Journeys](#journeys). |
| Conversation history and memory | Pi session files | Pi stores sessions per working directory in `<agent dir>/sessions/--<path>--/`. Mirror's instructions give the model a `jq` and `rg` command that searches the user's and the mirror's messages in every session of the vault: the vault root and every directory below it. |
| Journal entries | `mirror-pi/extensions/journal.ts` | `mirror_save_journal`: a Markdown file in the session journey's `journal/`, or in the vault's `journal/` when the session has no journey. |
| Corrections | `mirror-pi/extensions/corrections.ts` | `mirror_record_correction`: a Markdown file in the session journey's `corrections/` that states what is true now. |
| A vault | `mirror-pi/src/projection.ts` | `mirror-init` projects this repository into a vault with its own Git repository. See [Vault projection](#vault-projection). |
| Loading the extensions | The vault's `.pi/settings.json` | Declares this repository as a Pi package. The `pi` manifest in `package.json` lists the five extensions and the skills directory. Pi loads them after the user trusts the vault, only in a session that starts at the vault root. |

Each Mirror extension does one thing and works without the others. Shared code is in `mirror-pi/src/`.
[memory-strategies.md](memory-strategies.md) explains why memory is Pi's session files and not AI Memory.

## Journeys

A session starts without a journey unless its cwd holds `JOURNEY.md`. That file makes the cwd the default journey, named after the directory. The model enters the journey the conversation is about and follows the user's direction. There is no dialog: the user corrects a wrong journey in the chat.

| Step | Mechanism |
|---|---|
| No journey yet | Before each run, the extension adds a `mirror_journey` system prompt section that lists the journeys, with each directory and the `description` from each journey's front matter. |
| Entry | When the topic clearly fits one journey, or the user names one, the model calls `mirror_enter_journey(slug, reason)` and names the journey in a few words in its answer. The tool needs no UI, so it works in `pi -p` too. It refuses a journey that does not exist. |
| Binding | The tool appends a `mirror-journey` custom entry `{ slug, from, reason }` to the session and names the session after the journey. The latest entry on the branch is the session's journey. |
| Context | From the next run on, the `mirror_journey` section names the journey's directory, holds its `JOURNEY.md`, and names the other journeys. |
| Switch and correction | The same tool. A later `mirror-journey` entry replaces the earlier one. A switch right after an entry, following the user's words, is a correction. The entries are the evidence for a later decision model. Sessions from before this change may also hold `mirror-decision` entries; nothing reads them. |
| Records | Journal entries and corrections go to the session's journey. Without one, the tools refuse. |

Reads cross journeys freely: every journey can read every other journey's files and sessions. Only the binding and the records follow the journey.
A cwd journey appears as `./` in the journey list and takes precedence over a mapped journey with the same slug. An explicit session binding overrides the cwd journey. Journal entries and corrections use the same rule. A directory below that journey does not inherit its Mirror content.

Identity and journeys are independent. Without local identity files, no `mirror_identity` section is added. Without journeys or an earlier binding, no `mirror_journey` section is added. Identity integration requires a local `identity/` directory. Pi still loads ancestor `AGENTS.md` files normally.

These behaviors require Mirror's extensions in that session. Pi reads `.pi/settings.json` only in the starting directory. A plain `pi` started below a projected vault does not load Mirror's extensions from the parent. The launcher always starts at the vault root.

## Directory context

Pi loads the `AGENTS.md` files of the starting directory and its parents only. Mirror's instructions tell the model to read each `AGENTS.md` between the starting directory and a directory below it before it works there, and to look at the skills in the `.agents/skills/` directories next to them. The starter map says the same to every agent. No extension enforces it; the behavior eval checks that the model reads the file and follows it.

## Vault projection

The repository and a vault are separate directories. Pi loads every `AGENTS.md` from the working directory and its parents, so a vault inside this repository would load the developer guide into Mirror sessions.

| Repository | Vault | Rule |
|---|---|---|
| `vault/` | `README.md` | Mirror owns it. Every projection writes it. |
| this repository's path | `.pi/settings.json` | Mirror owns it. It declares this repository as a Pi package. |
| `vault/.pi/.gitignore` | `.pi/.gitignore` | Mirror owns it. The vault's Git keeps `.pi/agent/sessions/` and `settings.json`, and ignores every other file in `.pi/agent/`. |
| `starter/AGENTS.md` | `AGENTS.md` | The user's map. Copied into a vault without `AGENTS.md` that Mirror has not projected before, a migrated one too. It replaces, once, the instructions that Mirror 0.1.0 and 0.1.1 kept in that file; an uncommitted edit of them stops the projection. A map the user edited or deleted stays so. |
| none | `.agents/skills/soul/` | Mirror 0.1 projected the Soul skill here. The projection deletes its five files and the directories they leave empty, and commits the deletion. An uncommitted edit of them stops the projection. |
| `starter/` | `identity/`, `journeys/` | Copied only into a new vault, one without `AGENTS.md` and without an `identity/` directory (a migrated vault has its own). They never replace a file. Then they are the user's. |
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

`scripts/dev-setup.sh` projects this repository into `~/.local/state/mirror/vault-dev`, a vault with its own Git. `scripts/dev-pi.sh` runs `scripts/mirror.sh` with that vault, from any directory, so development sessions run exactly as production and stay in `vault-dev/.pi/agent/`. The search command in Mirror's instructions reads `PI_CODING_AGENT_DIR`, so it searches the sessions of the vault it runs in.

Evals do not use it: each eval process has its own temporary agent directory, and the behavior evals take the model from `agent/settings.json`.

## Session lifecycle

```text
cd vault && pi
  ├─ Pi loads the vault map (AGENTS.md) and, in a trusted vault, Mirror's package from .pi/settings.json
  └─ Pi stores the session in <agent dir>/sessions/--…-vault--/

each run
  ├─ the instructions extension adds mirror_instructions; the identity extension adds mirror_identity
  └─ the journeys extension adds the mirror_journey section: the journey list, or the journey's context
     (in a subagent: none of them)

first answer
  ├─ for a personal message, the model reads identity/ files as the instructions say
  └─ when the answer may depend on the past, the model searches the session files, journals, and corrections of every journey

the topic matches a journey
  └─ mirror_enter_journey → mirror-journey entry; the answer names the journey, and the user may correct it

a record on request
  └─ mirror_save_journal or mirror_record_correction writes a file in the journey's directory (a journal entry without a journey: in the vault's journal/)
```

## Guarantees and how they are enforced

| Guarantee | Mechanism | Eval |
|---|---|---|
| Entering a journey binds the session, with no UI, and records where it came from and why | `mirror_enter_journey` appends `{ slug, from, reason }` and names the session. | integration "entering a journey needs no UI", "after a switch", mutants that drop the entry or its fields |
| Only an existing journey can be entered | The tool checks the journey list. | integration "a journey that does not exist is refused", mutant |
| The model gets the session journey's context, and not another's | The `mirror_journey` section from the latest `mirror-journey` entry. | integration "a session in a journey gets that journey's context", mutant that drops the binding |
| Records go to the session's journey, also after a switch | The latest `mirror-journey` entry on the branch. | integration "after a switch", mutant that uses the first entry |
| Conventional content is local and independent | Extensions use `ctx.cwd` directly. Only a local `JOURNEY.md` selects a default journey. | integration: journeys without identity, identity without journeys, a nested session that refuses parent destinations, cwd context and records; mutants |
| Records need a journey | The record tools refuse without one. | integration "a session without a journey cannot save records", mutant |
| The search sees every journey, at the vault root and in older journey directories | A command that builds both directory names from the cwd path. | integration "a later session finds earlier conversations of every journey", mutants on the path and on the journey directories |
| The search finds what the mirror said, not tool output | The command keeps user and assistant messages only. | same integration test, mutants on the message filter |
| The launcher runs only the tested Pi version, at the vault root, with Mirror's agent directory in the vault's `.pi/agent`, and keeps the user's settings | The version check and `PI_CODING_AGENT_DIR` in `scripts/mirror.sh`. | `launcher.test.ts` with a fake `pi`, five mutants |
| The sessions can be committed with the vault, and `auth.json` and trust decisions never are | The projected `.pi/.gitignore` allows only `sessions/` and `settings.json` in `.pi/agent/`. | `projection.test.ts`, two mutants |
| Mirror's extensions and Soul skill load at the root of a trusted vault, and not in an untrusted one or below the root | The vault's `.pi/settings.json` package, under Pi's project trust; Pi reads it only in the starting directory. | integration "Mirror's extensions and Soul skill load as a Pi package", mutants on the manifest's extensions and skills and on the projected settings |
| A projection keeps the user's files and work | Starter files only into a new vault and never over a file; a refusal before any write when a Mirror file or the former Soul skill has uncommitted changes; a commit of only its own files. | `projection.test.ts`, six mutants |
| A projection deletes the Soul skill that Mirror 0.1 projected, in its commit | The five former files, deleted after the conflict check. | `projection.test.ts`, three mutants |
| Records never overwrite | Exclusive file creation; a taken name gets the next number. | `records.test.ts`, mutant |
| An integration writes the exact text it reports | `mirror_integrate_identity` appends the bullet and reports the file and section. | integration "an integration is appended", mutant that reports without writing |
| The hard constraints reach every run | The `mirror_identity` section holds them in full, without front matter, also when the front matter is broken. | `identity-context.test.ts`, integration "every session at the vault root", three mutants |
| Integrations append and never replace | The bullet goes at the end of the layer's section; every earlier line stays, in order. | `identity.test.ts`, mutants that replace the file or use another section |

Behavior that depends on the model, such as entering a fitting journey, following the user's correction, recording an integration only after the user agrees, reading the identity, searching earlier sessions, recording corrections, following the Soul Mode ritual, or not editing identity files with other tools, is checked by the behavior evals, not enforced.

## Known limits

- The model must enter journeys, follow the user's corrections, read the identity files when the conversation is personal, and search earlier sessions itself. The behavior evals check that it does.
- A journey's context reaches the model from the message after the binding. In the turn of the binding, the tool tells the model to read the journey's `JOURNEY.md` itself.
- `pi -c` continues the latest session of the vault, whatever its journey. The session name shows the journey in `/resume`.
- Memory search is lexical. The model chooses the terms; a memory phrased with other words can be missed. The comparison used 24 sessions. Searching years of sessions was not tested and will cost more per question.
- The search output names the session file, not its journey.
- Moving the vault, or cloning it to another path, moves its sessions, but Pi names their directory after the vault path. Earlier sessions stay under the old name, outside the search, until you rename that directory. Renaming a journey leaves earlier bindings with the old name.
- The projection writes the repository's absolute path into the vault's `.pi/settings.json`. Moving the repository needs a new projection.
- Mirror never commits the vault's content: its sessions in `.pi/agent/sessions/`, journals, corrections, and identity files. They enter the vault's history when the user commits, with the workflow the user chooses. Only the projection commits, and only Mirror's own files.
- Started with personal Pi instead of the launcher, a vault session also loads the personal context files, extensions, and skills, and no check pins the Pi version. The evals do not cover that.
- Pi's default system prompt describes a coding assistant. Mirror's instructions add the mirror's role in words only.
- A directory's `AGENTS.md` and skills below the starting directory reach the model only when it follows the instruction to read them. The behavior eval shows that both models skip them without the instruction.
- A journey whose context is still in an `AGENTS.md`, from Mirror 0.1.2 or earlier, has no context or description for the mirror until the file is renamed to `JOURNEY.md`.
- A plain `pi` started below the vault root loads no Mirror extension, because Pi reads the project's `.pi/settings.json` only in the starting directory. That session gets only the `AGENTS.md` files of its directory and the parents.
- The session search command uses the working directory. In a session started below the vault root, it searches that directory and directories below it, not parent sessions. Pi names session directories with `-` for `/`, so the search also reads the sessions of a sibling directory whose name starts with the vault's name and `-`.
- A subagent is recognized only by the `PI_SUBAGENT_CHILD` variable of pi-subagents. Its Mirror tools stay registered; only the system prompt sections are left out.
- The model has Pi's default tools, including `bash`, `edit`, and `write`. Only the instructions stop it from editing identity files with them, and from calling `mirror_integrate_identity` before the user agrees. No dialog guards any tool.
- Soul Mode is instructions only: nothing enforces the ritual's order, and there is no Soul state outside the conversation. A fruit that was not saved stays only in the session file.
- A migrated session starts at the conversation's start time, but its messages keep Mirror Mind's message times, which can be the time Mirror Mind imported them. Migrated sessions appear in `/resume` with Pi's own. Memory archives are plain Markdown: nothing ranks or deduplicates them.
- Soul Mode does not record integration provenance beyond the bullet's date. Mirror Mind also keeps an audit record with the origin and conversation.
- The projection does not delete a Mirror file that was removed from `vault/`, except the former Soul skill. Remove it from the vault by hand.
- Explorer, tasks, and attachment search are not implemented.
- Shared skills in `~/.agents/skills` still load into Mirror and development sessions, whatever the agent directory.
- `auth.json` in Mirror's and the development agent directory is a symbolic link. Pi locks the link path, not its target, so an OAuth refresh in a Mirror session and in personal Pi at the same moment can race. The likely result is a new login.
