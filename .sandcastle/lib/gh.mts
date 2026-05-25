import { spawn } from "node:child_process";

export function gh(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    proc.on("error", (error) => {
      resolve({ stdout: "", stderr: error.message, exitCode: 1 });
    });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

export async function ghJson(args: string[]): Promise<string> {
  const result = await gh(args);
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}`);
  }
  return result.stdout;
}
