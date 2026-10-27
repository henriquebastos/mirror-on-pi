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

test("the vault's Git keeps Mirror's sessions and settings, and ignores the auth link, trust decisions, and caches", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  const agent = join(vault, ".pi", "agent");
  await mkdir(join(agent, "sessions", "--vault--"), { recursive: true });
  for (const file of ["auth.json", "trust.json", "models-store.json", "settings.json", "sessions/--vault--/s.jsonl"]) {
    await writeFile(join(agent, file), "{}\n");
  }

  assert.equal(git(vault, "status", "--porcelain", "--untracked-files=all"), "?? .pi/agent/sessions/--vault--/s.jsonl\n?? .pi/agent/settings.json");
});

function outcome(projection: Projection, path: string): string | undefined {
  return projection.files.find((file) => file.path === path)?.outcome;
}

test("a new vault gets its own Git repository, Mirror's files, and the starter content in one commit", async () => {
  const vault = join(await tempDir(), "new", "vault");
  const projection = await project(vault);

  assert.equal(git(vault, "rev-parse", "--show-toplevel"), vault);
  assert.equal(outcome(projection, "AGENTS.md"), "created");
  assert.equal(outcome(projection, ".pi/settings.json"), "created");
  assert.equal(existsSync(join(vault, ".agents")), false, "the Soul skill comes from the package, not from a copy in the vault");
  assert.equal(outcome(projection, "identity/ego/constraints.md"), "created");
  assert.equal(outcome(projection, "journeys/health/JOURNEY.md"), "created");
  assert.equal(await readFile(join(vault, "AGENTS.md"), "utf8"), await readFile(join(REPO, "starter", "AGENTS.md"), "utf8"), "the vault gets the starter map");
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
  await writeFile(join(vault, "README.md"), "my own readme\n");
  git(vault, "commit", "-qam", "edit README.md");
  const projection = await project(vault);

  assert.equal(outcome(projection, "README.md"), "updated");
  assert.equal(await readFile(join(vault, "README.md"), "utf8"), await readFile(join(REPO, "vault", "README.md"), "utf8"));
  assert.equal(git(vault, "show", "HEAD~1:README.md"), "my own readme");
});

test("the vault's AGENTS.md is the user's map: an edit stays, and a deleted map is not copied again", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await writeFile(join(vault, "AGENTS.md"), "# My map\n");
  git(vault, "commit", "-qam", "my map");
  assert.equal(outcome(await project(vault), "AGENTS.md"), undefined);
  assert.equal(await readFile(join(vault, "AGENTS.md"), "utf8"), "# My map\n");

  git(vault, "rm", "-q", "AGENTS.md");
  git(vault, "commit", "-qm", "no map");
  assert.equal(outcome(await project(vault), "AGENTS.md"), undefined);
  assert.equal(existsSync(join(vault, "AGENTS.md")), false);
});

test("Mirror's former instructions in AGENTS.md are replaced once by the starter map", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await writeFile(join(vault, "AGENTS.md"), "# Mirror\n\nThis directory is a Mirror vault. Pi runs here, at the vault root.\n");
  git(vault, "commit", "-qam", "chore: project Mirror 42068ad");
  const projection = await project(vault);

  assert.equal(outcome(projection, "AGENTS.md"), "updated");
  assert.equal(await readFile(join(vault, "AGENTS.md"), "utf8"), await readFile(join(REPO, "starter", "AGENTS.md"), "utf8"));
  assert.equal(git(vault, "status", "--porcelain"), "", "the replacement is committed");
});

test("an uncommitted edit of a Mirror file stops the projection before it writes anything", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  await writeFile(join(vault, "README.md"), "uncommitted\n");
  await rm(join(vault, ".pi", "settings.json"));
  const projection = await projectVault(REPO, vault);

  assert.ok(!projection.ok);
  assert.match(projection.error, /README\.md/);
  assert.equal(await readFile(join(vault, "README.md"), "utf8"), "uncommitted\n");
  assert.equal(existsSync(join(vault, ".pi", "settings.json")), false, "no other Mirror file was written");
  assert.equal(git(vault, "rev-list", "--count", "HEAD"), "1");
});

// The Soul skill as Mirror 0.1 projected it, committed in the vault.
async function formerSkill(vault: string): Promise<readonly string[]> {
  const files = ["SKILL.md", "voices/beauty.md", "voices/self.md", "voices/shadow.md", "voices/wisdom.md"].map((file) => `.agents/skills/soul/${file}`);
  for (const file of files) {
    await mkdir(join(vault, file, ".."), { recursive: true });
    await writeFile(join(vault, file), `${file}\n`);
  }
  git(vault, "add", "--", ...files);
  git(vault, "commit", "-qm", "chore: project Mirror 7a6cf7a");
  return files;
}

