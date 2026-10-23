// Start the bridge from the development profile and dev/ai-memory/.env.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, parseJson, stringField } from "../../mirror-pi/src/json.ts";
import { startBridge } from "./server.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function main(): Promise<number> {
  const env = await readFile(join(ROOT, "dev/ai-memory/.env"), "utf8");
  const token = /^MIRROR_BRIDGE_TOKEN=(\S+)$/m.exec(env)?.[1];
  if (token === undefined) {
    console.error("MIRROR_BRIDGE_TOKEN is missing from dev/ai-memory/.env. Run scripts/ai-memory.sh up --llm.");
    return 1;
  }
  const settings = consolidationSettings(parseJson(await readFile(join(ROOT, "config/dev.json"), "utf8")));
  if (settings === undefined) {
    console.error("config/dev.json needs consolidation.provider, consolidation.id, and consolidation.bridgePort");
    return 1;
  }
  const { provider, modelId, port } = settings;
  const authPath = join(process.env.MIRROR_PERSONAL_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json");
  const bridge = await startBridge({ port, token, provider, modelId, authPath });
  console.log(`Pi model bridge for ${provider}/${modelId} listening on 127.0.0.1:${String(bridge.port)}`);
  const stop = (): void => {
    void bridge.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0;
}

function consolidationSettings(profile: unknown): { provider: string; modelId: string; port: number } | undefined {
  if (!isRecord(profile) || !isRecord(profile.consolidation)) return undefined;
  const provider = stringField(profile.consolidation, "provider");
  const modelId = stringField(profile.consolidation, "id");
  const port = profile.consolidation.bridgePort;
  if (provider === undefined || modelId === undefined || typeof port !== "number") return undefined;
  return { provider, modelId, port };
}

process.exitCode = await main();
