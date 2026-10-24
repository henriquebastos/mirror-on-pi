# Architecture

Mirror is plain Pi in a Markdown vault, plus the AI Memory Pi extension and a few small Mirror extensions. There is no launcher, no Mirror server, and no Mirror database.

## Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| How the mirror answers | `content/AGENTS.md` | Pi loads it as a context file from every directory below the vault. It tells the model to read the identity files. |
| Identity | `content/identity/` | Markdown read by the model with Pi's `read` tool. Nothing composes or injects it. |
| A journey | `content/journeys/<slug>/` | The directory is the journey. Its `AGENTS.md` holds the journey context. Its `.ai-memory.toml` names the AI Memory scope. |
| Conversation history | Pi session files | Pi keeps sessions per working directory, so each journey directory has its own sessions. |
| Capture | The AI Memory Pi extension | The same generated extension as personal Pi, from the same pinned release, pointed at the local AI Memory. Routes by `.ai-memory.toml`. Also gives the model AI Memory's `memory_*` tools. |
| Recall | `mirror-pi/extensions/recall.ts` | Adds the journey's matching memory before each prompt. Adds the `mirror_recall` tool. |
| Journal entries | `mirror-pi/extensions/journal.ts` | `mirror_save_journal`: a vault file in `journal/`, then a published AI Memory page. |
| Corrections | `mirror-pi/extensions/corrections.ts` | `mirror_record_correction`: a vault file in `corrections/`, then a pinned AI Memory page. |
| Consolidation | AI Memory | One project per journey, in the workspace from `.ai-memory.toml`. |

Each Mirror extension does one thing and works without the others. Shared code is in `mirror-pi/src/`.
Mirror's extensions read the AI Memory address from `ai-memory.json` in the Pi agent directory. Without it, they only warn.
The AI Memory extension has its server address in the file and reads `AI_MEMORY_AUTH_TOKEN` and `AI_MEMORY_DATA_DIR` from the environment.

## Development setup

```text
dev/pi-agent/                 PI_CODING_AGENT_DIR for manual sessions
  settings.json               model and the three Mirror extensions (tracked)
  ai-memory.json              local AI Memory address and token file for Mirror's extensions (tracked)
  extensions/ai-memory-pi.ts  generated AI Memory extension; Pi loads it from here (tracked, scripts/ai-memory-extension.sh)
  auth.json -> ~/.pi/agent/auth.json   (scripts/dev-setup.sh)
dev/ai-memory/cli/            the pinned AI Memory release that generates the extension (ignored)
dev/ai-memory/client/         AI_MEMORY_DATA_DIR of development sessions: spool and logs (ignored)
~/.local/state/mirror/vault-dev/       copy of content/ (scripts/dev-setup.sh)
```

`scripts/ai-memory-extension.sh` uses the release and options that the dotfiles' `scripts/setup-ai-memory` uses for personal Pi, and checks that the result differs from the personal extension only in the server address.
`scripts/dev-pi.sh` runs `pi` with development values for `PI_CODING_AGENT_DIR`, `AI_MEMORY_AUTH_TOKEN`, and `AI_MEMORY_DATA_DIR`. Without them, the extension would send the personal token to the local AI Memory and use the personal spool.

The development vault is a copy outside this repository. Otherwise Pi would also load this repository's `AGENTS.md` into Mirror sessions.
The separate agent directory keeps personal Pi settings, extensions, and the production AI Memory out of development sessions.

## Session lifecycle

```text
cd vault/journeys/health && pi
  ├─ Pi loads vault/AGENTS.md, then journeys/health/AGENTS.md
  └─ extensions find journeys/health/.ai-memory.toml → workspace "mirror", project "health"

first answer
  └─ the model reads identity/ files as AGENTS.md instructs

each user prompt
  ├─ AI Memory extension: send the prompt to the journey's AI Memory project
  └─ recall: query the project; add the results as a hidden context message

each tool call and answer end
  └─ AI Memory extension: send the tool call, its output, and a stop event

session end
  └─ AI Memory extension: send session-end and drain for up to 2 s (AI Memory then writes a session summary page)
```

