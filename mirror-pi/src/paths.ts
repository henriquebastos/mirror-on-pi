// Keep file tools inside the content vault.
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "./result.ts";

// Pi's file tools rewrite a path before use: Unicode spaces become spaces, one leading "@" is dropped,
// "~" expands to the home directory, and "file://" URLs become paths. Check the path Pi will open.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export function normalizeToolPath(requested: string): Result<string, string> {
  const spaced = requested.replace(UNICODE_SPACES, " ");
  const path = spaced.startsWith("@") ? spaced.slice(1) : spaced;
  if (path.startsWith("~") || /^file:/i.test(path)) return err(`Path outside the content vault: ${requested}`);
  return ok(path);
}

export async function resolveInside(root: string, cwd: string, requested: string): Promise<Result<string, string>> {
  const normalized = normalizeToolPath(requested);
  if (!normalized.ok) return normalized;
  const candidate = resolve(cwd, normalized.value === "" ? "." : normalized.value);
  const realRoot = await realpath(root);
  const realCandidate = await realExisting(candidate);
  return isWithin(realRoot, realCandidate) ? ok(realCandidate) : err(`Path outside the content vault: ${requested}`);
}

// Pi's read tool tries look-alike names (NFD, curly quotes, AM/PM spaces) when a path does not exist.
// Requiring the exact path to exist keeps a look-alike symbolic link from leading out of the vault.
export async function existsExactly(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
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
