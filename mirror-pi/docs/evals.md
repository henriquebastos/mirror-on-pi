# Evals

Evals define what "working as intended" means. Each one states a behavior and fails when that behavior breaks.

| Layer | Location | Needs | Proves |
|---|---|---|---|
| Contracts | `mirror-pi/evals/contracts/` | Nothing | Pure rules: journey markers, AI Memory config, capture retries, record files, protocol parsing, the model bridge. |
| Integration | `mirror-pi/evals/integration/` | Local AI Memory | Real Pi sessions in a journey directory of a disposable vault, with the real extensions and a scripted model against real AI Memory: context-file loading, capture scope, multi-session recall, sessions outside a journey, records, degraded memory. |
| Negative controls | `mirror-pi/evals/mutants.ts` | Both of the above | Each listed guarantee is broken in turn and the evals must fail. |
| LLM consolidation | `mirror-pi/evals/llm/` | AI Memory with `--llm`, model bridge | AI Memory consolidates each journey's sessions with a real model; corrections and decisions survive; other journeys stay out. |
| Behavior | `mirror-pi/evals/behavior/` | AI Memory with `--llm`, model bridge, real chat model | The real model reads the identity files before its first answer, records explicit corrections once, recalls them in a later session, saves journals only on request, keeps the journey boundary, refuses identity edits, and answers in the user's language. Results go to `mirror-pi/evals/results/runs/`. |
| Reflective quality | planned | Real model and blind graders | Usefulness of reflections on synthetic scenarios, graded blind against a rubric. |

## Rules

- Use the synthetic starter vault and a disposable copy of it. Never use personal content.
- Integration evals create a new AI Memory workspace per run, named `eval-<timestamp>-<random>`, and point the disposable vault's markers at it. They never write to the `mirror` development workspace or any personal workspace.
- A scripted model tests wiring, not reflective quality. Do not report scripted runs as quality evidence.
- Add a mutant when you add a guarantee. A guarantee without a failing negative control is not verified.
- Record the AI Memory version and digest with any reported result. `scripts/ai-memory.sh` writes them to `dev/ai-memory/resolved.json`.

## Run

```sh
pnpm check
scripts/ai-memory.sh up --llm
scripts/model-bridge.sh start
pnpm test:integration
pnpm test:mutants
pnpm test:llm
pnpm test:behavior          # MIRROR_EVAL_REPEAT=3 for repeated runs
```

Behavior evals check observable actions with fixed patterns. The patterns are narrow on purpose: tool calls are checked exactly; answers only for a few phrases. A pass shows the behavior happened in that run. Model answers vary, so repeat runs before trusting a change in behavior.