A session outside a journey directory gets no recall and no records. The AI Memory extension still captures it, as personal Pi does, into AI Memory's default scope for that directory, never into a journey.

## Consolidation with your Pi models

`scripts/ai-memory.sh up --llm` configures AI Memory to consolidate each session at its end through `dev/pi-model-bridge`.
The bridge is a local OpenAI-compatible endpoint on 127.0.0.1 that answers with Pi's model runtime and your existing Pi authentication file.
It requires a bearer token from `dev/ai-memory/.env`. No provider credential is copied into AI Memory.
The model is in `dev/pi-model-bridge/bridge.json`. Improvement proposals require approval (`AI_MEMORY_AUTO_IMPROVE__REQUIRE_APPROVAL=true`).

```text
AI Memory container ──HTTP──> host.docker.internal:49391 (bridge) ──Pi ModelRuntime──> provider
```

## Guarantees and how they are enforced

| Guarantee | Mechanism | Eval |
|---|---|---|
| A session uses the journey of its directory | The nearest `.ai-memory.toml` at or above the working directory. An incomplete marker is an error, not a default. | `journey.test.ts` |
| Capture goes only to the journey's project | The AI Memory extension sends the marker's workspace and project with every event. | integration "captures into its own project only", mutant on the career marker |
| Nothing outside a journey reaches a journey's memory | Without a marker, Mirror's extensions make no AI Memory call and record tools refuse. The AI Memory extension captures into its default scope. | integration "outside a journey directory" |
| Mirror's instructions load in every journey | Pi's own context-file discovery. | integration "Pi loads Mirror's instructions" |
| Records never overwrite | Exclusive file creation and `create_only` pages. When a name is free in the vault but taken in AI Memory, both move to the next name. | `records.test.ts` |
| Memory failure is visible | The context message states that memory is unavailable. Records report a failed publication. | integration "unreachable AI Memory" |

Behavior that depends on the model, such as reading the identity, recording corrections, or not editing identity files, is checked by the behavior evals, not enforced.

## Known limits

- The model must read the identity files itself. The behavior evals check that it does. If it stops doing so, the smallest fix is an extension that adds the files to the system prompt.
- Pi's default system prompt describes a coding assistant. `content/AGENTS.md` replaces that role in words only.
- The model has Pi's default tools, including `bash`, `edit`, and `write`. Nothing stops it from editing identity files except the instructions.
- Capture behaves as the AI Memory extension does in personal Pi: failed events go to the spool in `AI_MEMORY_DATA_DIR`, and at most 100 events wait in memory.
- The AI Memory extension can deliver the last event just after `session_shutdown` returns. A real `pi` process waits for it. The in-process evals poll for it.
- The model also has AI Memory's `memory_*` tools, including writes such as `memory_write_page` and `memory_delete_page`. The instructions and behavior evals keep records on the mirror tools.
- Assistant replies are not captured. AI Memory consolidates from user prompts, tool calls and their output, and explicit records.
- Without `--llm`, AI Memory writes rule-based session summaries only.
- Pinned corrections are returned for every query, up to the query limit. Many corrections will crowd out other notes.
- Recall uses the first 400 characters of the prompt.
- Explorer, Soul, tasks, attachment search, and identity proposals are not implemented.
- `--llm` was tested with colima on macOS. On Linux Docker, `host-gateway` is the docker0 address, which cannot reach a bridge bound to 127.0.0.1.
- Shared skills in `~/.agents/skills` still load into development sessions.
- `dev/pi-agent/auth.json` is a symbolic link. Pi locks the link path, not its target, so an OAuth refresh in a development session and in personal Pi at the same moment can race. The likely result is a new login.
