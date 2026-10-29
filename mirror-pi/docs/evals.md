# Evals

Evals define what "working as intended" means. Each one states a behavior and fails when that behavior breaks.

| Layer | Location | Needs | Proves |
|---|---|---|---|
| Contracts | `mirror-pi/evals/contracts/` | Nothing | Pure rules: local `JOURNEY.md` discovery without parent search, journey directories and the vault map's journey list, record files, the identity section, identity integration plans, the vault projection with Git and the starter map, and the launcher with a fake `pi`. |
| Integration | `mirror-pi/evals/integration/` | `jq` and `rg` | Real Pi sessions at the root of a disposable vault, with Mirror's extensions and a scripted model: Mirror's instructions, the identity, the journey list, and journey context from `JOURNEY.md` in the system prompt, also from a cwd `JOURNEY.md`, independent identity and journeys, no Mirror content or record destination inherited from parents, none of the Mirror sections in a subagent, a journey listed in the vault map outside `journeys/`, entering and switching journeys with no UI and their entries, refusing a journey that does not exist, records in the session's journey, the session search command from Mirror's instructions (finds the user's words and the mirror's replies of every journey, at the root and in any directory of the vault, without tool output), Soul skill discovery from the package, identity integration with no UI, and the package loading of a trusted vault, with its extensions and the Soul skill, which do not load in an untrusted vault or in a session below the root. |
| Negative controls | `mirror-pi/evals/mutants.ts` | Both of the above | Each listed guarantee is broken in turn and the evals must fail. |
| Behavior | `mirror-pi/evals/behavior/` | Real chat model | The real model reads no identity file for a coding question and reads the identity before a personal answer, follows the `AGENTS.md` of a directory below the root and answers from its skill, uses journeys and records without identity, uses a cwd `JOURNEY.md` without parent identity, records explicit corrections once, finds them in a later session by searching the sessions, enters a fitting journey and none for small talk, names it, follows the user's correction to another journey, answers from another journey's history, saves journals only on request, switches for another journey's topic, refuses identity edits, answers in the user's language, and follows Soul Mode from entry to an integration that changes identity only after the user agrees, with the exact proposed text. In Soul Mode it also hears each voice from its file, matures one fruit and saves the harvest only when asked, records nothing on an unclear reply or a change request, records only the layers the user agrees to (a persona included), and keeps card titles in English in a Portuguese session. Results go to `mirror-pi/evals/results/runs/`. |
| Parity harness | `mirror-pi/evals/experiments/parity/` | Nothing for its tests; real models to run | The comparison of Mirror with Mirror Mind on 26 scenarios (arms A0–A3), the mechanical probes, blind grading, and the scores. Its tests also check the frozen history and the gate's comparison. |
| Capability gate | `mirror-pi/evals/experiments/parity/capability.ts` | Real chat models and Sonnet 5.5 | Mirror (A2) with the frozen history, on GPT-6.1 Sol and Opus 5.5, is not worse than the committed baseline in `mirror-pi/evals/baselines/capability.json`. |
| Memory strategies | Commit `545de28`, `mirror-pi/evals/experiments/memory/` | See [memory-strategies.md](memory-strategies.md) | The comparison that chose Pi's session files over AI Memory. Its code was removed with AI Memory. |

## Rules

- Build each disposable vault with the projection (`tempVault()`), as every other vault is built. Never use personal content or personal sessions.
- Git in eval vaults uses no personal or system Git configuration and a fixed author.
- Each eval process uses one temporary Pi agent directory and sets `PI_CODING_AGENT_DIR` to it, so sessions and the search command never touch a personal or development agent directory.
- A model credential comes only from the environment or from `MIRROR_EVAL_AUTH`.
- A scripted model tests wiring, not reflective quality. Do not report scripted runs as quality evidence.
- Add a mutant when you add a guarantee. A guarantee without a failing negative control is not verified.

## Run

