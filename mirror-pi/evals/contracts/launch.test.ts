import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStart, piArguments } from "../../src/cli/launch.ts";
import { parseProfile, readMemoryToken } from "../../src/config.ts";

const profile = parseProfile(
  { contentDir: "../content", piAgentDir: "/state/pi", memory: { url: "http://127.0.0.1:1/", workspace: "mirror-dev", tokenFile: "../t.env" }, model: { provider: "openai", id: "m", thinking: "low" } },
  "/repo/config/dev.json",
);

test("profiles resolve paths relative to the profile file", () => {
  assert.ok(profile.ok);
  assert.equal(profile.value.contentDir, "/repo/content");
  assert.equal(profile.value.memory.tokenFile, "/repo/t.env");
  assert.equal(profile.value.memory.url, "http://127.0.0.1:1");
  assert.ok(!parseProfile({ contentDir: "c", piAgentDir: "p", memory: { url: "ftp://x", workspace: "w" } }, "/p.json").ok);
  assert.ok(!parseProfile({ contentDir: "c", piAgentDir: "p", memory: { url: "http://x", workspace: "Not A Slug" } }, "/p.json").ok);
});

test("Mirror sessions load only the Mirror extension, no ambient resources, and a per-journey session directory", () => {
  assert.ok(profile.ok);
  const options = parseStart(["health", "-c", "--", "--name", "evening"]);
  assert.ok(options !== undefined);
  const args = piArguments(profile.value, "health", options, "/repo/ext.ts");
  for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--continue"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--extension") + 1], "/repo/ext.ts");
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls,mirror_recall,mirror_save_journal,mirror_record_correction");
  assert.equal(args[args.indexOf("--session-dir") + 1], "/state/pi/sessions/mirror-dev/health");
  assert.deepEqual(args.slice(-2), ["--name", "evening"]);
  assert.equal(parseStart([]), undefined);
  assert.equal(parseStart(["a", "b"]), undefined);
});

test("unknown launcher options print usage instead of crashing", () => {
  assert.equal(parseStart(["health", "--foo"]), undefined);
  assert.equal(parseStart(["health", "--persona"]), undefined);
  assert.equal(parseStart(["health", "--", "--foo"])?.passthrough[0], "--foo");
});

test("a missing token file is a reported error, not an exception", async () => {
  const token = await readMemoryToken({ url: "http://x", workspace: "w", tokenFile: "/nonexistent/mirror.env", tokenEnv: undefined }, {});
  assert.ok(!token.ok);
  assert.match(token.error, /Cannot read the AI Memory token file/);
  assert.deepEqual(await readMemoryToken({ url: "http://x", workspace: "w", tokenFile: undefined, tokenEnv: undefined }, {}), { ok: true, value: undefined });
});
