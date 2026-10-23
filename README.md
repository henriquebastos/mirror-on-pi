# Mirror

Mirror is a reflective companion that runs as ordinary Pi sessions.
It reads your identity and journeys from a Markdown vault, remembers across sessions through AI Memory, and saves journal entries and corrections only when you ask.

## Start

```sh
pnpm install
scripts/ai-memory.sh up        # local development AI Memory on 127.0.0.1:49390
bin/mirror doctor
bin/mirror journeys
bin/mirror start health        # new session in the health journey
bin/mirror start health -c     # continue the latest health session
```

Each session belongs to one journey. Start another session to talk about another journey.
You can have many sessions per journey. They share the journey's AI Memory project.

## How it fits together

| Part | Owner | Location |
|---|---|---|
| Identity, journeys, journal, corrections, your files | You, in an Obsidian vault | `content/` |
| Conversation history | Pi | Mirror's own Pi agent directory, one session directory per journey |
| Recall and consolidation across sessions | AI Memory | One project per journey, in one workspace per profile |
| Mirror behavior | This repository | `mirror-pi/` prompts, extension, and evals |

- `mirror-pi/prompts/mirror-mode.md` — how the mirror answers.
- `mirror-pi/extension/` — the Pi extension: identity context, journey binding, capture, recall, and records.
- `mirror-pi/docs/` — architecture, TypeScript guidelines, and evals.
- `config/dev.json` — the development profile. Set `MIRROR_PROFILE` to use another one.

## Checks

```sh
pnpm check                 # types, lint, contract evals
pnpm test:integration      # real Pi sessions against the local AI Memory
pnpm test:mutants          # break each guarantee and require the evals to fail
```

The starter content in `content/` is synthetic. See [NOTICE.md](NOTICE.md) for attribution.
