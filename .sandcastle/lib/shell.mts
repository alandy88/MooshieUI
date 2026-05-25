import { execFileSync } from "node:child_process";

export function gitSync(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function gitSyncSafe(args: string[]): string {
  try { return gitSync(args); } catch { return ""; }
}
