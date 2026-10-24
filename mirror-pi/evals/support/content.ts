// Build a disposable vault from the synthetic starter content.
import { cp, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STARTER_CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));

export type EvalVault = {
  readonly root: string;
  readonly journey: (slug: string) => string;
};

export async function tempVault(): Promise<EvalVault> {
  const root = join(await realpath(await mkdtemp(join(tmpdir(), "mirror-eval-"))), "vault");
  await cp(STARTER_CONTENT, root, { recursive: true, filter: (source) => !/\/journeys\/[^/]+\/(journal|corrections)(\/|$)/.test(source) });
  return { root, journey: (slug) => join(root, "journeys", slug) };
}
