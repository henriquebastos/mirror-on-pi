# Evals

Evals define what "working as intended" means. Each one states a behavior and fails when that behavior breaks.

| Layer | Location | Needs | Proves |
|---|---|---|---|
| Contracts | `mirror-pi/evals/contracts/` | Nothing | Pure rules: composition order, binding decisions, path guard, capture retries, record files, protocol parsing, launch flags. |
| Integration | `mirror-pi/evals/integration/` | Local AI Memory | Real Pi sessions with the real extension and a scripted model against real AI Memory: capture scope, multi-session recall, binding refusal, records, degraded memory. |
| Negative controls | `mirror-pi/evals/mutants.ts` | Both of the above | Each listed guarantee is broken in turn and the evals must fail. |
| Quality | `mirror-pi/evals/quality/` (planned) | A real model | Reflective answers on synthetic multi-session scenarios, graded blind. |

## Rules

- Use the synthetic starter vault and a disposable copy of it. Never use personal content.
- Integration evals create a new AI Memory workspace per run, named `eval-<timestamp>-<random>`. They never write to `mirror-dev` or any personal workspace.
- A scripted model tests wiring, not reflective quality. Do not report scripted runs as quality evidence.
- Add a mutant when you add a guarantee. A guarantee without a failing negative control is not verified.
- Record the AI Memory version and digest with any reported result. `scripts/ai-memory.sh` writes them to `dev/ai-memory/resolved.json`.

## Run

```sh
pnpm check
scripts/ai-memory.sh up
pnpm test:integration
pnpm test:mutants
```
