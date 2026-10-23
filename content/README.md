# Mirror content vault

Open this directory as an Obsidian vault. Mirror reads identity and journey definitions from here and writes journal entries and corrections into each journey.

This starter content is synthetic and tracked in Git. Journal entries and corrections that sessions write here are ignored by Git.
For personal content, use a vault outside this repository: copy `config/dev.json`, set `contentDir` to your vault, and start Mirror with `MIRROR_PROFILE=<your profile> bin/mirror start <journey>`.

- `identity/` — who the mirror is and who it speaks with. Mirror never edits these files.
- `journeys/<slug>/journey.md` — one durable topic. Its frontmatter names the AI Memory project.
- `journeys/<slug>/journal/` — journal entries saved by Mirror on request.
- `journeys/<slug>/corrections/` — corrections recorded by Mirror on request.
- `journeys/<slug>/files/` — your own PDFs, images, and notes for the journey.
