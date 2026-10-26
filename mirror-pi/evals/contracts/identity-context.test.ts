import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CONSTRAINTS_FILE, identitySection } from "../../src/identity-context.ts";
import { tempVault } from "../support/content.ts";

test("the identity section holds the hard constraints in full and one line per other identity file", async () => {
  const vault = await tempVault();
  const section = await identitySection(vault.root) ?? "";
  const constraints = (await readFile(join(vault.root, CONSTRAINTS_FILE), "utf8")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  assert.ok(section.includes(constraints), "the constraints, without frontmatter");
  assert.doesNotMatch(section, /layer: ego/);
  assert.match(section, /^- `identity\/self\/soul\.md`$/m);
  assert.match(section, /^- `identity\/user\/identity\.md`$/m);
  assert.match(section, /^- `identity\/personas\/strategist\.md`: Strategist: Positioning, decisions, and trade-offs\.$/m);
  assert.doesNotMatch(section, /^- `identity\/ego\/constraints\.md`/m, "the constraints are not listed again");
  for (const file of ["identity/self/soul.md", "identity/user/identity.md"]) {
    const lines = (await readFile(join(vault.root, file), "utf8")).split("\n");
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
    assert.ok(!section.includes(longest), `${file} is not inlined`);
  }
});

test("a long persona description is shortened to one line, and hidden files are left out", async () => {
  const vault = await tempVault();
  const long = `Lens for ${"many things ".repeat(30)}`;
  await writeFile(join(vault.root, "identity", "personas", "wide.md"), `---\nname: Wide\ndescription: >-\n  ${long}\n---\n# Wide\n`);
  await mkdir(join(vault.root, "identity", ".obsidian"), { recursive: true });
  await writeFile(join(vault.root, "identity", ".obsidian", "app.json"), "{}");
  await writeFile(join(vault.root, "identity", "user", ".DS_Store"), "");
  const section = await identitySection(vault.root) ?? "";
  const line = section.split("\n").find((each) => each.startsWith("- `identity/personas/wide.md`")) ?? "";
  assert.ok(line.endsWith("…") && line.length < 220, line);
  assert.doesNotMatch(section, /\.obsidian|\.DS_Store/);
});

test("constraints with broken frontmatter still reach the model; a vault without constraints lists only the files", async () => {
  const vault = await tempVault();
  await writeFile(join(vault.root, CONSTRAINTS_FILE), "---\nlayer: [ego\n---\nNever share the address.\n");
  assert.match(await identitySection(vault.root) ?? "", /Never share the address\./);
  await rm(join(vault.root, CONSTRAINTS_FILE));
  const section = await identitySection(vault.root) ?? "";
  assert.doesNotMatch(section, /Hard constraints/);
  assert.match(section, /`identity\/self\/soul\.md`/);
});

test("a vault without identity files gets no identity section", async () => {
  const vault = await tempVault();
  await rm(join(vault.root, "identity"), { recursive: true });
  assert.equal(await identitySection(vault.root), undefined);
  await mkdir(join(vault.root, "identity"));
  assert.equal(await identitySection(vault.root), undefined);
});
