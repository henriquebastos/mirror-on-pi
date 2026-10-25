// The projection builds every vault: evals, development, and the user's. These tests use the real repository.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { projectVault, type Projection } from "../../src/projection.ts";
import { REPO, tempDir } from "../support/content.ts";

function git(vault: string, ...args: string[]): string {
  return execFileSync("git", ["-C", vault, ...args], { encoding: "utf8" }).trim();
}

async function project(vault: string): Promise<Projection> {
  const projection = await projectVault(REPO, vault);
  if (!projection.ok) throw new Error(projection.error);
  return projection.value;
}

test("the vault's Git ignores Mirror's Pi agent directory, with its auth link and sessions", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await mkdir(join(vault, ".pi", "agent", "sessions", "--vault--"), { recursive: true });
  await writeFile(join(vault, ".pi", "agent", "auth.json"), "{}");
  await writeFile(join(vault, ".pi", "agent", "sessions", "--vault--", "s.jsonl"), "{}\n");

  assert.equal(git(vault, "status", "--porcelain", "--untracked-files=all"), "");
  assert.equal(git(vault, "ls-files", ".pi"), ".pi/.gitignore\n.pi/settings.json");
});

function outcome(projection: Projection, path: string): string | undefined {
  return projection.files.find((file) => file.path === path)?.outcome;
}

test("a new vault gets its own Git repository, Mirror's files, and the starter content in one commit", async () => {
  const vault = join(await tempDir(), "new", "vault");
  const projection = await project(vault);

  assert.equal(git(vault, "rev-parse", "--show-toplevel"), vault);
  assert.equal(outcome(projection, "AGENTS.md"), "created");
  assert.equal(outcome(projection, ".agents/skills/soul/SKILL.md"), "created");
  assert.equal(outcome(projection, "identity/ego/constraints.md"), "created");
  assert.equal(outcome(projection, "journeys/health/AGENTS.md"), "created");
  assert.equal(await readFile(join(vault, "AGENTS.md"), "utf8"), await readFile(join(REPO, "vault", "AGENTS.md"), "utf8"));
  assert.equal(git(vault, "rev-list", "--count", "HEAD"), "1");
  assert.equal(git(vault, "rev-parse", "HEAD"), projection.commit);
  assert.match(git(vault, "log", "-1", "--format=%s"), /^chore: project Mirror [0-9a-f]{7}/);
  assert.equal(git(vault, "status", "--porcelain"), "", "everything projected is committed");
});

test("projecting again changes nothing and makes no commit", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  const again = await project(vault);

  assert.ok(again.files.every((file) => file.outcome === "kept"), "every Mirror file is kept");
  assert.equal(again.commit, undefined);
  assert.equal(git(vault, "rev-list", "--count", "HEAD"), "1");
});

test("a committed edit of a Mirror file is replaced, and Git keeps the edit in history", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await writeFile(join(vault, "AGENTS.md"), "my own instructions\n");
  git(vault, "commit", "-qam", "edit AGENTS.md");
  const projection = await project(vault);

  assert.equal(outcome(projection, "AGENTS.md"), "updated");
  assert.equal(await readFile(join(vault, "AGENTS.md"), "utf8"), await readFile(join(REPO, "vault", "AGENTS.md"), "utf8"));
  assert.equal(git(vault, "show", "HEAD~1:AGENTS.md"), "my own instructions");
});

test("an uncommitted edit of a Mirror file stops the projection before it writes anything", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await writeFile(join(vault, "AGENTS.md"), "uncommitted\n");
  await rm(join(vault, "README.md"));
  const projection = await projectVault(REPO, vault);

  assert.ok(!projection.ok);
  assert.match(projection.error, /AGENTS\.md/);
  assert.equal(await readFile(join(vault, "AGENTS.md"), "utf8"), "uncommitted\n");
  assert.equal(existsSync(join(vault, "README.md")), false, "no other Mirror file was written");
  assert.equal(git(vault, "rev-list", "--count", "HEAD"), "1");
});

test("the user's content stays the user's: edits, deletions, records, and staged work", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await writeFile(join(vault, "identity", "user", "identity.md"), "# Me\n");
  await rm(join(vault, "journeys", "career"), { recursive: true });
  git(vault, "add", "-A");
  git(vault, "commit", "-qm", "my identity, no career journey");
  await mkdir(join(vault, "journeys", "health", "journal"));
  await writeFile(join(vault, "journeys", "health", "journal", "entry.md"), "a record\n");
  await writeFile(join(vault, "notes.md"), "staged\n");
  git(vault, "add", "notes.md");
  await writeFile(join(vault, "AGENTS.md"), "x\n");
  git(vault, "commit", "-qm", "edit AGENTS.md", "--", "AGENTS.md");
  await project(vault);

  assert.equal(await readFile(join(vault, "identity", "user", "identity.md"), "utf8"), "# Me\n");
  assert.equal(existsSync(join(vault, "journeys", "career")), false, "a deleted starter journey is not copied again");
  assert.deepEqual(git(vault, "show", "--name-only", "--format=", "HEAD").split("\n"), ["AGENTS.md"], "the projection commits only its own files");
  assert.equal(git(vault, "status", "--porcelain"), "A  notes.md\n?? journeys/health/journal/".trim());
});

test("an existing directory without Git keeps its files, and starter files never replace them", async () => {
  const vault = join(await tempDir(), "vault");
  await mkdir(join(vault, "identity", "user"), { recursive: true });
  await writeFile(join(vault, "identity", "user", "identity.md"), "# Already here\n");
  const projection = await project(vault);

  assert.equal(git(vault, "rev-parse", "--show-toplevel"), vault);
  assert.equal(outcome(projection, "identity/user/identity.md"), undefined, "an existing file is not part of the projection");
  assert.equal(await readFile(join(vault, "identity", "user", "identity.md"), "utf8"), "# Already here\n");
  assert.equal(outcome(projection, "identity/ego/constraints.md"), "created");
});

test("an existing directory whose Mirror files already match gets them committed", async () => {
  const vault = join(await tempDir(), "vault");
  await mkdir(vault);
  await writeFile(join(vault, "AGENTS.md"), await readFile(join(REPO, "vault", "AGENTS.md")));
  const projection = await project(vault);

  assert.equal(outcome(projection, "AGENTS.md"), "kept");
  assert.notEqual(projection.commit, undefined);
  assert.equal(git(vault, "status", "--porcelain"), "", "every Mirror file is committed");
});

test("the mirror-init command reports each file and refuses uncommitted Mirror files", async () => {
  const vault = join(await tempDir(), "vault");
  const command = join(REPO, "scripts", "mirror-init.sh");
  const first = spawnSync(command, [vault], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^created AGENTS\.md$/m);
  assert.match(first.stdout, /^Committed [0-9a-f]{7} in /m);

  await writeFile(join(vault, "AGENTS.md"), "uncommitted\n");
  const refused = spawnSync(command, [vault], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Uncommitted changes in files that Mirror owns: AGENTS\.md/);

  assert.equal(spawnSync(command, [], { encoding: "utf8" }).status, 2);
});
