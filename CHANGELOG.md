# Changelog

## 0.1.5 — 2026-10-27

The vault README tells where conversations are for each way to start Pi.

### Changes

- With your own `pi` at the vault root, sessions stay in your Pi session directory, outside the vault. With `scripts/mirror.sh`, they are in the vault's `.pi/agent/sessions/`, and you can commit them. The README no longer says both "commit the sessions" and "conversations are not in the vault" for every vault.

### Validation

- Contract evals 40/40, integration evals 20/20. The change is in the projected `README.md` only; no code or instruction changed, so mutants and behavior evals were not run again.

## 0.1.4 — 2026-10-27

Mirror reads its content from the directory where the session starts. It does not search parent directories for a vault.

### Changes

- The session's working directory is the content root. Mirror uses `identity/`, the `AGENTS.md` journey map, and `journeys/` only when they are in that directory. Each one is optional and independent of the others.
- A `JOURNEY.md` in the working directory makes that directory the default journey. The journey list shows it as `./`, and it wins over a mapped journey with the same slug. An explicit `mirror_enter_journey` overrides it for context and records.
- Mirror's instructions join every session that loads the package, except subagents, also when the directory has no identity and no journeys.
- `mirror_integrate_identity` refuses to write when the working directory has no `identity/`.
- **Upgrade:** `scripts/mirror.sh` still starts sessions at the vault root, so sessions through the launcher work as before.

### Validation

- Contract evals 40/40, integration evals 20/20, mutants 69/69 killed.
- Behavior evals with real models, 14 scenarios over 3 runs: `openai/gpt-6-astra` 42/42 and `openrouter/anthropic/claude-opus-5.5` 42/42.

## 0.1.3 — 2026-10-26

A journey's context moves to `JOURNEY.md`, and the mirror reads the `AGENTS.md` of the directories it works in.

### Changes

- A journey's context is its `JOURNEY.md`, for the mirror only. Pi does not load it, so other agents in a journey directory, a code repository included, do not get it. `AGENTS.md` in a journey directory is for every agent.
- **Upgrade:** rename each `journeys/<slug>/AGENTS.md` that holds journey context to `JOURNEY.md`. Until then, that journey has no context or description for the mirror. Migration and the starter journeys write `JOURNEY.md`.
- A session started in a journey directory gets that journey's context in the `mirror_journey` section.
- Mirror's instructions tell the model to read each `AGENTS.md` between the starting directory and the directory it works in, and to look at the skills next to them. The starter map says the same to every agent. No extension enforces it.

### Validation

- Contract evals 39/39, integration evals 15/15, mutants 59/59 killed.
- Behavior evals with real models, 12 scenarios over 3 runs: `openai/gpt-6-astra` 36/36 and `openrouter/anthropic/claude-opus-5.5` 36/36.
- Negative control: without the instruction, both models skipped the nested `AGENTS.md` in 3 of 3 runs each.

## 0.1.2 — 2026-10-26

The vault's `AGENTS.md` becomes your map, and a journey can be any directory of the vault.

### Changes

- Mirror's instructions come from the release as a `mirror_instructions` system prompt section, not from the vault's `AGENTS.md`.
- The vault's `AGENTS.md` is yours: a short map that every agent starting in the vault reads. `mirror-init` copies a starter map into a vault it has not projected before, and replaces Mirror's former instructions with it once. It never writes the map again.
- A journey is a directory below `journeys/`, or a directory listed in the map's `## Journeys` section as `` - `slug`: `path/` ``. A listed directory that is missing on this machine is skipped. Records go to the journey's directory.
- A subagent started in the vault (`PI_SUBAGENT_CHILD=1`) is not the mirror: it gets no Mirror instructions, identity, or journeys.
- The session search reads the sessions of every directory of the vault.

### Validation

- Contract evals 39/39, integration evals 14/14, mutants 56/56 killed.
- Behavior evals with real models, 11 scenarios over 3 runs: `openai/gpt-6-astra` 33/33 and `openrouter/anthropic/claude-opus-5.5` 33/33.

## 0.1.1 — 2026-10-26

Plain by default: most sessions are work, and the mirror reads the identity only when the conversation needs it.

### Changes

- Every session at the vault root gets the hard constraints in full and a one-line map of the identity files in the system prompt (`mirror_identity`). Personas are listed with their name and description. A vault without identity files gets nothing.
- The model reads the identity files before a personal or reflective answer, and not for code, facts, research, or files. The vault `AGENTS.md` no longer says the mirror is not a coding agent.

### Validation

- Contract evals 35/35, integration evals 12/12, mutants 44/44 killed.
- Behavior evals with real models, 11 scenarios, once each: `openai/gpt-6-astra` 11/11 and `openrouter/anthropic/claude-opus-5.5` 11/11. The new identity scenario passed 3 more runs on each model.
- Negative control: with the 0.1.0 `AGENTS.md`, the new identity scenario fails (the model reads identity files for a coding question).

## 0.1.0 — 2026-10-26

The first internal release: Mirror as plain Pi sessions at the root of a Markdown vault in Git.

### What it does

- `scripts/mirror.sh` starts the installed `pi` at the vault root, with Mirror's own Pi agent directory in the vault (`.pi/agent/`). Only `auth.json` is shared with personal Pi. It refuses a `pi` version other than the pinned one (1.4.0).
- `scripts/mirror-init.sh` projects a release into a vault: Mirror's instructions, the Soul skill, and the Pi package setting. It commits only these files.
- `scripts/mirror-migrate.sh` migrates a Mirror Mind home into a new vault: identity, journeys, conversations as Pi sessions, and memories as archives. It reads the home and never writes it. It commits nothing.
- The model reads the identity files, enters a journey when the topic fits and names it, and follows your correction in the chat. No dialog and no custom UI.
- Memory is Pi's session files, searched with `jq` and `rg` as the vault `AGENTS.md` instructs.
- Journal entries and corrections are saved only on your explicit request.
- Soul Mode: the Self, Shadow, Wisdom, and Beauty Voices, a fruit to harvest, and identity integrations recorded only after you agree in the chat.

### Validation

- Contract evals 31/31, integration evals 11/11, mutants 40/40 killed.
- Behavior evals with real models, 11 scenarios: `openai/gpt-6-astra` and `openrouter/anthropic/claude-opus-5.5` each passed 33/33 over 3 runs. After the last instruction changes, the 5 Soul scenarios passed 15/15 over 3 runs on each model, and the other 6 passed once on each model.

### Known limits

- Mirror never commits vault content. You choose the commit workflow.
- Only instructions stop the model from changing identity files or recording an integration before you agree. Git history shows every change.
- Pi names the session directory after the vault path. Moving the vault hides earlier sessions from search until you rename that directory.
- A vault started with personal Pi instead of the launcher loads personal context, extensions, and memory capture.
- Shared skills in `~/.agents/skills` load in every Pi session, including Mirror's.
- The auth link is created when the launcher starts. Two first starts at the same time can race.
- Reflective quality is not graded. Memory search is lexical.
- Migrated messages keep Mirror Mind's message times, which can be its import times.
- See `mirror-pi/docs/architecture.md` for the full list.
