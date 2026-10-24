# Working on Mirror

Read [mirror-pi/docs/architecture.md](mirror-pi/docs/architecture.md) before changing behavior.
Read [mirror-pi/docs/typescript.md](mirror-pi/docs/typescript.md) before writing TypeScript.
Read [mirror-pi/docs/evals.md](mirror-pi/docs/evals.md) before changing or adding evals.

## Rules

- Keep Mirror as close to plain Pi as possible. Put behavior in `vault/AGENTS.md` and the journey `AGENTS.md` files. Add an extension only when Pi cannot do the job, and keep each extension to one job.
- Never use personal content or personal sessions as fixtures. Evals use the synthetic starter vault and a temporary Pi agent directory.
- Never edit global Pi configuration. Development sessions use `dev/pi-agent`.
- Do not copy credentials. `dev/pi-agent` links only `auth.json` to the personal Pi agent directory.
- A journey is a directory. Sessions run at the vault root; a session belongs to the journey the user confirmed with `mirror_enter_journey`.
- This repository is not a vault. `vault/` holds the files Mirror owns in every vault; `starter/` holds synthetic content for new vaults. Build a vault with `scripts/mirror-init.sh`, never by copying.

## Validate

```sh
pnpm check
pnpm test:integration
pnpm test:mutants
```

Report every check you did not run.
