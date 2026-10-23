// A journey is a directory with an `.ai-memory.toml` marker that names its AI Memory scope.
// A Pi session belongs to the journey of the nearest marker at or above its working directory.
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { MemoryScope } from "./memory-client.ts";
import { err, ok, type Result } from "./result.ts";
import { validateSlug } from "./slug.ts";

export const MARKER = ".ai-memory.toml";

export type Journey = {
  readonly dir: string;
  readonly slug: string;
  readonly scope: MemoryScope;
};

export async function findJourney(cwd: string): Promise<Result<Journey | undefined, string>> {
  let dir = resolve(cwd);
  for (;;) {
    const text = await readOptional(join(dir, MARKER));
    if (text !== undefined) return parseMarker(dir, text);
    const parent = dirname(dir);
    if (parent === dir) return ok(undefined);
    dir = parent;
  }
}

export function parseMarker(dir: string, text: string): Result<Journey, string> {
  const workspace = tomlString(text, "workspace");
  const project = tomlString(text, "project");
  if (workspace === undefined || project === undefined) return err(`${join(dir, MARKER)} needs workspace and project`);
  for (const value of [workspace, project]) {
    const valid = validateSlug(value);
    if (!valid.ok) return err(`${join(dir, MARKER)}: ${valid.error}`);
  }
  return ok({ dir, slug: basename(dir), scope: { workspace, project } });
}

// The subset of TOML that AI Memory markers use: top-level `key = "value"` lines.
export function tomlString(text: string, key: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line);
    if (match?.[1] === key) return match[2];
  }
  return undefined;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    throw error;
  }
}
