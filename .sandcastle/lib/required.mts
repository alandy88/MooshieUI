import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

export function fail(message: string, outputDir?: string): never {
  console.error(`\nFAILED: ${message}`);
  if (outputDir) {
    writeFileSync(join(outputDir, "failure_reason.txt"), message);
  }
  process.exit(1);
}
