import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { required } from "../../lib/required.mts";

const PRD_NUMBER = required("PRD_NUMBER");
const PRD_TITLE = required("PRD_TITLE");
required("GH_REPO");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const PromptOutput = z.object({
  prTitle: z.string().min(1).max(256),
  prDescription: z.string().min(1),
});

const result = await sandcastle.run({
  name: `write-prd-pr-#${PRD_NUMBER}`,
  agent: sandcastle.claudeCode("claude-sonnet-4-6", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PRD_NUMBER,
    PRD_TITLE,
  },
  output: sandcastle.Output.object({
    tag: "output",
    schema: PromptOutput,
  }),
});

fs.writeFileSync(path.join(OUTPUT_DIR, "pr_title.txt"), result.output.prTitle);
fs.writeFileSync(path.join(OUTPUT_DIR, "pr_description.txt"), result.output.prDescription);

console.log(`\nWrote PR metadata to ${OUTPUT_DIR}`);
console.log(`  title: ${result.output.prTitle}`);
