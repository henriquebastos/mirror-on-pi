# Mirror vault

Open this directory as an Obsidian vault. Start Pi in a journey directory to talk with the mirror about that journey.

This vault is a Git repository. `mirror-init` in the Mirror repository builds it and updates it:

- It owns `AGENTS.md`, this `README.md`, and `.agents/skills/`. It writes them on every run and commits the change. Do not edit them here: your edit stops the next run while it is uncommitted, and is replaced once it is committed.
- It copied the starter identity and journeys into the new vault once. From then on they are yours, like every other file here.

- `AGENTS.md` — how the mirror answers. Pi loads it in every journey directory.
- `identity/` — who the mirror is and who it speaks with. The model reads these files. It changes them only to append a Soul Mode integration that you confirm.
- `.agents/skills/soul/` — Soul Mode. Pi finds it from every journey directory. Start it with `/skill:soul` or by asking for Soul Mode.
- `journeys/<slug>/AGENTS.md` — one durable topic and its context. Each directory below `journeys/` is a journey.
- `journeys/<slug>/journal/` — journal entries saved on request.
- `journeys/<slug>/corrections/` — corrections recorded on request.
- `journeys/<slug>/files/` — your own PDFs, images, and notes for the journey.

Conversations are not in the vault. Pi keeps them in its session directory, and the mirror searches them.
