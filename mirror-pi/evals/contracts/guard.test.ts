import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mirror from "../../extension/index.ts";
import { toolBlockReason } from "../../src/extension.ts";
import { tempContent } from "../support/content.ts";

test("tools outside the Mirror list are blocked", async () => {
  const content = await tempContent();
  for (const tool of ["bash", "write", "edit", "web_fetch"]) {
    assert.match(await toolBlockReason(tool, { path: "journeys/health/journey.md", command: "true" }, content, content) ?? "", /cannot use/, tool);
  }
  assert.equal(await toolBlockReason("mirror_recall", { query: "sleep" }, content, content), undefined);
});

test("Pi's path rewrites (@ prefix, ~, file:// URLs) cannot reach files outside the vault", async () => {
  const content = await tempContent();
  for (const tool of ["read", "grep", "find", "ls"]) {
    for (const path of ["@/etc/hosts", "@~/.ssh/id_ed25519", "@../config/dev.json", "file:///etc/hosts", "@file:///etc/hosts"]) {
      assert.ok(await toolBlockReason(tool, { path, pattern: "x" }, content, content) !== undefined, `${tool} ${path}`);
    }
  }
  assert.equal(await toolBlockReason("read", { path: "@journeys/health/journey.md" }, content, content), undefined);
  assert.equal(await toolBlockReason("ls", { path: "journeys" }, content, content), undefined);
});

test("reads need the exact file, so a look-alike name cannot follow a link out of the vault", async () => {
  const content = await tempContent();
  await mkdir(join(content, "journeys/health/files"), { recursive: true });
  await symlink("/etc", join(content, "journeys/health/files/it\u2019s"));
  assert.match(await toolBlockReason("read", { path: "journeys/health/files/it's/hosts" }, content, content) ?? "", /not found/);
  assert.match(await toolBlockReason("read", { path: "journeys/health/files/it\u2019s/hosts" }, content, content) ?? "", /outside/);
});

type Handler = (event: unknown, ctx: unknown) => unknown;

// failFirst makes the first registration throw, as when the factory fails before any Mirror handler exists.
function fakePi(failFirst: boolean): { readonly pi: ExtensionAPI; readonly handlers: Map<string, Handler[]> } {
  const handlers = new Map<string, Handler[]>();
  let failing = failFirst;
  const api = {
    on: (event: string, handler: Handler): void => {
      if (failing) {
        failing = false;
        throw new Error("registration failed");
      }
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool: (): void => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the factory only calls on() and registerTool() here
  return { pi: api as unknown as ExtensionAPI, handlers };
}

async function profile(memory: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mirror-profile-"));
  const path = join(dir, "profile.json");
  await writeFile(path, JSON.stringify({ contentDir: await tempContent(), piAgentDir: join(dir, "pi"), memory: { url: "http://127.0.0.1:1", workspace: "mirror-test", ...memory } }));
  return path;
}

async function assertBlocked(handlers: Map<string, Handler[]>): Promise<void> {
  const tools = await Promise.all((handlers.get("tool_call") ?? []).map((handler) => handler({ toolName: "read", input: { path: "/etc/hosts" } }, { cwd: "/" })));
  assert.ok(tools.some((result) => JSON.stringify(result).includes('"block":true')), "tool calls are blocked");
  const inputs = (handlers.get("input") ?? []).map((handler) => handler({}, { hasUI: false }));
  assert.ok(inputs.some((result) => JSON.stringify(result) === '{"action":"handled"}'), "prompts are blocked");
}

test("the extension blocks the session instead of running unguarded when it cannot start", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const previous = { profile: process.env.MIRROR_PROFILE, journey: process.env.MIRROR_JOURNEY, token: process.env.MIRROR_TEST_TOKEN };
  t.after(() => {
    for (const [key, value] of [["MIRROR_PROFILE", previous.profile], ["MIRROR_JOURNEY", previous.journey], ["MIRROR_TEST_TOKEN", previous.token]] as const) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });
  process.env.MIRROR_JOURNEY = "health";

  process.env.MIRROR_PROFILE = await profile({ tokenFile: "missing.env" });
  const missingToken = fakePi(false);
  await mirror(missingToken.pi);
  await assertBlocked(missingToken.handlers);

  process.env.MIRROR_PROFILE = await profile({ tokenEnv: "MIRROR_TEST_TOKEN" });
  process.env.MIRROR_TEST_TOKEN = "t";
  const throwing = fakePi(true);
  await mirror(throwing.pi);
  await assertBlocked(throwing.handlers);
});
