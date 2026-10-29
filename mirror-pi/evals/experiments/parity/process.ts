// Child processes of the parity harness. `env`, when given, is the complete environment: nothing of this shell leaks in.
import { spawn } from "node:child_process";

export type ExecOptions = { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> };

export async function exec(command: string, args: readonly string[], options: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}: ${Buffer.concat(err).toString("utf8")}${stdout}`.slice(0, 4000)));
    });
  });
}
