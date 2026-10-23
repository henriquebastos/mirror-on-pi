// Build a disposable vault from the synthetic starter content.
// Each journey marker points at the eval's own AI Memory workspace.
import { cp, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKER } from "../../src/journey.ts";

export const STARTER_CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));

export type EvalVault = {
  readonly root: string;
  readonly journey: (slug: string) => string;
};

export async function tempVault(workspace: string): Promise<EvalVault> {
  const root = join(await realpath(await mkdtemp(join(tmpdir(), "mirror-eval-"))), "vault");
  await cp(STARTER_CONTENT, root, { recursive: true, filter: (source) => !/\/journeys\/[^/]+\/(journal|corrections)(\/|$)/.test(source) });
  for (const slug of await readdir(join(root, "journeys"))) {
    const marker = join(root, "journeys", slug, MARKER);
    const text = await readFile(marker, "utf8");
    await writeFile(marker, text.replace(/^workspace = ".*"$/m, `workspace = "${workspace}"`));
  }
  return { root, journey: (slug) => join(root, "journeys", slug) };
}
