import assert from "node:assert/strict";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { isRelativeGlob, resolveInside } from "../../src/paths.ts";
import { tempContent } from "../support/content.ts";

test("vault tools may only reach paths inside the content vault", async () => {
  const content = await tempContent();
  const journeys = join(content, "journeys");
  assert.ok((await resolveInside(content, content, "journeys/health/journey.md")).ok);
  assert.ok((await resolveInside(content, journeys, "health")).ok);
  assert.ok((await resolveInside(content, content, "journeys/health/not-yet.md")).ok);
  assert.ok((await resolveInside(content, content, "")).ok);
  assert.ok(!(await resolveInside(content, content, "../config/dev.json")).ok);
  assert.ok(!(await resolveInside(content, content, "/etc/hosts")).ok);
  assert.ok(!(await resolveInside(content, content, "~/.ssh/id_ed25519")).ok);
  assert.ok(!(await resolveInside(content, journeys, "../../outside")).ok);
});

test("a symbolic link cannot lead out of the vault", async () => {
  const content = await tempContent();
  await mkdir(join(content, "journeys/health/files"), { recursive: true });
  await symlink("/etc", join(content, "journeys/health/files/etc"));
  assert.ok(!(await resolveInside(content, content, "journeys/health/files/etc/hosts")).ok);
  assert.ok(!(await resolveInside(content, content, "journeys/health/files/etc/new-file")).ok);
});

test("file globs cannot climb out of the search directory", () => {
  for (const glob of ["*.md", "**/*.md", "journeys/*/journal/*.md", "a..b.md"]) assert.ok(isRelativeGlob(glob), glob);
  for (const glob of ["../*", "**/../../etc/*", "/etc/*", "~/.ssh/*", "a\\..\\b"]) assert.ok(!isRelativeGlob(glob), glob);
});
