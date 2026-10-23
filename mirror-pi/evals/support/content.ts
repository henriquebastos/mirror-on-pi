// Build a disposable content vault from the synthetic starter content.
import { cp, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STARTER_CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));

export async function tempContent(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mirror-eval-")));
  const contentDir = join(root, "content");
  await cp(STARTER_CONTENT, contentDir, { recursive: true });
  return contentDir;
}
