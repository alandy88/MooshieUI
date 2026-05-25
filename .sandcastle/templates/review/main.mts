import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { parseDiffLines } from "../../lib/parse-diff-lines.mts";
import { ReviewOutput } from "../../lib/review-output.mts";
import { fetchPrComments } from "../../lib/pr-comments.mts";
import { required } from "../../lib/required.mts";
import { gitSync, gitSyncSafe } from "../../lib/shell.mts";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const GH_REPO = required("GH_REPO");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

const prComments = fetchPrComments(PR_NUMBER, GH_REPO);

const result = await sandcastle.run({
  name: `review-pr-${PR_NUMBER}`,
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
    schema: ReviewOutput,
  }),
});

const verdict = result.commits.length > 0 ? "improved" : "clean";
const headSha = gitSync(["rev-parse", "HEAD"]).trim();
const diffLines = parseDiffLines(gitSyncSafe(["diff", "main...HEAD"]));

const validInlineComments = result.output.inlineComments.filter((c) => {
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
const validReplies = result.output.replies.filter((r) => {
  if (!validReplyIds.has(r.commentId)) {
    console.warn(`Dropping reply for commentId=${r.commentId} — not in fetched threads.`);
    return false;
  }
  return true;
});

const reviewPayload = {
  commit_id: headSha,
  event: "COMMENT" as const,
  body: result.output.summary,
  comments: validInlineComments.map((c) => ({
    path: c.path,
    line: c.line,
    side: "RIGHT" as const,
    body: c.body,
  })),
};

fs.writeFileSync(path.join(OUTPUT_DIR, "review_payload.json"), JSON.stringify(reviewPayload, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, "replies.json"), JSON.stringify(validReplies, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.md"), result.output.summary);
fs.writeFileSync(path.join(OUTPUT_DIR, "verdict.txt"), verdict);

console.log(`\nReview complete.`);
console.log(`  verdict: ${verdict}`);
console.log(`  commits: ${result.commits.length}`);
console.log(`  inline comments: ${validInlineComments.length}`);
console.log(`  replies: ${validReplies.length}`);
