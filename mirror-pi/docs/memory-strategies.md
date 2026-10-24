# Memory strategies: AI Memory, raw sessions, or transcripts

This experiment compares three ways for the mirror to remember earlier sessions of a journey.
It follows "MemoryTax: The Bitter Lesson of Agent Memory" (arXiv 2610.29823), which found that strong models answer better from the raw record with their own search tools than from designed memory.

Run: `mirror-pi/evals/results/memory/20261024T035909Z/` (ignored by Git; it holds the synthetic history, every answer, and every grade). Code: commit `545de28`.

## 1 Strategies

| ID | Strategy | What the model has | Mirror code for memory |
|---|---|---|---|
| S1 | AI Memory (the current design) | The recall extension: matching notes before each prompt, and `mirror_recall`. AI Memory holds the captured events and the consolidated session pages. | Recall extension, memory client, AI Memory service, model bridge |
| S2 | Raw Pi sessions in the vault | The journey's Pi session files in `.pi/sessions/`, and a `jq` command in `AGENTS.md` that extracts user and mirror messages for `rg` | None. A journey `.pi/settings.json` with `"sessionDir": ".pi/sessions"` stores sessions there. |
| S3 | Markdown transcripts in the vault | One Markdown file per session in `sessions/`, user and mirror text only, searched with `rg` | One extension that writes the transcripts |

Only the `## Memory` section of the vault's `AGENTS.md`, the files in the journey, and the extensions differ. See `mirror-pi/evals/experiments/memory/strategies.ts` in commit `545de28`.

## 2 Method

- History: 24 sessions of the synthetic health journey over twelve weeks (`history.ts`), run once in order with the real chat model.
  The AI Memory extension captured them, and AI Memory consolidated every session (S1). The same Pi session files are S2, and their conversion to Markdown is S3.
- Questions: 35, each in a new session (`questions.ts`):
  8 single facts, 6 summaries across sessions, 7 dates, 6 current facts after a correction or change, 3 about what the mirror itself said, 3 unprompted probes (the user states an outdated premise and does not ask), 2 never discussed.
- Runs: 6 per strategy, 630 answers, shuffled across strategies, 6 at a time. The plan was 3 runs. A bug in the first grading command started runs 4 to 6 with the same history and settings. They are kept.
- Models: chat `openai/gpt-6-astra` with medium thinking; blind grader `anthropic/claude-sonnet-5-5`, which never sees the strategy. S1's consolidation used `anthropic/claude-haiku-5-5` through the model bridge.
- AI Memory 3.2.2 (`sha256:457950a3…`) with the local embedding model.
- One answer key was wrong: the first 6 p.m. call was on 30 September, not in October. The key was corrected and `q22` and `q26` were graded again for all strategies.

## 3 Results

| Strategy | Score | Single | Multi | Dates | Current | Said | Probe | Abstain | Contradictions |
|---|---|---|---|---|---|---|---|---|---|
| S1 AI Memory | 85% (83–87% per run) | 100% | 83% | 85% | 99% | 0% | 100% | 100% | 3 |
| S2 raw sessions | 100% (every run) | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0 |
| S3 transcripts | 100% (every run) | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 0 |

Correct is 1 point and partial is 0.5.

| Strategy | Build | Cost per question | Input tokens | Tool calls | Median time |
|---|---|---|---|---|---|
| S1 | $0.02 (27 consolidation calls) | $0.104 | 34.6k | 7.8 | 26 s |
| S2 | none | $0.108 | 30.3k | 7.3 | 26 s |
| S3 | none | $0.117 | 36.6k | 8.5 | 28 s |

Most of the cost per question is the same in every strategy: the system prompt and the identity files the model reads before its first answer.

## 4 Findings

- **S1 cannot recall what the mirror said.** The AI Memory Pi extension does not capture assistant replies. All 18 answers about the mirror's own words failed; the model said it did not have them and did not invent them.
- **S1 loses details in consolidation.** The start date of melatonin ("I started tonight", on 31 August) did not survive into the session pages. Up to three `mirror_recall` searches did not find it, so the date questions and the melatonin and phone summaries lost points. This is the paper's writer ceiling: a cheaper model wrote the notes that the chat model reads.
- **S2 and S3 searched every time.** Their instructions say to search before any answer that may depend on the past, and the model did so in 210 of 210 sessions, including all probes. The cost and time were the same as S1.
- **Automatic recall works for probes, but so does searching first.** S1 caught every outdated premise through its injected notes. S2 and S3 caught every one by searching at the first message.
- **S2 equals S3.** With the `jq` command, the noise of raw session files did not matter. S2 used fewer tokens than S3 at this size.

## 5 Limits

- One synthetic journey of 24 short sessions (2.2 MB of session files). Years of sessions were not tested. Searching all files on every question will cost more as the record grows, and lexical search can miss what semantic search would find.
- One answer key, written by the author, and one grader. The grader was strict on the cases that were checked by hand.
- All history sessions were generated on one day. Their file names and AI Memory timestamps are from that day; the real dates are only in the text. This affects every strategy.
- S1's question sessions had the recall extension only. The AI Memory extension was not loaded, so the model did not have AI Memory's own `memory_*` tools, such as reading raw observations. Its capture would have added the question sessions to the record. The mirror's replies would still be missing.
- The probes are three single-turn statements. Spontaneous continuity over a long conversation was not measured.

## 6 Conclusion

For this journey, raw sessions in the vault (S2) answered every question correctly with no Mirror memory code and no memory service, at the same cost and time as AI Memory.
AI Memory scored 85%, mostly because it does not keep the mirror's replies and its summaries drop details.
S3 adds an extension and a second copy of the record for no measured gain over S2.

## 7 Decision

Mirror uses S2. Pi stores sessions in its default directory, `<agent dir>/sessions/--<journey path>--/`, which already separates journeys, so no journey needs a `.pi/settings.json`.
The search command in `content/AGENTS.md` builds that path; only the directory differs from the tested command.
Pi's own `-c` and `/resume` work unchanged. The recall extension, the AI Memory publication of records, the development AI Memory service, and the model bridge were removed.

## 8 Run again

The experiment code was removed with AI Memory. It is in commit `545de28`:

```sh
git worktree add /tmp/mirror-memexp 545de28 && cd /tmp/mirror-memexp && pnpm install
scripts/ai-memory.sh up --llm && scripts/model-bridge.sh start
out=mirror-pi/evals/results/memory/$(date -u +%Y%m%dT%H%M%SZ)
node mirror-pi/evals/experiments/memory/generate.ts "$out"   # about 15 minutes, then consolidation
node mirror-pi/evals/experiments/memory/ask.ts "$out" 3 6    # runs, concurrency
node mirror-pi/evals/experiments/memory/grade.ts "$out" 6
node mirror-pi/evals/experiments/memory/report.ts "$out"
```
