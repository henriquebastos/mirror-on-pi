import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { appendIntegration, findVault, planIntegration, writeIntegration } from "../../src/identity.ts";
import { tempVault } from "../support/content.ts";

const fixed = new Date("2026-10-24T08:30:00Z");

// Every line of the old document is still there, in order.
function keepsEveryLine(before: string, after: string): boolean {
  const remaining = after.split("\n");
  let index = 0;
  for (const line of before.replace(/\n$/, "").split("\n")) {
    index = remaining.indexOf(line, index);
    if (index === -1) return false;
    index++;
  }
  return true;
}

test("an integration goes to the end of its section, before the next section, and keeps every line", () => {
  const before = "# Soul\n\nI am the mirror.\n\n## New Incorporated Principles\n\n- [2026-10-01] First.\n\n## Other\n\nKeep me.\n";
  const after = appendIntegration(before, "New Incorporated Principles", "- [2026-10-24] Second.");
  assert.equal(after, "# Soul\n\nI am the mirror.\n\n## New Incorporated Principles\n\n- [2026-10-01] First.\n- [2026-10-24] Second.\n\n## Other\n\nKeep me.\n");
  assert.ok(keepsEveryLine(before, after));
});

test("a missing section is added at the end, and an empty file gets only the section", () => {
  const before = "# Behavior\n\nSome text.";
  const after = appendIntegration(before, "New Operational Patterns Identified", "- [2026-10-24] Pattern.");
  assert.equal(after, "# Behavior\n\nSome text.\n\n## New Operational Patterns Identified\n\n- [2026-10-24] Pattern.\n");
  assert.ok(keepsEveryLine(before, after));
  assert.equal(appendIntegration("", "New Hidden Needs Recognized", "- [2026-10-24] Need."), "## New Hidden Needs Recognized\n\n- [2026-10-24] Need.\n");
  const empty = appendIntegration("# Soul\n\n## New Incorporated Principles\n\n## Next\n", "New Incorporated Principles", "- [2026-10-24] P.");
  assert.equal(empty, "# Soul\n\n## New Incorporated Principles\n\n- [2026-10-24] P.\n\n## Next\n");
});

test("each layer has its file and section, and the bullet is dated with the exact text", async () => {
  const vault = await tempVault("mirror");
  const plan = async (layer: "self" | "shadow" | "ego" | "persona", persona?: string): Promise<string> => {
    const target = await planIntegration(vault.root, { layer, persona, text: "  My measure also belongs to care.  " }, fixed);
    assert.ok(target.ok, target.ok ? "" : target.error);
    assert.equal(target.value.bullet, "- [2026-10-24] My measure also belongs to care.");
    return `${target.value.relativePath} | ${target.value.section}`;
  };
  assert.equal(await plan("self"), "identity/self/soul.md | New Incorporated Principles");
  assert.equal(await plan("shadow"), "identity/shadow/profile.md | New Hidden Needs Recognized");
  assert.equal(await plan("ego"), "identity/ego/behavior.md | New Operational Patterns Identified");
  assert.equal(await plan("persona", "therapist"), "identity/personas/therapist.md | New Participation Patterns Revealed");
});

test("empty, multi-line, unknown-persona, and misplaced-persona integrations are refused", async () => {
  const vault = await tempVault("mirror");
  const refused = async (layer: "self" | "persona", text: string, persona?: string): Promise<string> => {
    const target = await planIntegration(vault.root, { layer, persona, text }, fixed);
    assert.ok(!target.ok);
    return target.error;
  };
  assert.match(await refused("self", "   "), /empty/);
  assert.match(await refused("self", "One.\n## Two"), /one line/);
  assert.match(await refused("persona", "Text.", "nobody"), /no persona nobody/);
  assert.match(await refused("persona", "Text.", "../self/soul"), /Slug/);
  assert.match(await refused("self", "Text.", "therapist"), /only valid for the persona layer/);
});

test("writing keeps the identity file's earlier content and the vault is found from a journey directory", async () => {
  const vault = await tempVault("mirror");
  assert.equal(await findVault(vault.journey("health")), vault.root);
  const file = join(vault.root, "identity/self/soul.md");
  const before = await readFile(file, "utf8");
  const target = await planIntegration(vault.root, { layer: "self", persona: undefined, text: "I keep my center." }, fixed);
  assert.ok(target.ok);
  await writeIntegration(target.value);
  const after = await readFile(file, "utf8");
  assert.ok(after.startsWith(before.replace(/\n+$/, "")), "the earlier content is unchanged");
  assert.match(after, /## New Incorporated Principles\n\n- \[2026-10-24\] I keep my center\.\n$/);
});

test("a missing shadow profile is created with the section only", async () => {
  const vault = await tempVault("mirror");
  await rm(join(vault.root, "identity/shadow"), { recursive: true, force: true });
  const target = await planIntegration(vault.root, { layer: "shadow", persona: undefined, text: "A part of me buys safety with availability." }, fixed);
  assert.ok(target.ok);
  await writeIntegration(target.value);
  assert.equal(await readFile(target.value.file, "utf8"), "## New Hidden Needs Recognized\n\n- [2026-10-24] A part of me buys safety with availability.\n");
});
