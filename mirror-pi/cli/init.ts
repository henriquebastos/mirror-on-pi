// mirror-init <vault>: project this repository into a vault. See mirror-pi/src/projection.ts.
import { fileURLToPath } from "node:url";
import { projectVault } from "../src/projection.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

const [target, ...rest] = process.argv.slice(2);
if (target === undefined || rest.length > 0 || target.startsWith("-")) {
  console.error("Usage: mirror-init <vault directory>");
  process.exit(2);
}

const projection = await projectVault(REPO, target);
if (!projection.ok) {
  console.error(`mirror-init: ${projection.error}`);
  process.exit(1);
}
for (const file of projection.value.files) console.log(`${file.outcome.padEnd(7)} ${file.path}`);
console.log(projection.value.commit === undefined ? `Nothing changed in ${projection.value.vault}.` : `Committed ${projection.value.commit.slice(0, 7)} in ${projection.value.vault}.`);
