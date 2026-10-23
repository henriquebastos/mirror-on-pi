# TypeScript in Mirror

Mirror has little code. Each rule below prevents a failure that matters here: a lost memory event, a record written to the wrong place, untrusted data treated as trusted, or a state that should not exist.
The **Check** column names the tool that enforces the rule. "Review" means no tool catches it.

Run all checks with `pnpm check` (TypeScript 6, typed ESLint, contract evals). Node runs the `.ts` files directly, so only erasable TypeScript syntax is allowed.

## 1 Rules

| ID | Rule | Why | Check |
|---|---|---|---|
| 1a | Await, return, or explicitly `void` every promise. | A memory write that nobody awaits can fail without a trace. | `no-floating-promises`, `no-misused-promises` |
| 1b | Treat indexed access as possibly missing. | `entries[0]` can be `undefined`. | `noUncheckedIndexedAccess` |
| 1c | Model finite states as discriminated unions. | A session cannot be both ready and blocked. | Review |
| 1d | Make every `switch` over a union exhaustive. End with `assertNever`. | A new state cannot be forgotten. | `switch-exhaustiveness-check` |
| 1e | Validate untrusted input once, at the boundary. | AI Memory responses, YAML frontmatter, profile files, and tool arguments come from outside. | `no-unsafe-type-assertion`, review |
| 1f | Use `unknown`, never `any`. Narrow with type guards. | `any` turns the checker off and spreads. | `no-explicit-any`, `no-unsafe-*` |
| 1g | Return `Result` for expected failures. Throw `Error` for bugs and broken infrastructure. | The caller must handle "memory is unreachable". A broken invariant should stop the process. | `only-throw-error`, review |
| 1h | Prefer `readonly` data. | Callers cannot change state behind a module's back. | Review |
| 1i | Use explicit boolean conditions. | `if (count)` is false for `0`; `if (text)` is false for `""`. | `strict-boolean-expressions` |
| 1j | Use `type`, named exports, `import type`, and `.ts` import paths. No enums or namespaces. | One style, and Node can strip the types. | `consistent-type-definitions`, `no-restricted-syntax`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| 1k | Give exported functions explicit return types. | The contract is visible and stable. | `explicit-module-boundary-types` |
| 1l | Keep functions small: complexity at most 10, nesting at most 4. | Small functions are easier to test and review. | `complexity`, `max-depth` |
| 1m | Every suppression carries a reason on the same line. | A silent suppression hides a real defect later. | `ban-ts-comment` |
| 1n | Inject time, randomness, network, and file locations. | Tests can control them. | Review |
| 1o | Every guarantee has an eval that fails when the guarantee breaks. | A test that cannot fail proves nothing. | `pnpm test:mutants` |

The only default export is a Pi extension entry point, because Pi requires it.

## 2 Examples

### 2a Results for expected failures

```typescript
// Bad: the caller cannot tell "memory is down" from a bug.
async function recent(scope: MemoryScope): Promise<QueryHit[]> {
  const response = await fetch(url);
  return (await response.json()).hits;
}

// Good: an expected failure is a value the caller must handle.
async function recent(scope: MemoryScope): Promise<Result<readonly QueryHit[], MemoryError>> {
  const response = await post("/mcp", request);
  if (!response.ok) return response;
  return parseHits(response.value);
}
```

### 2b Narrow untrusted data instead of asserting it

```typescript
// Bad: the assertion trusts whatever the server sent.
const page = JSON.parse(text) as { page_id: string };

// Good: check the shape and fail as a value when it is wrong.
const parsed: unknown = JSON.parse(text);
if (!isRecord(parsed)) return err({ kind: "protocol", message: "result is not an object" });
const pageId = stringField(parsed, "page_id");
if (pageId === undefined) return err({ kind: "protocol", message: "no page_id" });
```

### 2c Discriminated unions with exhaustive handling

```typescript
type BindingDecision =
  | { readonly kind: "create"; readonly binding: JourneyBinding }
  | { readonly kind: "bound"; readonly binding: JourneyBinding }
  | { readonly kind: "mismatch"; readonly existing: JourneyBinding; readonly requested: JourneyBinding }
  | { readonly kind: "unbound-history" };

function bindingFailure(decision: BindingDecision): string | undefined {
  switch (decision.kind) {
    case "create":
    case "bound":
      return undefined;
    case "mismatch":
      return `this session belongs to journey "${decision.existing.journey}"`;
    case "unbound-history":
      return "this session has history but no journey binding";
    default:
      return assertNever(decision);
  }
}
```

### 2d Never drop a promise

```typescript
// Bad: the flush can fail and nobody notices; events can be lost on exit.
pi.on("session_shutdown", () => { queue.flush(); });

// Good: wait, with a bound, before the process ends.
pi.on("session_shutdown", async () => {
  await Promise.race([queue.flush(), delay(3_000)]);
});

// Good: deliberate fire-and-forget is marked, and the queue keeps failed events for the next flush.
void queue.flush();
```

### 2e Explicit conditions

```typescript
// Bad: an empty persona string is treated as "no persona" by accident.
if (process.env.MIRROR_PERSONA) persona = process.env.MIRROR_PERSONA;

// Good: state what absence means.
const value = process.env.MIRROR_PERSONA;
const persona = value === undefined || value === "" ? undefined : value;
```

### 2f Files: create exclusively, never overwrite

```typescript
// Bad: a second entry with the same title replaces the first one.
await writeFile(path, text);

// Good: "wx" fails when the file exists; pick the next free name.
await writeFile(path, text, { flag: "wx" });
```

### 2g Injected clock

```typescript
// Bad: tests cannot fix the date in file names.
const stem = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}`;

// Good: the caller supplies the clock.
const stem = `${context.now().toISOString().slice(0, 10)}-${slugify(title)}`;
```

## 3 Tests that find bugs

- Test behavior at the module's contract, not private helpers.
- Use real components where they are cheap: real files in a temporary vault, real Pi sessions, the local AI Memory.
- Script the model only to test wiring. Do not treat a scripted answer as evidence of reflective quality.
- For each guarantee, add a mutant to `mirror-pi/evals/mutants.ts` that breaks it, and check that the evals fail.
- Assert on exact observable results: file names, page paths, captured prompts, and blocked tool reasons.
