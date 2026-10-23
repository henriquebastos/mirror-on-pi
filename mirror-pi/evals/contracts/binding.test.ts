import assert from "node:assert/strict";
import { test } from "node:test";
import { BINDING_ENTRY_TYPE, bindingFor, decideBinding } from "../../src/binding.ts";

const health = bindingFor("health", { workspace: "mirror", project: "health" });
const career = bindingFor("career", { workspace: "mirror", project: "career" });
const entry = (data: unknown) => ({ type: "custom", customType: BINDING_ENTRY_TYPE, data });

test("a new empty session is bound to the requested journey", () => {
  assert.deepEqual(decideBinding([], health), { kind: "create", binding: health });
});

test("a resumed session keeps its journey", () => {
  assert.deepEqual(decideBinding([entry(health), { type: "message" }], health), { kind: "bound", binding: health });
});

test("a session of another journey is refused", () => {
  assert.deepEqual(decideBinding([entry(health)], career), { kind: "mismatch", existing: health, requested: career });
});

test("the same journey in another memory workspace is refused", () => {
  const dev = bindingFor("health", { workspace: "mirror-dev", project: "health" });
  assert.equal(decideBinding([entry(health)], dev).kind, "mismatch");
});

test("history without a binding is refused", () => {
  assert.deepEqual(decideBinding([{ type: "message" }], health), { kind: "unbound-history" });
});

test("invalid or conflicting bindings are refused", () => {
  assert.equal(decideBinding([entry({ version: 2 })], health).kind, "corrupt");
  assert.equal(decideBinding([entry(health), entry(career)], health).kind, "corrupt");
});
