// Build a disposable vault with the same projection that builds every other vault.
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectVault } from "../../src/projection.ts";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));

// Git in eval vaults uses no personal or system configuration, such as signing or hooks, and a fixed author.
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Mirror eval",
  GIT_AUTHOR_EMAIL: "eval@mirror.invalid",
  GIT_COMMITTER_NAME: "Mirror eval",
  GIT_COMMITTER_EMAIL: "eval@mirror.invalid",
});

export type EvalVault = {
  readonly root: string;
  readonly journey: (slug: string) => string;
};

export async function tempDir(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "mirror-eval-")));
}

export async function tempVault(): Promise<EvalVault> {
  const projection = await projectVault(REPO, join(await tempDir(), "vault"));
  if (!projection.ok) throw new Error(projection.error);
  const root = projection.value.vault;
  return { root, journey: (slug) => join(root, "journeys", slug) };
}
