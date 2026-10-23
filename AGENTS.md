# Working on Mirror

Read [mirror-pi/docs/architecture.md](mirror-pi/docs/architecture.md) before changing behavior.
Read [mirror-pi/docs/typescript.md](mirror-pi/docs/typescript.md) before writing TypeScript.
Read [mirror-pi/docs/evals.md](mirror-pi/docs/evals.md) before changing or adding evals.

## Rules

- Keep Mirror behavior in Markdown prompts where possible. Add TypeScript only for guarantees that prompts cannot enforce.
- Never use personal content, personal AI Memory, or retained personal sessions as fixtures. Evals use the synthetic starter vault and the local development AI Memory.
- Never edit global Pi or AI Memory configuration. Mirror uses its own Pi agent directory and profile.
- Do not copy credentials. Mirror's Pi agent directory links only `auth.json` to the personal Pi agent directory.
- A session belongs to one journey. Do not add mid-session journey switching.

## Validate

```sh
pnpm check
scripts/ai-memory.sh up && pnpm test:integration
pnpm test:mutants
```

Report every check you did not run.
