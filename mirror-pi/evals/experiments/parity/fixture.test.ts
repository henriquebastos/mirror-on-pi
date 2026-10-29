// The frozen A2 history of the capability gate: it matches its manifest, and it materializes without a model call
// into a vault whose earlier sessions Pi can open, with this checkout's paths and nothing of the machine that froze it.
import assert from "node:assert/strict";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../../support/content.ts";
import { armDirs, prepareArm, sessionDirName } from "./arms.ts";
import { FIXTURE, materialize, readManifest, verifyFixture } from "./fixture.ts";
import { HISTORY } from "./history.ts";

test("the fixture matches its manifest", async () => {
  assert.deepEqual(await verifyFixture(), []);
});

test("a changed or unlisted fixture file is reported", async () => {
  const copy = join(await tempDir(), "fixture");
  await cp(FIXTURE, copy, { recursive: true });
  await writeFile(join(copy, "history.json"), "{}\n");
  await writeFile(join(copy, "extra.md"), "x\n");
  assert.deepEqual([...(await verifyFixture(copy))].sort(), ["changed: history.json", "not in the manifest: extra.md"]);
});

test("the fixture materializes into an A2 vault with every history session, which Pi opens", async () => {
  const root = await tempDir();
  await prepareArm("a2", join(root, "fresh"));
  await materialize(join(root, "fresh"), join(root, "history"));
  const dirs = armDirs("a2", join(root, "history"));
  const sessions = join(dirs.agent, "sessions", sessionDirName(dirs.cwd));
  const files = (await readdir(sessions)).filter((name) => name.endsWith(".jsonl"));
  assert.equal(files.length, HISTORY.length);
  for (const file of files) {
    const text = await readFile(join(sessions, file), "utf8");
    assert.doesNotMatch(text, /\{\{(ROOT|REPO|PI)\}\}/);
    const session = SessionManager.open(join(sessions, file), sessions);
    assert.equal(session.getCwd(), dirs.cwd);
    assert.ok(session.buildSessionContext().messages.length >= 2, file);
  }
  const manifest = await readManifest();
  for (const path of Object.keys(manifest.sha256).filter((entry) => entry.startsWith("vault/"))) await readFile(join(dirs.root, path), "utf8");
  assert.match(await readFile(join(dirs.root, "history.json"), "utf8"), new RegExp(`"cwd": "${dirs.cwd}"`));
});