test("the Soul skill that Mirror 0.1 projected is deleted in one commit, and Git keeps it in history", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  const files = await formerSkill(vault);
  await writeFile(join(vault, ".agents", "skills", "notes.md"), "mine\n");
  const projection = await project(vault);

  assert.deepEqual(projection.files.filter((file) => file.outcome === "deleted").map((file) => file.path), files);
  assert.equal(existsSync(join(vault, ".agents", "skills", "soul")), false, "the skill directory is gone");
  assert.equal(await readFile(join(vault, ".agents", "skills", "notes.md"), "utf8"), "mine\n", "other files under .agents stay");
  assert.deepEqual(git(vault, "show", "--name-status", "--format=", "HEAD").split("\n"), files.map((file) => `D\t${file}`));
  assert.equal(git(vault, "show", "HEAD~1:.agents/skills/soul/SKILL.md"), ".agents/skills/soul/SKILL.md");
  assert.equal(git(vault, "status", "--porcelain"), "?? .agents/");
  assert.equal((await project(vault)).commit, undefined, "projecting again changes nothing");
});

test("an uncommitted edit of the former Soul skill stops the projection before it deletes anything", async () => {
  const vault = join(await tempDir(), "vault");
  await project(vault);
  const files = await formerSkill(vault);
  await writeFile(join(vault, ".agents", "skills", "soul", "voices", "self.md"), "my voice\n");
  const projection = await projectVault(REPO, vault);

  assert.ok(!projection.ok);
  assert.match(projection.error, /\.agents\/skills\/soul\/voices\/self\.md/);
  assert.ok(files.every((file) => existsSync(join(vault, file))), "no file was deleted");
  assert.equal(await readFile(join(vault, ".agents", "skills", "soul", "voices", "self.md"), "utf8"), "my voice\n");
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
  await writeFile(join(vault, "README.md"), "x\n");
  git(vault, "commit", "-qm", "edit README.md", "--", "README.md");
  await project(vault);

  assert.equal(await readFile(join(vault, "identity", "user", "identity.md"), "utf8"), "# Me\n");
  assert.equal(existsSync(join(vault, "journeys", "career")), false, "a deleted starter journey is not copied again");
  assert.deepEqual(git(vault, "show", "--name-only", "--format=", "HEAD").split("\n"), ["README.md"], "the projection commits only its own files");
  assert.equal(git(vault, "status", "--porcelain"), "A  notes.md\n?? journeys/health/journal/".trim());
});

test("an existing directory without Git keeps its files, and starter files never replace them", async () => {
  const vault = join(await tempDir(), "vault");
  await mkdir(join(vault, "journeys", "health"), { recursive: true });
  await writeFile(join(vault, "journeys", "health", "JOURNEY.md"), "# Already here\n");
  const projection = await project(vault);

  assert.equal(git(vault, "rev-parse", "--show-toplevel"), vault);
  assert.equal(outcome(projection, "journeys/health/JOURNEY.md"), undefined, "an existing file is not part of the projection");
  assert.equal(await readFile(join(vault, "journeys", "health", "JOURNEY.md"), "utf8"), "# Already here\n");
  assert.equal(outcome(projection, "identity/ego/constraints.md"), "created");
});

test("a vault with its own identity, such as a migrated one, gets no starter content", async () => {
  const vault = join(await tempDir(), "vault");
  await mkdir(join(vault, "identity", "user"), { recursive: true });
  await writeFile(join(vault, "identity", "user", "identity.md"), "# Me\n");
  const projection = await project(vault);

  assert.equal(outcome(projection, "README.md"), "created", "Mirror's own files are projected");
  assert.equal(outcome(projection, "AGENTS.md"), "created", "a vault that Mirror has not projected before gets the starter map");
  assert.deepEqual(projection.files.filter((file) => /^(identity|journeys)\//.test(file.path)), [], "no starter file is copied");
  assert.equal(existsSync(join(vault, "journeys")), false);
  assert.equal(await readFile(join(vault, "identity", "user", "identity.md"), "utf8"), "# Me\n");
});

test("an existing directory whose Mirror files already match gets them committed", async () => {
  const vault = join(await tempDir(), "vault");
  await mkdir(vault);
  await writeFile(join(vault, "README.md"), await readFile(join(REPO, "vault", "README.md")));
  const projection = await project(vault);

  assert.equal(outcome(projection, "README.md"), "kept");
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

  await writeFile(join(vault, "README.md"), "uncommitted\n");
  const refused = spawnSync(command, [vault], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Uncommitted changes in files that Mirror owns: README\.md/);

  assert.equal(spawnSync(command, [], { encoding: "utf8" }).status, 2);
});
