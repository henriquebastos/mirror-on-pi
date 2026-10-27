# Evals

Evals define what "working as intended" means. Each one states a behavior and fails when that behavior breaks.

| Layer | Location | Needs | Proves |
|---|---|---|---|
| Contracts | `mirror-pi/evals/contracts/` | Nothing | Pure rules: local `JOURNEY.md` discovery without parent search, journey directories and the vault map's journey list, record files, the identity section, identity integration plans, the vault projection with Git and the starter map, and the launcher with a fake `pi`. |
| Integration | `mirror-pi/evals/integration/` | `jq` and `rg` | Real Pi sessions at the root of a disposable vault, with Mirror's extensions and a scripted model: Mirror's instructions, the identity, the journey list, and journey context from `JOURNEY.md` in the system prompt, also from a cwd `JOURNEY.md`, independent identity and journeys, no Mirror content or record destination inherited from parents, none of the Mirror sections in a subagent, a journey listed in the vault map outside `journeys/`, entering and switching journeys with no UI and their entries, refusing a journey that does not exist, records in the session's journey, the session search command from Mirror's instructions (finds the user's words and the mirror's replies of every journey, at the root and in any directory of the vault, without tool output), Soul skill discovery from the package, identity integration with no UI, and the package loading of a trusted vault, with its extensions and the Soul skill, which do not load in an untrusted vault or in a session below the root. |
| Negative controls | `mirror-pi/evals/mutants.ts` | Both of the above | Each listed guarantee is broken in turn and the evals must fail. |
| Behavior | `mirror-pi/evals/behavior/` | Real chat model | The real model reads no identity file for a coding question and reads the identity before a personal answer, follows the `AGENTS.md` of a directory below the root and answers from its skill, uses journeys and records without identity, uses a cwd `JOURNEY.md` without parent identity, records explicit corrections once, finds them in a later session by searching the sessions, enters a fitting journey and none for small talk, names it, follows the user's correction to another journey, answers from another journey's history, saves journals only on request, switches for another journey's topic, refuses identity edits, answers in the user's language, and follows Soul Mode from entry to an integration that changes identity only after the user agrees, with the exact proposed text. In Soul Mode it also hears each voice from its file, matures one fruit and saves the harvest only when asked, records nothing on an unclear reply or a change request, records only the layers the user agrees to (a persona included), and keeps card titles in English in a Portuguese session. Results go to `mirror-pi/evals/results/runs/`. |
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
pnpm test:behavior          # MIRROR_EVAL_REPEAT=3 for repeated runs; MIRROR_EVAL_MODEL=provider/id for another model
```

Behavior evals check observable actions with fixed patterns. The patterns are narrow on purpose: tool calls are checked exactly; answers only for a few phrases. A pass shows the behavior happened in that run. Model answers vary, so repeat runs before trusting a change in behavior.
