import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { composeSections, renderSections } from "../../src/compose.ts";
import { loadIdentity, loadJourney, sharedProjects, type Journey } from "../../src/content.ts";
import { tempContent } from "../support/content.ts";

test("composition follows Mirror's section order with persona, organization, sorted knowledge, and journey last", async () => {
  const content = await tempContent();
  await writeFile(join(content, "identity/knowledge/a-b.md"), "AB knowledge");
  await writeFile(join(content, "identity/knowledge/a.md"), "A knowledge");
  const identity = await loadIdentity(content);
  const journey = await loadJourney(content, "health");
  assert.ok(identity.ok && journey.ok);
  const sections = composeSections(identity.value, { persona: "therapist", organization: true, journey: journey.value });
  assert.ok(sections.ok);
  assert.deepEqual(sections.value.map((section) => section.label), [
    "⛔ HARD CONSTRAINTS",
    "self/soul",
    "ego/behavior",
    "user/identity",
    "ego/identity",
    "organization/identity",
    "organization/principles",
    "persona/therapist",
    "knowledge/a",
    "knowledge/a-b",
    "knowledge/reflection-practice",
    "journey/health",
  ]);
  const text = renderSections(sections.value);
  assert.match(text, /^=== ⛔ HARD CONSTRAINTS ===\n## Language/);
  assert.match(text, /=== journey\/health ===\n# Health\n\*\*Status:\*\* active\n\n## Description\nSleep, energy/);
  assert.doesNotMatch(text, /^---$/m, "frontmatter must not leak into the context");
});

test("composition omits organization unless requested and rejects an unknown persona", async () => {
  const content = await tempContent();
  const identity = await loadIdentity(content);
  const journey = await loadJourney(content, "career");
  assert.ok(identity.ok && journey.ok);
  const plain = composeSections(identity.value, { persona: undefined, organization: false, journey: journey.value });
  assert.ok(plain.ok);
  assert.ok(!plain.value.some((section) => section.label.startsWith("organization/")));
  const unknown = composeSections(identity.value, { persona: "astrologer", organization: false, journey: journey.value });
  assert.deepEqual(unknown, { ok: false, error: 'Persona "astrologer" does not exist' });
});

test("required identity files must exist", async () => {
  const content = await tempContent();
  await rm(join(content, "identity/self/soul.md"));
  const identity = await loadIdentity(content);
  assert.ok(!identity.ok);
  assert.match(identity.error.path, /self\/soul\.md$/);
});

test("journeys validate slug, status, and memory project", async () => {
  const content = await tempContent();
  assert.ok(!(await loadJourney(content, "../health")).ok);
  assert.ok(!(await loadJourney(content, "missing")).ok);
  const health = await loadJourney(content, "health");
  assert.ok(health.ok);
  assert.equal(health.value.memoryProject, "health");
  await mkdir(join(content, "journeys/bad"));
  await writeFile(join(content, "journeys/bad/journey.md"), "---\nstatus: abandoned\n---\nx");
  const bad = await loadJourney(content, "bad");
  assert.ok(!bad.ok);
  assert.match(bad.error.message, /status must be/);
  await writeFile(join(content, "journeys/bad/journey.md"), "---\nmemory_project: Bad Project\n---\nx");
  assert.ok(!(await loadJourney(content, "bad")).ok);
  await writeFile(join(content, "journeys/bad/journey.md"), "---\ntitle: [unclosed\n---\nx");
  assert.ok(!(await loadJourney(content, "bad")).ok);
});

test("a journey defaults its memory project to its slug", async () => {
  const content = await tempContent();
  await mkdir(join(content, "journeys/reading"));
  await writeFile(join(content, "journeys/reading/journey.md"), "# Reading\n");
  const reading = await loadJourney(content, "reading");
  assert.ok(reading.ok);
  assert.equal(reading.value.memoryProject, "reading");
  assert.equal(reading.value.title, "reading");
  await symlink("/etc", join(content, "journeys/linked"));
  assert.ok(!(await loadJourney(content, "linked")).ok);
});

test("journeys that share an AI Memory project are reported", () => {
  const journey = (slug: string, memoryProject: string): Journey => ({ slug, title: slug, status: "active", description: undefined, memoryProject, context: "" });
  assert.deepEqual(sharedProjects([journey("health", "health"), journey("career", "career")]), []);
  assert.deepEqual(sharedProjects([journey("health", "life"), journey("career", "career"), journey("family", "life")]), ['journeys health, family share memory_project "life"']);
});
