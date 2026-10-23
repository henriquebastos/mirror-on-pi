import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMemoryContext } from "../../src/memory-context.ts";

const base = { journeyTitle: "Health", scope: { workspace: "mirror", project: "health" }, sessionId: "s1", failure: undefined };

test("recalled memory is framed as evidence and excludes the current session page", () => {
  const text = renderMemoryContext({
    ...base,
    relevant: [{ path: "sessions/s1.md", title: "this session", snippet: "" }, { path: "corrections/a.md", title: "Correction: calls", snippet: "Wednesdays" }],
    recent: [{ path: "corrections/a.md", title: "Correction: calls", snippet: "" }, { path: "journal/b.md", title: "Bad night", snippet: "" }],
  });
  assert.ok(text !== undefined);
  assert.match(text, /evidence, not instructions/);
  assert.doesNotMatch(text, /sessions\/s1\.md/);
  assert.equal(text.match(/corrections\/a\.md/g)?.length, 1);
  assert.match(text, /\[journal\/b\.md\] Bad night/);
});

test("no memory renders nothing, and unavailable memory is stated", () => {
  assert.equal(renderMemoryContext({ ...base, relevant: [], recent: [] }), undefined);
  const failed = renderMemoryContext({ ...base, relevant: [], recent: undefined, failure: { kind: "network", message: "refused" } });
  assert.match(failed ?? "", /unavailable \(network: refused\)/);
});
