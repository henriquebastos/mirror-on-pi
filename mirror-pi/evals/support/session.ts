// Run a real Pi SDK session at the vault root with Mirror's extensions, as a manual session would.
// Pi loads the vault's AGENTS.md files itself; the extensions add Mirror's instructions, identity, and journeys. Only the model and the clock are chosen by the eval.
import { mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider, type Api, type FauxResponseStep, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { createCorrectionsExtension } from "../../extensions/corrections.ts";
import { createIdentityExtension } from "../../extensions/identity.ts";
import { createInstructionsExtension } from "../../extensions/instructions.ts";
import { createJournalExtension } from "../../extensions/journal.ts";
import { createJourneysExtension } from "../../extensions/journeys.ts";
import { JOURNEY_ENTRY } from "../../src/journey.ts";
import { assertNever } from "../../src/result.ts";
import { REPO } from "./content.ts";
import { ANTHROPIC_PATCH, EVAL_AUTH, needsAnthropicPatch } from "./credentials.ts";

// The settings that scripts/mirror.sh copies into a new Mirror agent directory, with the model.
export const MIRROR_SETTINGS = fileURLToPath(new URL("../../../agent/settings.json", import.meta.url));

// One Pi agent directory for every session of this eval process, as one personal agent directory serves every journey.
// Pi and its bash tool read it from the environment, so `SessionManager.create(cwd)` and the vault's session
// search command both use `<agent dir>/sessions/--<journey path>--/`.
export const EVAL_AGENT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "mirror-eval-agent-")));
process.env.PI_CODING_AGENT_DIR = EVAL_AGENT_DIR;

type ThinkingLevel = NonNullable<NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"]>;

// A scripted model for wiring evals, or a real model through the credentials of credentials.ts.
export type EvalModel =
  | { readonly kind: "scripted"; readonly responses: readonly FauxResponseStep[] }
  | { readonly kind: "real"; readonly provider: string; readonly id: string; readonly thinking: ThinkingLevel };

export type MirrorSessionOptions = {
  readonly cwd: string;
  readonly model: EvalModel;
  readonly sessionManager: SessionManager;
  readonly now?: () => Date;
};

export type MirrorSession = {
  readonly session: AgentSession;
  readonly close: () => Promise<void>;
};

export async function openMirrorSession(options: MirrorSessionOptions): Promise<MirrorSession> {
  const agentDir = EVAL_AGENT_DIR;
  const { runtime, model, thinkingLevel } = await modelFor(options.model, agentDir);
  const now = options.now ?? ((): Date => new Date());
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    noExtensions: true,
    // An Anthropic subscription needs its request patch, as in the parity harness.
    additionalExtensionPaths: options.model.kind === "real" && needsAnthropicPatch(options.model.provider) ? [ANTHROPIC_PATCH] : [],
    // Pi discovers skills as in a manual session: the Mirror package that the vault settings declare, and the vault's `.agents/skills`.
    // Personal skills under the home directory are left out, but not the package, which can live there too.
    skillsOverride: (base) => ({ skills: base.skills.filter((skill) => skill.filePath.startsWith(REPO) || !skill.filePath.startsWith(homedir() + sep)), diagnostics: base.diagnostics }),
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [createInstructionsExtension(), createJourneysExtension(), createJournalExtension(now), createCorrectionsExtension(now), createIdentityExtension(now)],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel,
    resourceLoader: loader,
    sessionManager: options.sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  });
  // No UI, as in `pi -p`: Mirror's tools need none.
  await session.bindExtensions({});
  return {
    session,
    close: async () => {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    },
  };
}

// Start a session that has already entered a journey, as after mirror_enter_journey.
export function inJourney(sessionManager: SessionManager, slug: string): SessionManager {
  sessionManager.appendCustomEntry(JOURNEY_ENTRY, { slug });
  return sessionManager;
}

async function modelFor(choice: EvalModel, agentDir: string): Promise<{ runtime: ModelRuntime; model: Model<Api>; thinkingLevel: ThinkingLevel }> {
  switch (choice.kind) {
    case "scripted": {
      const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
      const faux = fauxProvider({ provider: "mirror-faux", models: [{ id: "scripted" }] });
      runtime.registerNativeProvider(faux.provider);
      faux.setResponses([...choice.responses]);
      return { runtime, model: faux.getModel(), thinkingLevel: "off" };
    }
    case "real": {
      // The named auth file directly, so Pi's own lock serializes token refreshes; without one, keys from the environment.
      const authPath = EVAL_AUTH ?? join(agentDir, "auth.json");
      const runtime = await ModelRuntime.create({ authPath, modelsPath: join(agentDir, "models.json") });
      const model = runtime.getModel(choice.provider, choice.id);
      if (model === undefined) throw new Error(`Unknown model ${choice.provider}/${choice.id}`);
      return { runtime, model, thinkingLevel: choice.thinking };
    }
    default:
      return assertNever(choice);
  }
}

