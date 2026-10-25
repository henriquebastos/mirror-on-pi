// The launcher starts the installed pi at the vault root with Mirror's own agent directory. A fake pi records how it was started.
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { REPO, tempDir } from "../support/content.ts";

const PINNED = /"@earendil-works\/pi-coding-agent": "([^"]+)"/.exec(await readFile(join(REPO, "package.json"), "utf8"))?.[1] ?? "";

const FAKE_PI = `#!/bin/sh
if [ "$1" = --version ]; then echo "$FAKE_PI_VERSION"; exit 0; fi
printf '%s\\n' "$(pwd -P)" "$PI_CODING_AGENT_DIR" "$@" > "$FAKE_PI_OUT"
`;

type Setup = { readonly dir: string; readonly vault: string; readonly agentDir: string; readonly personal: string; readonly out: string };

async function setup(): Promise<Setup> {
  const dir = await realpath(await tempDir());
  const bin = join(dir, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "pi"), FAKE_PI);
  await chmod(join(bin, "pi"), 0o755);
  const vault = join(dir, "vault");
  await mkdir(vault);
  return { dir, vault, agentDir: join(dir, "mirror-agent"), personal: join(dir, "personal"), out: join(dir, "pi-started") };
}

function launch(s: Setup, version: string, env: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync(join(REPO, "scripts", "mirror.sh"), ["-c", "--model", "x"], {
    cwd: s.dir,
    encoding: "utf8",
    env: {
      PATH: `${join(s.dir, "bin")}:${process.env.PATH ?? ""}`,
      HOME: s.dir,
      MIRROR_VAULT: s.vault,
      MIRROR_PI_AGENT_DIR: s.agentDir,
      MIRROR_PERSONAL_PI_AGENT_DIR: s.personal,
      FAKE_PI_VERSION: version,
      FAKE_PI_OUT: s.out,
      ...env,
    },
  });
}

test("the launcher starts the installed pi at the vault root with Mirror's agent directory and the arguments", async () => {
  const s = await setup();
  const result = launch(s, PINNED);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readFile(s.out, "utf8")).trim().split("\n"), [s.vault, s.agentDir, "-c", "--model", "x"]);
  assert.equal(await readFile(join(s.agentDir, "settings.json"), "utf8"), await readFile(join(REPO, "agent", "settings.json"), "utf8"));
  assert.equal(await readlink(join(s.agentDir, "auth.json")), join(s.personal, "auth.json"), "only auth is shared");
});

test("the launcher keeps settings the user changed", async () => {
  const s = await setup();
  await mkdir(s.agentDir);
  await writeFile(join(s.agentDir, "settings.json"), "{\"defaultModel\":\"mine\"}");
  assert.equal(launch(s, PINNED).status, 0);
  assert.equal(await readFile(join(s.agentDir, "settings.json"), "utf8"), "{\"defaultModel\":\"mine\"}");
});

test("the launcher refuses another Pi version and does not start pi", async () => {
  const s = await setup();
  const result = launch(s, "0.0.1");
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`tested on Pi ${PINNED.replaceAll(".", "\\.")}, but the installed pi is 0\\.0\\.1`));
  assert.match(result.stderr, /pnpm add -g @earendil-works\/pi-coding-agent@/);
  assert.equal(existsSync(s.out), false);
});

test("the launcher needs a vault", async () => {
  const s = await setup();
  const result = launch(s, PINNED, { MIRROR_VAULT: "" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set MIRROR_VAULT/);
  assert.equal(existsSync(s.out), false);
});
