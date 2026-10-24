# Evals

Evals define what "working as intended" means. Each one states a behavior and fails when that behavior breaks.

| Layer | Location | Needs | Proves |
|---|---|---|---|
| Contracts | `mirror-pi/evals/contracts/` | Nothing | Pure rules: journey directories, record files, identity integration plans, and the vault projection with Git. |
| Integration | `mirror-pi/evals/integration/` | `jq` and `rg` | Real Pi sessions at the root of a disposable vault, with Mirror's extensions and a scripted model: the journey list and journey context in the system prompt, entering and switching journeys with a confirmed, declined, or missing dialog and the decision records, records in the session's journey, the session search command from `vault/AGENTS.md` (finds the user's words and the mirror's replies of every journey, at the root and in old journey directories, without tool output), Soul skill discovery, identity integration with a confirmed, declined, or missing dialog, and the package loading of a trusted vault. |
| Negative controls | `mirror-pi/evals/mutants.ts` | Both of the above | Each listed guarantee is broken in turn and the evals must fail. |
| Behavior | `mirror-pi/evals/behavior/` | Real chat model | The real model reads the identity files before its first answer, records explicit corrections once, finds them in a later session by searching the sessions, proposes a fitting journey and none for small talk, answers from another journey's history, saves journals only on request, proposes a switch for another journey's topic, refuses identity edits, answers in the user's language, and follows Soul Mode from entry to an integration that changes identity only after the user agrees, with the exact proposed text. Results go to `mirror-pi/evals/results/runs/`. |
| Memory strategies | Commit `545de28`, `mirror-pi/evals/experiments/memory/` | See [memory-strategies.md](memory-strategies.md) | The comparison that chose Pi's session files over AI Memory. Its code was removed with AI Memory. |

## Rules

- Build each disposable vault with the projection (`tempVault()`), as every other vault is built. Never use personal content or personal sessions.
- Git in eval vaults uses no personal or system Git configuration and a fixed author.
- Each eval process uses one temporary Pi agent directory and sets `PI_CODING_AGENT_DIR` to it, so sessions and the search command never touch a personal or development agent directory.
- A scripted model tests wiring, not reflective quality. Do not report scripted runs as quality evidence.
- Add a mutant when you add a guarantee. A guarantee without a failing negative control is not verified.

## Run

```sh
pnpm check
pnpm test:integration
pnpm test:mutants
pnpm test:behavior          # MIRROR_EVAL_REPEAT=3 for repeated runs
```

Behavior evals check observable actions with fixed patterns. The patterns are narrow on purpose: tool calls are checked exactly; answers only for a few phrases. A pass shows the behavior happened in that run. Model answers vary, so repeat runs before trusting a change in behavior.
