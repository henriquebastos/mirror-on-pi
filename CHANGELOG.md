# Changelog

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
