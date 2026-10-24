# Mirror content vault

Open this directory as an Obsidian vault. Start Pi in a journey directory to talk with the mirror about that journey.

This starter content is synthetic and tracked in Git. Journal entries and corrections that sessions write here are ignored by Git.
For development sessions, `scripts/dev-setup.sh` copies this vault to `~/.local/state/mirror/vault-dev`.

- `AGENTS.md` — how the mirror answers. Pi loads it in every journey directory.
- `identity/` — who the mirror is and who it speaks with. The model reads these files. It changes them only to append a Soul Mode integration that you confirm.
- `.agents/skills/soul/` — Soul Mode. Pi finds it from every journey directory. Start it with `/skill:soul` or by asking for Soul Mode.
- `journeys/<slug>/AGENTS.md` — one durable topic and its context.
- `journeys/<slug>/.ai-memory.toml` — the journey's AI Memory workspace and project. Give each journey its own project.
- `journeys/<slug>/journal/` — journal entries saved on request.
- `journeys/<slug>/corrections/` — corrections recorded on request.
- `journeys/<slug>/files/` — your own PDFs, images, and notes for the journey.
