# Mirror vault

Open this directory as an Obsidian vault. Start Pi here, at the vault root, to talk with the mirror. When the topic fits a journey, the mirror proposes it and you confirm.

This vault is a Git repository. `mirror-init` in the Mirror repository builds it and updates it:

- It owns `AGENTS.md`, this `README.md`, `.agents/skills/`, `.pi/settings.json`, which loads Mirror's extensions once you trust this vault in Pi, and `.pi/.gitignore`. `scripts/mirror.sh` keeps Mirror's Pi settings and sessions in `.pi/agent/`, with a link to your Pi `auth.json`. Commit the sessions with your notes: they are the history of your conversations. Git ignores the auth link, trust decisions, and caches. It writes them on every run and commits the change. Do not edit them here: your edit stops the next run while it is uncommitted, and is replaced once it is committed.
- It copied the starter identity and journeys into the new vault once. From then on they are yours, like every other file here.

- `AGENTS.md` — how the mirror answers. Pi loads it at the vault root.
- `identity/` — who the mirror is and who it speaks with. The model reads these files. It changes them only to append a Soul Mode integration that you confirm.
- `.agents/skills/soul/` — Soul Mode. Start it with `/skill:soul` or by asking for Soul Mode.
- `journeys/<slug>/AGENTS.md` — one durable topic of your life and its context. Each directory below `journeys/` is a journey. The `description` in its front matter tells the mirror when the journey fits.
- `journeys/<slug>/journal/` — journal entries saved on request.
- `journeys/<slug>/corrections/` — corrections recorded on request.
- `journeys/<slug>/files/` — your own PDFs, images, and notes for the journey.

Conversations are not in the vault. Pi keeps them in its session directory, and the mirror searches them.
