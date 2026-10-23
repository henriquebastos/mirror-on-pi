import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findJourney, MARKER, parseMarker, tomlString } from "../../src/journey.ts";
import { parseMemoryConfig, readMemoryToken } from "../../src/memory-config.ts";
import { tempVault } from "../support/content.ts";

test("a session belongs to the nearest journey marker at or above its directory", async () => {
  const vault = await tempVault("eval-ws");
  const career = await findJourney(vault.journey("career"));
  assert.deepEqual(career, { ok: true, value: { dir: vault.journey("career"), slug: "career", scope: { workspace: "eval-ws", project: "career" } } });
  const nested = join(vault.journey("health"), "files", "scans");
  await mkdir(nested, { recursive: true });
  const health = await findJourney(nested);
  assert.ok(health.ok && health.value?.scope.project === "health");
  assert.equal(health.value.dir, vault.journey("health"));
});

test("directories outside a journey have no journey", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "mirror-no-journey-")));
  assert.deepEqual(await findJourney(dir), { ok: true, value: undefined });
  const vault = await tempVault("eval-ws");
  assert.deepEqual(await findJourney(vault.root), { ok: true, value: undefined });
});

test("an incomplete or invalid marker is an error, not a silent default", async () => {
  assert.ok(!parseMarker("/v/journeys/x", 'project = "x"\n').ok);
  assert.ok(!parseMarker("/v/journeys/x", 'workspace = "mirror"\nproject = "../x"\n').ok);
  const dir = await realpath(await mkdtemp(join(tmpdir(), "mirror-bad-marker-")));
  await writeFile(join(dir, MARKER), 'workspace = "mirror"\n');
  assert.ok(!(await findJourney(dir)).ok);
});

test("marker values are read from top-level string keys", () => {
  const text = '# scope\nworkspace = "mirror"  # dev\nproject_strategy = "x"\nproject="health"\n';
  assert.equal(tomlString(text, "workspace"), "mirror");
  assert.equal(tomlString(text, "project"), "health");
  assert.equal(tomlString(text, "missing"), undefined);
});

test("the AI Memory config resolves the token file from its own directory and prefers the token variable", async () => {
  const config = parseMemoryConfig({ url: "http://127.0.0.1:49390/", tokenFile: "../ai-memory/.env", tokenEnv: "T" }, "/repo/dev/pi-agent");
  assert.deepEqual(config, { ok: true, value: { url: "http://127.0.0.1:49390", tokenFile: "/repo/dev/ai-memory/.env", tokenEnv: "T" } });
  assert.ok(!parseMemoryConfig({ url: "ftp://x" }, "/").ok);
  assert.deepEqual(await readMemoryToken(config.value, { T: "from-env" }), { ok: true, value: "from-env" });
  const missing = await readMemoryToken(config.value, {});
  assert.ok(!missing.ok);
  assert.match(missing.error, /Cannot read the AI Memory token file/);
});
