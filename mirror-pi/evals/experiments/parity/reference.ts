// Mirror Mind, the reference of the parity comparison, at a pinned commit. It is installed on demand, with its own
// dependencies, into a directory outside every repository, and it does not change after that.
import { existsSync } from "node:fs";
import { mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./process.ts";

export const MIRROR_MIND_REPO = "https://github.com/mirror-mind-ai/mirror.git";
export const MIRROR_MIND_COMMIT = "828d484676203f07ccba632d4eb74eaa7d727299";

const ROOT = process.env.PARITY_MIRROR_MIND_ROOT ?? join(tmpdir(), "mirror-parity-reference", MIRROR_MIND_COMMIT.slice(0, 12));
export const MIRROR_MIND = join(ROOT, "mirror");
// A directory with only the `mirror` command, for the PATH of the Mirror Mind arms.
export const MIRROR_MIND_BIN = join(ROOT, "bin");

export async function installMirrorMind(): Promise<void> {
  if (existsSync(join(MIRROR_MIND_BIN, "mirror"))) return;
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(MIRROR_MIND, { recursive: true });
  const git = async (...args: readonly string[]): Promise<string> => exec("git", ["-C", MIRROR_MIND, ...args]);
  await git("init", "-q");
  await git("fetch", "-q", "--depth", "1", MIRROR_MIND_REPO, MIRROR_MIND_COMMIT);
  await git("-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD");
  await rm(join(MIRROR_MIND, ".git"), { recursive: true, force: true });
  await exec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: MIRROR_MIND });
  await mkdir(MIRROR_MIND_BIN, { recursive: true });
  await symlink(join(MIRROR_MIND, "bin", "mirror.js"), join(MIRROR_MIND_BIN, "mirror"));
}
