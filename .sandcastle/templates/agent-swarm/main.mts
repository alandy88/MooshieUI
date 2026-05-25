import { spawn } from "node:child_process";
import { applyHostEnv } from "../../lib/host-env.mjs";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { countCommitsAhead, type GitRunner } from "../../lib/branch-commits.mts";
import {
  buildRunId,
  ensureLogParent,
  installRunLog,
  swarmLogPath,
} from "../../lib/run-logging.mts";
import { withCapWarning } from "../../lib/run-with-cap-warning.mts";
import { createUsageTracker } from "../../lib/usage-log.mts";

applyHostEnv();

const hostGit: GitRunner = (args) =>
  new Promise((resolve) => {
    const proc = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    proc.on("error", (error) => {
      process.stderr.write(`[host-git] spawn error: ${error.message}\n`);
      resolve({ stdout: "", exitCode: 1 });
    });
    proc.on("close", (code) => {
      if (stderr) process.stderr.write(stderr);
      resolve({ stdout, exitCode: code ?? 1 });
    });
  });

function ghJson(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh ${args.join(" ")} exited ${code}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function slugifyIssueTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "issue"
  );
}

const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 4;
const MAX_IDLE_ITERATIONS = 1;
const IMPLEMENTER_MAX_ITERATIONS = 20;

type IssuePlan = {
  number: number;
  title: string;
  branch: string;
};

type ReadyIssue = {
  number: number;
  title: string;
  labels: string[];
};

const sandbox = docker({
  mounts: [
    { hostPath: "~/.codex/auth.json", sandboxPath: "/home/agent/.codex/auth.json", readonly: true },
  ],
});

const hooks = {
  sandbox: {
    onSandboxReady: [
      // Mount preflight — fail fast if the 9p / bind mount didn't survive
      // sandbox boot. Without this, an unwritable workspace pushes the
      // implementer into improvised git-plumbing recovery (see #99). Better
      // to surface as a per-issue rejected promise than silently lose work.
      { command: "test -w /home/agent/workspace && test -r /home/agent/workspace/.git" },
      // Auth preflight — abort the iteration with a readable error if the
      // host's GH_TOKEN didn't propagate. Cheaper than failing later in
      // `gh issue view`.
      { command: "gh auth status" },
      { command: "bun install --frozen-lockfile" },
    ],
  },
};

let idleIterations = 0;
const RUN_ID = buildRunId("swarm");
const LOGS = `./.sandcastle/logs/${RUN_ID}`;
const usage = createUsageTracker(LOGS);
const runWithCapWarning = withCapWarning(sandcastle.run, { usage });
const disposeRunLog = installRunLog(LOGS);

async function fetchReadyIssues(): Promise<ReadyIssue[]> {
  const stdout = await ghJson([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    "ready-for-agent",
    "--json",
    "number,title,labels",
    "--jq",
    "[.[] | {number, title, labels: [.labels[].name]}]",
  ]);
  const parsed = JSON.parse(stdout) as ReadyIssue[];
  return Array.isArray(parsed) ? parsed : [];
}

async function planIssues(iteration: number): Promise<IssuePlan[]> {
  const ready = await fetchReadyIssues();
  if (ready.length === 0) return [];

  // Short-circuit: a single unblocked issue has no dependency graph to compute.
  // Skip the planner LLM entirely and synthesize the plan locally.
  if (ready.length === 1) {
    const issue = ready[0]!;
    console.log(
      `Single ready-for-agent issue (#${issue.number}); skipping planner LLM.`,
    );
    return [
      {
        number: issue.number,
        title: issue.title,
        branch: `sandcastle/issue-${issue.number}-${slugifyIssueTitle(issue.title)}`,
      },
    ];
  }

  const plan = await runWithCapWarning({
    hooks,
    sandbox,
    name: "planner",
    maxIterations: 1,
    agent: sandcastle.claudeCode("claude-sonnet-4-6"),
    promptFile: "./.sandcastle/templates/agent-swarm/plan-prompt.md",
    logging: {
      type: "file",
      path: ensureLogParent(swarmLogPath(LOGS, iteration, { kind: "plan" })),
    },
  });

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error("Planning agent did not produce a <plan> tag.\n\n" + plan.stdout);
  }

  const parsed = JSON.parse(planMatch[1]!) as { issues?: IssuePlan[] };
  return Array.isArray(parsed.issues) ? parsed.issues : [];
}

