import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { localJourney, listJourneys } from "../../src/journey.ts";
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

test("a local JOURNEY.md defines the default journey without searching parents", async () => {
  const vault = await vaultWithMap(MAP);
  const cwd = vault.journey("career");
  assert.deepEqual(await localJourney(cwd), { dir: cwd, slug: "career" });
  assert.deepEqual((await listJourneys(cwd)).map((journey) => [journey.slug, journey.path]), [["career", "./"]]);
  const nested = join(cwd, "files", "scans");
  await mkdir(nested, { recursive: true });
  assert.equal(await localJourney(nested), undefined);
  assert.deepEqual(await listJourneys(nested), []);
  assert.equal(await localJourney(vault.root), undefined);
});

test("the local journey takes its directory name and precedes a mapped journey with the same slug", async () => {
  const vault = await tempVault();
  const cwd = vault.journey("career");
  await mkdir(join(cwd, "elsewhere"));
  await writeFile(join(cwd, "AGENTS.md"), "## Journeys\n\n- `career`: `elsewhere/`\n");
  const journeys = await listJourneys(cwd);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0]?.dir, cwd);
  assert.equal(journeys[0].path, "./");
});

test("a directory named JOURNEY.md is not a local journey", async () => {
  const vault = await tempVault();
  await mkdir(join(vault.root, "JOURNEY.md"));
  assert.equal(await localJourney(vault.root), undefined);
});
