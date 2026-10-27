# Mirror vault

Open this directory as an Obsidian vault. Start Pi here, at the vault root, to talk with the mirror. When the topic fits a journey, the mirror enters it and says so. If it chose wrong, tell it.

Mirror uses the session cwd as the content root. Identity and journeys work independently when their files exist. A local `JOURNEY.md` makes the starting directory the default journey. Mirror does not search parents for content.

This vault is a Git repository. `mirror-init` in the Mirror repository builds it and updates it:

- It owns this `README.md`, `.agents/skills/`, `.pi/settings.json`, which loads Mirror's extensions once you trust this vault in Pi, and `.pi/.gitignore`. It writes them on every run and commits the change. Do not edit them here: your edit stops the next run while it is uncommitted, and is replaced once it is committed.
- It copied a starter `AGENTS.md`, the vault map, into the vault once. The map is yours. Mirror's instructions come from the Mirror release, not from a file here.
- It copied the starter identity and journeys into the new vault once, unless the vault already had an identity, as a vault migrated from Mirror Mind does. From then on they are yours, like every other file here.

- `AGENTS.md` — your map of the vault. Every agent that starts here reads it, subagents too. Keep it short. An `AGENTS.md` in any other directory holds the rules for agents that work there, and `.agents/skills/` next to it holds that directory's skills. List journeys outside `journeys/` in its `## Journeys` section, one per line, as `` - `slug`: `path/` ``.
- `identity/` — who the mirror is and who it speaks with. The model has the hard constraints and the list of files in every session, and reads the files when the conversation is personal. It changes them only to append a Soul Mode integration that you agree to.
- `.agents/skills/soul/` — Soul Mode. Start it with `/skill:soul` or by asking for Soul Mode.
- `journeys/<slug>/JOURNEY.md` — one durable topic of your life and its context, for the mirror only. Each directory below `journeys/` is a journey, and so is each directory listed in the map. The `description` in its front matter tells the mirror when the journey fits.
- `journal/` and `corrections/` in the journey's directory — journal entries and corrections saved on request.
- `journeys/<slug>/files/` — your own PDFs, images, and notes for the journey.

Conversations are Pi's session files, and the mirror searches the sessions of the Pi agent directory it runs with. With your own `pi`, they stay in your Pi session directory, outside the vault. `scripts/mirror.sh` uses Mirror's own agent directory, `.pi/agent/`, with a link to your Pi `auth.json`, so its sessions are in `.pi/agent/sessions/`. There, `.pi/.gitignore` lets you commit the sessions and settings, and keeps the auth link, trust decisions, and caches out of Git.
