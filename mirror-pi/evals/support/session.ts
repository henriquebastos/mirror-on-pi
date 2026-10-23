// Run a real Pi SDK session with the Mirror extension and a scripted model.
// The model is fake; Pi, the extension, the vault, and AI Memory are real.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ALLOWED_TOOLS, createMirrorExtension } from "../../src/extension.ts";
import type { MemoryClient } from "../../src/memory-client.ts";

const MODE_PROMPT = fileURLToPath(new URL("../../prompts/mirror-mode.md", import.meta.url));

export type MirrorSessionOptions = {
  readonly contentDir: string;
  readonly workspace: string;
  readonly journey: string;
  readonly client: MemoryClient;
  readonly responses: readonly FauxResponseStep[];
  readonly sessionManager: SessionManager;
  readonly persona?: string;
  readonly now?: () => Date;
};

export type MirrorSession = {
  readonly session: AgentSession;
  readonly close: () => Promise<void>;
};

export async function openMirrorSession(options: MirrorSessionOptions): Promise<MirrorSession> {
  const agentDir = await mkdtemp(join(tmpdir(), "mirror-eval-agent-"));
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const faux = fauxProvider({ provider: "mirror-faux", models: [{ id: "scripted" }] });
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([...options.responses]);
  const loader = new DefaultResourceLoader({
    cwd: options.contentDir,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
    extensionFactories: [
      createMirrorExtension({
        contentDir: options.contentDir,
        workspace: options.workspace,
        journey: options.journey,
        persona: options.persona,
        organization: false,
        modePrompt: await readFile(MODE_PROMPT, "utf8"),
        client: options.client,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: options.contentDir,
    agentDir,
    modelRuntime: runtime,
    model: faux.getModel(),
    thinkingLevel: "off",
    resourceLoader: loader,
    sessionManager: options.sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    tools: [...ALLOWED_TOOLS],
  });
  await session.bindExtensions({});
  return {
    session,
    close: async () => {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    },
  };
}

export function persistentSessions(contentDir: string, sessionDir: string): SessionManager {
  return SessionManager.create(contentDir, sessionDir);
}
