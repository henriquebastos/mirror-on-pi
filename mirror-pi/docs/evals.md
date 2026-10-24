# Evals

Evals define what "working as intended" means. Each one states a behavior and fails when that behavior breaks.

| Layer | Location | Needs | Proves |
|---|---|---|---|
| Contracts | `mirror-pi/evals/contracts/` | Nothing | Pure rules: which directory is a journey, record files, identity integration plans. |
| Integration | `mirror-pi/evals/integration/` | `jq` and `rg` | Real Pi sessions in a journey directory of a disposable vault, with Mirror's extensions and a scripted model: context-file loading, the session search command from `content/AGENTS.md` (finds the user's words and the mirror's replies of the same journey only, without tool output), records, sessions outside a journey, Soul skill discovery, and identity integration with a confirmed, declined, or missing dialog. |
| Negative controls | `mirror-pi/evals/mutants.ts` | Both of the above | Each listed guarantee is broken in turn and the evals must fail. |
| Behavior | `mirror-pi/evals/behavior/` | Real chat model | The real model reads the identity files before its first answer, records explicit corrections once, finds them in a later session by searching the journey's sessions, saves journals only on request, keeps the journey boundary, refuses identity edits, answers in the user's language, and follows Soul Mode from entry to an integration that changes identity only after the user agrees, with the exact proposed text. Results go to `mirror-pi/evals/results/runs/`. |
| Memory strategies | Commit `545de28`, `mirror-pi/evals/experiments/memory/` | See [memory-strategies.md](memory-strategies.md) | The comparison that chose Pi's session files over AI Memory. Its code was removed with AI Memory. |
| Reflective quality | planned | Real model and blind graders | Usefulness of reflections on synthetic scenarios, graded blind against a rubric. |

## Rules

- Use the synthetic starter vault and a disposable copy of it. Never use personal content or personal sessions.
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
