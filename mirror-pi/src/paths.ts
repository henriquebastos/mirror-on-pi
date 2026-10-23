// Keep file tools inside the content vault.
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "./result.ts";

export async function resolveInside(root: string, cwd: string, requested: string): Promise<Result<string, string>> {
  // Pi expands "~" to the home directory, which is never inside the vault.
  if (requested.startsWith("~")) return err(`Path outside the content vault: ${requested}`);
  const candidate = resolve(cwd, requested === "" ? "." : requested);
  const realRoot = await realpath(root);
  const realCandidate = await realExisting(candidate);
  return isWithin(realRoot, realCandidate) ? ok(realCandidate) : err(`Path outside the content vault: ${requested}`);
}

export function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

// Resolve symbolic links in the longest existing prefix, so a link cannot leave the vault.
async function realExisting(path: string): Promise<string> {
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    try {
      const real = await realpath(current);
      return suffix.length === 0 ? real : resolve(real, ...suffix.reverse());
    } catch (error) {
      const parent = resolve(current, "..");
      if (parent === current || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      suffix.push(relative(parent, current));
      current = parent;
    }
  }
}

// File globs (find patterns, grep file filters) must stay below the search directory.
export function isRelativeGlob(glob: string): boolean {
  if (glob.startsWith("/") || glob.startsWith("~") || glob.startsWith("\\")) return false;
  return !glob.split(/[\\/]/).includes("..");
}
