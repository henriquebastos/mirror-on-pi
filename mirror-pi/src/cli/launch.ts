// Build the Pi command line for one Mirror session. Pure functions, so tests can check the isolation flags.
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { MirrorProfile } from "../config.ts";
import { ALLOWED_TOOLS } from "../extension.ts";

export type StartOptions = {
  readonly journey: string;
  readonly persona: string | undefined;
  readonly organization: boolean;
  readonly continueLatest: boolean;
  readonly resume: boolean;
  readonly passthrough: readonly string[];
};

export function parseStart(args: readonly string[]): StartOptions | undefined {
  const separator = args.indexOf("--");
  const own = separator === -1 ? args : args.slice(0, separator);
  const { values, positionals } = parseArgs({
    args: [...own],
    allowPositionals: true,
    options: {
      persona: { type: "string" },
      org: { type: "boolean", default: false },
      continue: { type: "boolean", short: "c", default: false },
      resume: { type: "boolean", short: "r", default: false },
    },
  });
  const journey = positionals[0];
  if (journey === undefined || positionals.length > 1) return undefined;
  return {
    journey,
    persona: values.persona,
    organization: values.org,
    continueLatest: values.continue,
    resume: values.resume,
    passthrough: separator === -1 ? [] : args.slice(separator + 1),
  };
}

export function piArguments(profile: MirrorProfile, journey: string, options: StartOptions, extension: string): string[] {
  const args = [
    "--no-extensions", "--extension", extension,
    "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--tools", ALLOWED_TOOLS.join(","),
    "--session-dir", join(profile.piAgentDir, "sessions", profile.memory.workspace, journey),
  ];
  if (profile.model !== undefined) args.push("--model", `${profile.model.provider}/${profile.model.id}`);
  if (profile.model?.thinking !== undefined) args.push("--thinking", profile.model.thinking);
  if (options.continueLatest) args.push("--continue");
  if (options.resume) args.push("--resume");
  args.push(...options.passthrough);
  return args;
}
