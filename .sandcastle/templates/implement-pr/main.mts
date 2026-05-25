import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { parseDiffLines } from "../../lib/parse-diff-lines.mts";
import { ImplementPrOutput } from "../../lib/implement-pr-output.mts";
import { fetchPrComments } from "../../lib/pr-comments.mts";
import { required, fail } from "../../lib/required.mts";
import { gitSync, gitSyncSafe } from "../../lib/shell.mts";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const GH_REPO = required("GH_REPO");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const prComments = fetchPrComments(PR_NUMBER, GH_REPO);

const result = await sandcastle.run({
  name: `implement-pr-${PR_NUMBER}`,
  agent: sandcastle.claudeCode("claude-sonnet-4-6", {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  }),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PR_NUMBER,
    BRANCH,
    ISSUE_NUMBER: prComments.issueNumber || "(none)",
    ISSUE_TITLE: prComments.issueTitle || "(no linked issue)",
    PR_COMMENTS_JSON: JSON.stringify(prComments, null, 2),
  },
  output: sandcastle.Output.object({
    tag: "output",
    schema: ImplementPrOutput,
  }),
});

const commitsThisRun = result.commits.length;
const replyCount =
  result.output.threadReplies.length +
  result.output.newInlineComments.length +
  result.output.topLevelComments.length;

if (commitsThisRun === 0 && replyCount === 0) {
  fail("Agent produced no commits and no replies — nothing to do for the unresolved feedback.", OUTPUT_DIR);
}

const headSha = gitSync(["rev-parse", "HEAD"]).trim();
const diffLines = parseDiffLines(gitSyncSafe(["diff", "main...HEAD"]));
const validInlineComments = result.output.newInlineComments.filter((c) => {
  const fileLines = diffLines.get(c.path);
  if (!fileLines) {
    console.warn(`Dropping inline comment for ${c.path}:${c.line} — file not in diff.`);
    return false;
  }
  if (!fileLines.has(c.line)) {
    console.warn(`Dropping inline comment for ${c.path}:${c.line} — line not in diff hunks.`);
    return false;
  }
  return true;
});

const validReplyIds = new Set(prComments.review_threads.map((c) => c.commentId));
const validThreadReplies = result.output.threadReplies.filter((r) => {
  if (!validReplyIds.has(r.commentId)) {
    console.warn(`Dropping reply for commentId=${r.commentId} — not in fetched threads.`);
    return false;
  }
  return true;
});

fs.writeFileSync(
  path.join(OUTPUT_DIR, "implement_thread_replies.json"),
  JSON.stringify(validThreadReplies, null, 2)
);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "implement_new_inline_comments.json"),
  JSON.stringify({
    commit_id: headSha,
    comments: validInlineComments.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
    })),
  }, null, 2)
);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "implement_top_level_comments.json"),
  JSON.stringify(result.output.topLevelComments, null, 2)
);
fs.writeFileSync(
  path.join(OUTPUT_DIR, "has_commits.txt"),
  commitsThisRun > 0 ? "true" : "false"
);

console.log(`\nImplement-PR complete.`);
console.log(`  commits this run: ${commitsThisRun}`);
console.log(`  thread replies: ${validThreadReplies.length}`);
console.log(`  new inline comments: ${validInlineComments.length}`);
console.log(`  top-level comments: ${result.output.topLevelComments.length}`);
