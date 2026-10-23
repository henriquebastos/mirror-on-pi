# Architecture

Mirror is plain Pi in a Markdown vault, plus a few small extensions. There is no launcher, no Mirror server, and no Mirror database.

## Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| How the mirror answers | `content/AGENTS.md` | Pi loads it as a context file from every directory below the vault. It tells the model to read the identity files. |
| Identity | `content/identity/` | Markdown read by the model with Pi's `read` tool. Nothing composes or injects it. |
| A journey | `content/journeys/<slug>/` | The directory is the journey. Its `AGENTS.md` holds the journey context. Its `.ai-memory.toml` names the AI Memory scope. |
| Conversation history | Pi session files | Pi keeps sessions per working directory, so each journey directory has its own sessions. |
| Capture | `mirror-pi/extensions/capture.ts` | Development stand-in for the personal AI Memory Pi extension. Routes by `.ai-memory.toml`. |
| Recall | `mirror-pi/extensions/recall.ts` | Adds the journey's matching memory before each prompt. Adds the `mirror_recall` tool. |
| Journal entries | `mirror-pi/extensions/journal.ts` | `mirror_save_journal`: a vault file in `journal/`, then a published AI Memory page. |
| Corrections | `mirror-pi/extensions/corrections.ts` | `mirror_record_correction`: a vault file in `corrections/`, then a pinned AI Memory page. |
| Consolidation | AI Memory | One project per journey, in the workspace from `.ai-memory.toml`. |

Each extension does one thing and works without the others. Shared code is in `mirror-pi/src/`.
The extensions read the AI Memory address from `ai-memory.json` in the Pi agent directory. Without it, they only warn.

## Development setup

```text
dev/pi-agent/                 PI_CODING_AGENT_DIR for manual sessions
  settings.json               model and the four extensions (tracked)
  ai-memory.json              local AI Memory address and token file (tracked)
  auth.json -> ~/.pi/agent/auth.json   (scripts/dev-setup.sh)
~/.local/state/mirror/vault-dev/       copy of content/ (scripts/dev-setup.sh)
```

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
  ├─ capture: send the prompt to the journey's AI Memory project
  └─ recall: query the project; add the results as a hidden context message

session end
  └─ capture: send session-end and flush (AI Memory then writes a session summary page)
```

A session outside a journey directory gets no capture, no recall, and no records.

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
| Capture goes only to the journey's project | Every hook event names workspace and project explicitly. | integration "captures into its own project only" |
| Nothing outside a journey reaches AI Memory | Without a marker, capture and recall stay off and record tools refuse. | integration "outside a journey directory" |
| Mirror's instructions load in every journey | Pi's own context-file discovery. | integration "Pi loads Mirror's instructions" |
| Undelivered events are retried without duplicates | In-memory queue keeps unacknowledged events with their ingest keys. | `capture.test.ts` |
| Records never overwrite | Exclusive file creation and `create_only` pages. When a name is free in the vault but taken in AI Memory, both move to the next name. | `records.test.ts` |
| Memory failure is visible | The context message states that memory is unavailable. Records report a failed publication. | integration "unreachable AI Memory" |

Behavior that depends on the model, such as reading the identity, recording corrections, or not editing identity files, is checked by the behavior evals, not enforced.

## Known limits

- The model must read the identity files itself. The behavior evals check that it does. If it stops doing so, the smallest fix is an extension that adds the files to the system prompt.
- Pi's default system prompt describes a coding assistant. `content/AGENTS.md` replaces that role in words only.
- The model has Pi's default tools, including `bash`, `edit`, and `write`. Nothing stops it from editing identity files except the instructions.
- Capture is in memory. Events not delivered before the process exits are lost. AI Memory's spool is not used.
- Assistant replies are not captured. AI Memory consolidates from user prompts and explicit records.
- Without `--llm`, AI Memory writes rule-based session summaries only.
- Pinned corrections are returned for every query, up to the query limit. Many corrections will crowd out other notes.
- Recall uses the first 400 characters of the prompt.
- Explorer, Soul, tasks, attachment search, and identity proposals are not implemented.
- `--llm` was tested with colima on macOS. On Linux Docker, `host-gateway` is the docker0 address, which cannot reach a bridge bound to 127.0.0.1.
- Shared skills in `~/.agents/skills` still load into development sessions.
- `dev/pi-agent/auth.json` is a symbolic link. Pi locks the link path, not its target, so an OAuth refresh in a development session and in personal Pi at the same moment can race. The likely result is a new login.
