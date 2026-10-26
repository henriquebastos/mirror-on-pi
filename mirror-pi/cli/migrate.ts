// mirror-migrate <identity home> <history home> <vault>: migrate a Mirror Mind home into a new vault. See mirror-pi/src/migration.ts.
import { readMirrorMind } from "../src/mirror-mind.ts";
import { planMigration, writeMigration } from "../src/migration.ts";

const [identityHome, historyHome, vault, ...rest] = process.argv.slice(2);
if (identityHome === undefined || historyHome === undefined || vault === undefined || rest.length > 0) {
  console.error("Usage: mirror-migrate <Mirror Mind home with the identity> <Mirror Mind home with the conversations> <new vault directory>");
  process.exit(2);
}

const data = await readMirrorMind(identityHome, historyHome);
const written = await writeMigration(vault, (cwd) => planMigration(data, cwd));
if (!written.ok) {
  console.error(`mirror-migrate: ${written.error}`);
  process.exit(1);
}
const { files, skipped } = written.value.plan;
const count = (prefix: string): number => files.filter((file) => file.path.startsWith(prefix)).length;
console.log(`Wrote ${String(files.length)} files in ${written.value.vault}:`);
console.log(`  identity  ${String(count("identity/"))}`);
console.log(`  journeys  ${String(count("journeys/") - files.filter((file) => file.path.includes("/archive/")).length)}`);
console.log(`  sessions  ${String(count(".pi/agent/sessions/"))}`);
console.log(`  archives  ${String(files.filter((file) => file.path.endsWith("archive/memories.md")).length)} (${String(data.memories.length)} memories)`);
for (const line of skipped) console.log(`skipped ${line}`);
console.log("Nothing is committed. Run mirror-init on the vault next, then review and commit.");
