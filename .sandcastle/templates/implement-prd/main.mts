import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { required } from "../../lib/required.mts";
import { gitSync } from "../../lib/shell.mts";

const PRD_NUMBER = required("PRD_NUMBER");
const PRD_TITLE = required("PRD_TITLE");
const SUB_ISSUE_NUMBER = required("SUB_ISSUE_NUMBER");
const SUB_ISSUE_TITLE = required("SUB_ISSUE_TITLE");
const BRANCH = required("BRANCH");
required("GH_REPO");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const result = await sandcastle.run({
  name: `implement-prd-#${PRD_NUMBER}-sub-#${SUB_ISSUE_NUMBER}`,
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
    SUB_ISSUE_NUMBER,
    SUB_ISSUE_TITLE,
    BRANCH,
  },
});

const commitsAhead = Number(
  gitSync(["rev-list", "--count", "main..HEAD"]).trim()
);

fs.writeFileSync(
  path.join(OUTPUT_DIR, "has_commits.txt"),
  commitsAhead > 0 ? "true" : "false"
);

console.log(`\nImplementation finished for sub-issue #${SUB_ISSUE_NUMBER}.`);
console.log(`  commits this run: ${result.commits.length}`);
console.log(`  commits ahead of main: ${commitsAhead}`);
