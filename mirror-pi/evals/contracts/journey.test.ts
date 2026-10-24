import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { findJourney } from "../../src/journey.ts";
import { tempVault } from "../support/content.ts";

test("a session belongs to the journey directory at or above its working directory", async () => {
  const vault = await tempVault();
  assert.deepEqual(findJourney(vault.journey("career")), { dir: vault.journey("career"), slug: "career" });
  const nested = join(vault.journey("health"), "files", "scans");
  await mkdir(nested, { recursive: true });
  assert.deepEqual(findJourney(nested), { dir: vault.journey("health"), slug: "health" });
});

test("directories outside a journey have no journey", async () => {
  const vault = await tempVault();
  assert.equal(findJourney(vault.root), undefined);
  assert.equal(findJourney(join(vault.root, "journeys")), undefined);
  assert.equal(findJourney(join(vault.root, "identity", "self")), undefined);
  assert.equal(findJourney("/"), undefined);
});
