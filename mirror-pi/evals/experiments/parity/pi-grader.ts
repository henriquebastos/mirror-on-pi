// A grader that runs as `pi -p` instead of a direct model call. Direct Anthropic models need this, because the
// subscription works only through Pi's provider with `pi-cc-patch` loaded. Nothing else loads: no tools, extensions,
// skills, context files, or session, and the process gets an empty home and an agent directory with only the login.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ANTHROPIC_PATCH, linkAuth } from "./arms.ts";
import { PI } from "./pi-rpc.ts";
import { exec } from "./process.ts";

export async function preparePiGrader(root: string): Promise<void> {
  for (const dir of ["agent", "home", "tmp", "cwd"]) await mkdir(join(root, dir), { recursive: true });
  await linkAuth(join(root, "agent"));
}

export async function completeWithPi(root: string, model: string, system: string, prompt: string): Promise<string> {
  const file = join(root, "tmp", `prompt-${String(process.pid)}-${Math.random().toString(36).slice(2)}.md`);
  await writeFile(file, prompt);
  const env = { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), LANG: "en_US.UTF-8", PATH: dirname(process.execPath) + ":/usr/bin:/bin", PI_CODING_AGENT_DIR: join(root, "agent") };
  const args = ["-p", "--no-session", "-nt", "-ne", "-ns", "-nc", "--no-mcp", "--offline", "--thinking", "off", "-e", ANTHROPIC_PATCH, "--model", model, "--system-prompt", system, `@${file}`];
  try {
    return await exec(PI, args, { cwd: join(root, "cwd"), env });
  } finally {
    await rm(file, { force: true });
  }
}
