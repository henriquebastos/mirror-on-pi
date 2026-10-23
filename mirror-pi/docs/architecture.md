# Architecture

Mirror is Pi plus a small extension. There is no Mirror server and no Mirror database.

## Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| Identity and journey definitions | Content vault, `content/identity/` and `content/journeys/<slug>/journey.md` | Markdown with YAML frontmatter. Mirror only reads these files. |
| Conversation history | Pi session files | Mirror's own Pi agent directory, one session directory per journey. |
| Recall and consolidation | AI Memory | One project per journey. One workspace per profile, such as `mirror-dev`. |
| Journal entries and corrections | Vault file first, then a published AI Memory page | The vault file is the human-editable record. The page makes it recallable. |
| How the mirror answers | `mirror-pi/prompts/mirror-mode.md` | Replaces Pi's coding-agent system prompt. |

## Consolidation with your Pi models

`scripts/ai-memory.sh up --llm` configures AI Memory to consolidate each session at its end through `dev/pi-model-bridge`.
The bridge is a local OpenAI-compatible endpoint on 127.0.0.1 that answers with Pi's model runtime and your existing Pi authentication file.
It requires a bearer token from `dev/ai-memory/.env`. No provider credential is copied into AI Memory.
The model is `consolidation` in `config/dev.json`. Improvement proposals require approval (`AI_MEMORY_AUTO_IMPROVE__REQUIRE_APPROVAL=true`).

```text
AI Memory container ──HTTP──> host.docker.internal:49391 (bridge) ──Pi ModelRuntime──> provider
```

## Session lifecycle

```text
bin/mirror start health
  ├─ checks the journey and identity files
  ├─ prepares Mirror's Pi agent directory (settings + auth.json link)
  └─ runs the repository's Pi with:
       --no-extensions --extension mirror-pi/extension/index.ts
       --no-skills --no-prompt-templates --no-context-files
       --tools read,grep,find,ls,mirror_recall,mirror_save_journal,mirror_record_correction
       --session-dir <agent>/sessions/<workspace>/<journey>
       cwd = content vault

session_start
  ├─ load identity + journey, compose sections
  └─ bind the session to the journey (a custom session entry), or block it

each user prompt
  ├─ system prompt = mirror-mode.md + <mirror_identity> section
  ├─ capture the prompt into the journey's AI Memory project
  └─ query the journey's memory; add the results as a hidden context message

session_shutdown
  └─ capture session-end and flush (AI Memory then writes a session summary page)
```

## Guarantees and how they are enforced

| Guarantee | Mechanism | Eval |
|---|---|---|
| A session belongs to one journey | Binding entry written before the first message. A session with another binding, or history without one, is blocked: input is consumed, the model is not called, nothing is captured. | `binding.test.ts`, integration "cannot be resumed under another journey" |
| Capture goes only to the journey's project | Every hook event names workspace and project explicitly. | integration "captures into its own project only" |
| Undelivered events are retried without duplicates | In-memory queue keeps unacknowledged events with their ingest keys. | `capture.test.ts` |
| Identity is composed in Mirror's order | Constraints, soul, behavior, user, ego, organization, persona, sorted knowledge, journey. | `content.test.ts` |
| The mirror cannot edit files or run commands | The tool list has no write, edit, or shell tool. A `tool_call` guard also blocks every tool outside the list. | integration journal/vault test |
| File reads stay in the vault | Paths are resolved through symbolic links and must stay inside the content directory. | `paths.test.ts` |
| Records never overwrite | Exclusive file creation and `create_only` pages. | `records.test.ts` |
| Memory failure is visible | The context message states that memory is unavailable. Records report a failed publication. | integration "unreachable AI Memory" |

## Known limits

- Capture is in memory. Events not delivered before the process exits are lost. AI Memory's spool is not used.
- Assistant replies are not captured. AI Memory consolidates from user prompts and explicit records.
- Without `--llm`, AI Memory writes rule-based session summaries only.
- Pinned corrections are returned for every query, up to the query limit. Many corrections will crowd out other notes.
- Recall uses the first 400 characters of the prompt.
- Explorer, Soul, tasks, attachment search, and identity proposals are not implemented.
- The interactive launcher shares `auth.json` through a symbolic link. Pi locks the link path, not its target, so an OAuth refresh in Mirror and in personal Pi at the same moment can race. The likely result is a new login.