try {
  console.log(`logs: ${LOGS}`);

  // Semaphore — caps concurrent sandboxes to avoid exhausting Docker resources
  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    running < MAX_PARALLEL
      ? (running++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(resolve));
  const release = () => {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  };

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

    const issues = await planIssues(iteration);

    if (issues.length === 0) {
      console.log("No unblocked issues to work on. Exiting.");
      break;
    }

    console.log(
      `Planning complete. ${issues.length} issue(s) to work in parallel:`,
    );
    for (const issue of issues) {
      console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`);
    }

    // Refresh origin/main so countCommitsAhead compares against the latest base.
    await hostGit(["fetch", "origin", "main"]);

    const settled = await Promise.allSettled(
      issues.map(async (issue) => {
        await acquire();
        try {
          // Skip implementer when the branch already has commits ahead of
          // origin/main from a prior swarm iteration — re-running the
          // implementer would only re-explore the repo (~25k+ tokens of
          // redundant `gh issue view` / `find` / `wc -l` calls per log).
          const aheadBeforeImplement = await countCommitsAhead(
            issue.branch,
            "origin/main",
            hostGit,
          );
          const skipImplement = aheadBeforeImplement > 0;
          if (skipImplement) {
            console.log(
              `  #${issue.number}: branch already ${aheadBeforeImplement} commit(s) ahead; skipping implementer.`,
            );
          }

          const issueSandbox = await sandcastle.createSandbox({
            branch: issue.branch,
            sandbox,
            hooks,
          });
          const runIssueSandbox = withCapWarning(issueSandbox.run.bind(issueSandbox), { usage });
          try {
            let implementCommits: { sha: string }[] = [];
            if (!skipImplement) {
              const implement = await runIssueSandbox({
                name: `implementer #${issue.number}`,
                maxIterations: IMPLEMENTER_MAX_ITERATIONS,
                agent: sandcastle.claudeCode("claude-sonnet-4-6"),
                promptFile: "./.sandcastle/templates/agent-swarm/implement-prompt.md",
                promptArgs: {
                  ISSUE_NUMBER: String(issue.number),
                  ISSUE_TITLE: issue.title,
                  BRANCH: issue.branch,
                },
                logging: {
                  type: "file",
                  path: ensureLogParent(
                    swarmLogPath(LOGS, iteration, {
                      kind: "issue",
                      number: issue.number,
                      slug: issue.title,
                      agent: "implement",
                    }),
                  ),
                },
              });
              implementCommits = implement.commits;

              // Ask the branch — not the sandbox commit count — whether work landed.
              // An implementer's git-plumbing recovery path commits to the parent
              // worktree without sandcastle observing it; the branch is still the
              // source of truth. See issue #99.
              const aheadAfterImplement = await countCommitsAhead(
                issue.branch,
                "origin/main",
                hostGit,
              );
              if (aheadAfterImplement === 0) {
                return { ...implement, branchCommitsAhead: 0 };
              }
            }

            const review = await runIssueSandbox({
              name: `reviewer #${issue.number}`,
              maxIterations: 1,
              agent: sandcastle.claudeCode("claude-sonnet-4-6"),
              promptFile: "./.sandcastle/templates/agent-swarm/review-prompt.md",
              promptArgs: {
                ISSUE_NUMBER: String(issue.number),
                ISSUE_TITLE: issue.title,
                BRANCH: issue.branch,
              },
              logging: {
                type: "file",
                path: ensureLogParent(
                  swarmLogPath(LOGS, iteration, {
                    kind: "issue",
                    number: issue.number,
                    slug: issue.title,
                    agent: "review",
                  }),
                ),
              },
            });

            // The reviewer may have pushed fixups; re-count from the branch.
            const aheadAfterReview = await countCommitsAhead(
              issue.branch,
              "origin/main",
              hostGit,
            );
            return {
              ...review,
              commits: [...implementCommits, ...review.commits],
              branchCommitsAhead: aheadAfterReview,
            };
          } finally {
            await issueSandbox.close();
          }
        } finally {
          release();
        }
      }),
    );

    const failures: { issue: IssuePlan; reason: unknown }[] = [];
    const completedIssues: IssuePlan[] = [];
    const dropped: IssuePlan[] = [];
    settled.forEach((outcome, i) => {
      const issue = issues[i]!;
      if (outcome.status === "rejected") {
        failures.push({ issue, reason: outcome.reason });
      } else if ((outcome.value.branchCommitsAhead ?? 0) > 0) {
        completedIssues.push(issue);
      } else {
        dropped.push(issue);
      }
    });

    const admitFmt = (list: IssuePlan[]) =>
      list.length ? list.map((i) => `#${i.number}`).join(", ") : "(none)";
    console.log(
      `admitted to merge: [${admitFmt(completedIssues)}]; dropped (no commits): [${admitFmt(dropped)}]; dropped (errored): [${admitFmt(failures.map((f) => f.issue))}]`,
    );

    for (const failure of failures) {
      console.error(`  ✗ ${failure.issue.number} (${failure.issue.branch}) failed: ${failure.reason}`);
    }

    const completedBranches = completedIssues.map((i) => i.branch);

    console.log(
      `\nExecution complete. ${completedBranches.length} branch(es) with commits ahead of origin/main:`,
    );
    for (const branch of completedBranches) {
      console.log(`  ${branch}`);
    }

    if (completedBranches.length === 0) {
      idleIterations += 1;
      console.log(
        `No commits produced. Idle iteration ${idleIterations}/${MAX_IDLE_ITERATIONS}.`,
      );
      if (idleIterations >= MAX_IDLE_ITERATIONS) {
        console.log("Idle threshold reached. Exiting early.");
        break;
      }
      continue;
    }

    idleIterations = 0;

    // Phase 3: Merge — resolves conflicts, runs tests, closes issues
    const mergeLogPath = ensureLogParent(
      swarmLogPath(LOGS, iteration, { kind: "merge" }),
    );
    await runWithCapWarning({
      hooks,
      sandbox,
      name: "merger",
      maxIterations: 10,
      agent: sandcastle.claudeCode("claude-sonnet-4-6"),
      promptFile: "./.sandcastle/templates/agent-swarm/merge-prompt.md",
      promptArgs: {
        ISSUE_BRANCHES: completedIssues
          .map((i) => `- #${i.number} | ${i.title} | ${i.branch}`)
          .join("\n"),
      },
      logging: { type: "file", path: mergeLogPath },
    });

    console.log("\nBranches merged.");
  }

  console.log("\nAll done.");
} finally {
  try {
    await usage.finalize();
  } catch (error) {
    process.stderr.write(
      `[usage] finalize failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  await disposeRunLog();
}
