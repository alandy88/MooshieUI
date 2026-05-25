import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { required, fail } from "../../lib/required.mts";
import { gitSync } from "../../lib/shell.mts";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const BASE_REF = required("BASE_REF");
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp";

execFileSync("git", ["fetch", "origin", BASE_REF], { stdio: "inherit" });

const preMergeSha = gitSync(["rev-parse", "HEAD"]).trim();
const baseSha = gitSync(["rev-parse", `origin/${BASE_REF}`]).trim();
const mergeBase = gitSync(["merge-base", "HEAD", `origin/${BASE_REF}`]).trim();

function writeComment(body: string): void {
  fs.writeFileSync(path.join(OUTPUT_DIR, "comment.md"), body);
}
function writePush(): void {
  fs.writeFileSync(path.join(OUTPUT_DIR, "should_push.txt"), "true");
}
function writeNoPush(): void {
  fs.writeFileSync(path.join(OUTPUT_DIR, "should_push.txt"), "false");
}

if (mergeBase === baseSha) {
  writeComment(`\`agent:update-branch\`: branch is already up to date with \`origin/${BASE_REF}\`. No merge needed.`);
  writeNoPush();
  console.log("Already up to date — nothing to do.");
  process.exit(0);
}

function tryMerge(): { status: "clean" } | { status: "conflict"; conflicts: string[] } {
  try {
    execFileSync("git", ["merge", `origin/${BASE_REF}`, "--no-edit"], { stdio: "inherit" });
    return { status: "clean" };
  } catch {
    const conflicts = gitSync(["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (conflicts.length === 0) {
      fail("git merge failed but no conflicts reported — aborting.", OUTPUT_DIR);
    }
    return { status: "conflict", conflicts };
  }
}

const mergeResult = tryMerge();

if (mergeResult.status === "clean") {
  writeComment(`\`agent:update-branch\`: merged \`origin/${BASE_REF}\` (\`${baseSha.slice(0, 7)}\`) into \`${BRANCH}\` cleanly — no conflicts.`);
  writePush();
  console.log("Clean merge — wrapper will push.");
  process.exit(0);
}

console.log(`Merge produced conflicts in ${mergeResult.conflicts.length} file(s) — invoking agent.`);

const PromptOutput = z.object({
  comment: z.string().min(1),
});

const result = await sandcastle.run({
  name: `update-branch-pr-${PR_NUMBER}`,
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
    BASE_REF,
  },
  output: sandcastle.Output.object({
    tag: "output",
    schema: PromptOutput,
  }),
});

const postSha = gitSync(["rev-parse", "HEAD"]).trim();
if (postSha === preMergeSha) {
  fail("Agent produced no commits — branch still at pre-merge HEAD.", OUTPUT_DIR);
}

const unresolved = gitSync(["diff", "--name-only", "--diff-filter=U"]).trim();
if (unresolved) {
  fail(`Agent left unresolved conflicts in:\n${unresolved}`, OUTPUT_DIR);
}

writeComment(result.output.comment);
writePush();
console.log(`Agent resolved conflicts. Wrapper will push ${postSha}.`);
