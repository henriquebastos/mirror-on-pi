# Working on Mirror

Read [mirror-pi/docs/architecture.md](mirror-pi/docs/architecture.md) before changing behavior.
Read [mirror-pi/docs/typescript.md](mirror-pi/docs/typescript.md) before writing TypeScript.
Read [mirror-pi/docs/evals.md](mirror-pi/docs/evals.md) before changing or adding evals.

## Rules

- Keep Mirror as close to plain Pi as possible. Put behavior in the vault's `AGENTS.md` files. Add an extension only when Pi cannot do the job, and keep each extension to one job.
- Never use personal content, personal AI Memory, or retained personal sessions as fixtures. Evals use the synthetic starter vault and the local development AI Memory.
- Never edit global Pi or AI Memory configuration. Development sessions use `dev/pi-agent` and the local AI Memory.
- Do not copy credentials. `dev/pi-agent` links only `auth.json` to the personal Pi agent directory.
- A journey is a directory. A session belongs to the journey of its working directory.

## Validate

```sh
pnpm check
scripts/ai-memory.sh up && pnpm test:integration
pnpm test:mutants
```

Report every check you did not run.