A checkout runs every eval after `pnpm install`. Nothing reads files of an earlier run or of this machine's home: no Pi agent directory, cache, or temporary state. `pnpm doctor` checks the tools (Node 26, pnpm, git, `rg`, `jq`), the pinned Pi, and a credential for each gate model; `pnpm doctor --probe` also sends each model one short request.

| Level | Command | Needs | When |
|---|---|---|---|
| 1 | `pnpm check`, `pnpm test:integration`, `pnpm test:mutants` | No model, no key, no network | Every commit. CI runs it on every push (`.github/workflows/ci.yml`). |
| 2 | `MIRROR_EVAL_REPEAT=3 pnpm test:behavior`, `pnpm test:capability [<out>]` | Model credentials | Before a release, and after a change to instructions, the Soul skill, or an extension. CI runs it only when started by hand (`.github/workflows/capability.yml`). |
| 3 | The parity comparison with Mirror Mind (below) | Credentials, network, and OpenRouter for Mirror Mind's own calls | Rarely, by hand. |

`MIRROR_EVAL_MODEL=provider/id` runs the behavior evals with another model.

### Credentials

- Without settings, Pi gets `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENROUTER_API_KEY` from the environment, as in CI.
- `MIRROR_EVAL_AUTH=<path to a Pi auth.json>` uses that file, for example your subscriptions: `MIRROR_EVAL_AUTH=~/.pi/agent/auth.json pnpm test:capability`. The evals never find an auth file without this setting.
- When the file holds an Anthropic subscription (OAuth), every Anthropic request loads `pi-cc-patch`, a pinned dev dependency. The patch changes the system prompt. With an API key it does not load.

### Capability gate

`pnpm test:capability` materializes the frozen history into an A2 vault, runs the 26 parity scenarios 3 times on each gate model, grades the answers blind with Sonnet 5.5, and compares with the baseline. Output goes to `<out>`, or to a new directory under the system's temporary directory, with the report in `capability.md`.

- The gate fails when the 90% lower bound of the paired per-scenario difference (now − baseline) is below −5 points, or when a shared check that passed in every baseline run fails in every run now.
- The gate refuses to compare when the fixture or the Pi version differs from the baseline's.
- One run costs about $12 at list price with API keys (Sol about $3.30, Opus about $7.20, grading $1–2), and takes about 30 minutes.

### Frozen history

`mirror-pi/evals/fixtures/parity/a2/` holds the user's past for the gate: the 25 history sessions of a synthetic user (Sam), replayed once with GPT-6 Astra, and the vault files that they made. `manifest.json` lists the hash of every file. Paths are stored as `{{ROOT}}`, `{{REPO}}`, and `{{PI}}`. Mirror's own files come from the current projection, so the gate tests the current Mirror with the same past.

Regenerate the fixture and the baseline together, in one commit, when a change alters what the history makes (for example, where records go), when the scenarios change, or when the Pi pin changes:

```sh
node mirror-pi/evals/experiments/parity/run.ts prepare <out> --arms a2 --history
node mirror-pi/evals/experiments/parity/run.ts freeze <out>
pnpm test:capability <gate-out>     # it refuses: the fixture is new
node mirror-pi/evals/experiments/parity/capability.ts baseline <gate-out> --mirror <version>
```

Run the gate on the old baseline first, before you regenerate, so the change itself is compared with the old capability.

### Parity comparison

The comparison of `design.md` §1h–§1k: four arms, fresh history for each, and Mirror Mind installed at its pinned commit (`reference.ts`) into the temporary directory. The run directory must be outside every Git repository.

```sh
node mirror-pi/evals/experiments/parity/run.ts prepare <out> --history
node mirror-pi/evals/experiments/parity/run.ts cells <out> --models openai/gpt-6.1-sol,anthropic/claude-opus-5-5 --repeat 3
node mirror-pi/evals/experiments/parity/grade.ts <out>
node mirror-pi/evals/experiments/parity/report.ts <out>
```

Behavior evals check observable actions with fixed patterns. The patterns are narrow on purpose: tool calls are checked exactly; answers only for a few phrases. A pass shows the behavior happened in that run. Model answers vary, so repeat runs before trusting a change in behavior.
