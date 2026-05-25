import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { required, fail } from "../../lib/required.mts";
import { gitSync } from "../../lib/shell.mts";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const result = await sandcastle.run({
  name: `implement-#${ISSUE_NUMBER}`,
  agent: sandcastle.claudeCode("claude-sonnet-4-6", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    ISSUE_NUMBER,
    ISSUE_TITLE,
    BRANCH,
  },
});

const commitsAhead = Number(
  gitSync(["rev-list", "--count", "main..HEAD"]).trim()
);
if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
  fail("Agent finished but no commits were made on the branch.", OUTPUT_DIR);
}

console.log(`\nImplementation produced ${commitsAhead} commit(s) on ${BRANCH}.`);
console.log(`  commits this run: ${result.commits.length}`);
