import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { journeyAt, listJourneys } from "../../src/journey.ts";
import { tempVault, type EvalVault } from "../support/content.ts";

// A vault whose map lists a journey outside `journeys/`, with list items that are not journeys.
async function vaultWithMap(map: string): Promise<EvalVault> {
  const vault = await tempVault();
  await mkdir(join(vault.root, "projects", "garden"), { recursive: true });
  await writeFile(join(vault.root, "projects", "garden", "JOURNEY.md"), "---\ndescription: Raised beds and the compost.\n---\n# Journey: Garden\n");
  await writeFile(join(vault.root, "AGENTS.md"), map);
  return vault;
}

const MAP = [
  "# Vault",
  "",
  "- `notes`: `notes/`",
  "",
  "## Journeys",
  "",
  "- `garden`: `projects/garden/`",
  "- `boat`: `projects/boat/`",
  "- `outside`: `../elsewhere/`",
  "",
  "## Other",
  "",
  "- `recipes`: `projects/`",
  "",
].join("\n");

test("the map's Journeys section adds journeys anywhere in the vault, next to the directories below journeys/", async () => {
  const vault = await vaultWithMap(MAP);
  const journeys = await listJourneys(vault.root);
  assert.deepEqual(journeys.map((journey) => [journey.slug, journey.path]), [["career", "journeys/career/"], ["garden", "projects/garden/"], ["health", "journeys/health/"]]);
  assert.equal(journeys.find((journey) => journey.slug === "garden")?.description, "Raised beds and the compost.");
});

test("a listed journey whose directory is missing, outside the vault, or outside the Journeys section is not a journey", async () => {
  const vault = await vaultWithMap(MAP);
  await mkdir(join(vault.root, "..", "elsewhere"), { recursive: true });
  const slugs = (await listJourneys(vault.root)).map((journey) => journey.slug);
  for (const slug of ["boat", "outside", "notes", "recipes"]) assert.ok(!slugs.includes(slug), `${slug} is not a journey`);
});

test("a session belongs to the journey directory at or above its working directory", async () => {
  const vault = await vaultWithMap(MAP);
  assert.equal((await journeyAt(vault.root, vault.journey("career")))?.slug, "career");
  const nested = join(vault.journey("health"), "files", "scans");
  await mkdir(nested, { recursive: true });
  assert.equal((await journeyAt(vault.root, nested))?.slug, "health");
  assert.equal((await journeyAt(vault.root, join(vault.root, "projects", "garden")))?.slug, "garden");
});

test("directories outside a journey have no journey", async () => {
  const vault = await vaultWithMap(MAP);
  assert.equal(await journeyAt(vault.root, vault.root), undefined);
  assert.equal(await journeyAt(vault.root, join(vault.root, "journeys")), undefined);
  assert.equal(await journeyAt(vault.root, join(vault.root, "projects")), undefined);
  assert.equal(await journeyAt(vault.root, join(vault.root, "projects", "garden-old")), undefined);
  assert.equal(await journeyAt(vault.root, join(vault.root, "identity", "self")), undefined);
});
