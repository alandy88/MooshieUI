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
import { withCapWarning, COMPLETE_PROMISE_SENTINEL } from "../../lib/run-with-cap-warning.mts";
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

function gh(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    proc.on("error", (error) => {
      resolve({ stdout: "", stderr: error.message, exitCode: 1 });
    });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

async function ghJson(args: string[]): Promise<string> {
  const result = await gh(args);
  if (result.exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}`);
  }
  return result.stdout;
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
const MAX_PARALLEL = 1;
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

// Discriminated union — one of four mutually exclusive outcomes per issue.
type IssueOutcome =
  | { kind: "opened"; prUrl: string }
  | { kind: "kept"; prNumber: number }
  | { kind: "noop" };

type CategorizedOutcomes = {
  opened: IssuePlan[];
  kept: IssuePlan[];
  noop: IssuePlan[];
  errored: { issue: IssuePlan; reason: unknown }[];
};

function categorizeOutcomes(
  settled: PromiseSettledResult<IssueOutcome>[],
  issues: IssuePlan[],
): CategorizedOutcomes {
  const opened: IssuePlan[] = [];
  const kept: IssuePlan[] = [];
  const noop: IssuePlan[] = [];
  const errored: { issue: IssuePlan; reason: unknown }[] = [];
  settled.forEach((outcome, i) => {
    const issue = issues[i]!;
    if (outcome.status === "rejected") {
      errored.push({ issue, reason: outcome.reason });
    } else {
      switch (outcome.value.kind) {
        case "opened": opened.push(issue); break;
        case "kept":   kept.push(issue);   break;
        case "noop":   noop.push(issue);   break;
      }
    }
  });
  return { opened, kept, noop, errored };
}

type RunResultSummary = {
  iterations?: unknown[];
  completionSignal?: string;
  stdout?: string;
};

function summarizeRunResult(name: string, maxIterations: number, result: RunResultSummary): string {
  const iterCount = Array.isArray(result.iterations) ? result.iterations.length : "?";
  const completed =
    (result.completionSignal ?? "").includes(COMPLETE_PROMISE_SENTINEL) ||
    (result.stdout ?? "").includes(COMPLETE_PROMISE_SENTINEL);
  const signalStr = completed ? "signaled complete" : "no completion signal";
  return `[done] ${name} — ${iterCount}/${maxIterations} iters; ${signalStr}`;
}

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
      // implementer into improvised git-plumbing recovery (see #99).
      { command: "test -w /home/agent/workspace && test -r /home/agent/workspace/.git" },
      // Auth preflight — abort the iteration with a readable error if the
      // host's GH_TOKEN didn't propagate.
      { command: "gh auth status" },
      { command: "bun install --frozen-lockfile" },
    ],
  },
};

let idleIterations = 0;
const RUN_ID = buildRunId("swarm");
const LOGS = `./.sandcastle/logs/${RUN_ID}-pr`;
const usage = createUsageTracker(LOGS);
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

async function findOpenPrForBranch(branch: string): Promise<number | null> {
  // Idempotency: if a swarm-pr run already opened a PR for this branch, leave
  // it alone. Lets the operator re-run safely while review feedback is in
  // flight without spawning a duplicate PR or re-pushing fixups.
  const stdout = await ghJson([
    "pr",
    "list",
    "--state",
    "open",
    "--head",
    branch,
    "--json",
    "number",
  ]);
  const parsed = JSON.parse(stdout) as { number: number }[];
  return parsed.length > 0 ? parsed[0]!.number : null;
}

function parsePrTag(stdout: string): { title: string; body: string } {
  const match = stdout.match(/<pr>([\s\S]*?)<\/pr>/);
  if (!match) {
    throw new Error("PR-author agent did not produce a <pr> tag.\n\n" + stdout);
  }
  const parsed = JSON.parse(match[1]!) as { title?: unknown; body?: unknown };
  if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new Error("PR-author <pr> tag missing string title/body: " + match[1]);
  }
  return { title: parsed.title, body: parsed.body };
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

    // No planner — PR mode takes one ready-for-agent issue per iteration
    // (lowest issue number first) and lets the human review queue serialise
    // the rest. The swarm template's planner exists to gate auto-merge
    // ordering; with PRs that gating moves to the human reviewer.
    const ready = (await fetchReadyIssues()).sort((a, b) => a.number - b.number);
    const issues: IssuePlan[] = ready.slice(0, 1).map((r) => ({
      number: r.number,
      title: r.title,
      branch: `sandcastle/issue-${r.number}-${slugifyIssueTitle(r.title)}`,
    }));

    if (issues.length === 0) {
      console.log("No ready-for-agent issues. Exiting.");
      break;
    }

    // Hoist idempotency check before the banner so iteration 2 doesn't
    // re-announce an issue that already has an open PR from iteration 1.
    const singleIssue = issues[0]!;
    const existingPrBeforeBanner = await findOpenPrForBranch(singleIssue.branch);
    if (existingPrBeforeBanner !== null) {
      console.log(
        `Nothing new to ship — issue #${singleIssue.number} already has PR #${existingPrBeforeBanner}; exiting.`,
      );
      break;
    }

    const otherCount = ready.length - 1;
    let otherSuffix = "";
    if (otherCount > 0) {
      const noun = otherCount === 1 ? "issue" : "issues";
      otherSuffix = ` (${otherCount} other ready-for-agent ${noun} will not be addressed this run)`;
    }
    console.log(`Working 1 issue this run${otherSuffix}:`);
    for (const issue of issues) {
      console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`);
    }

    // Refresh origin/main so countCommitsAhead compares against the latest base.
    await hostGit(["fetch", "origin", "main"]);

    const settled = await Promise.allSettled(
      issues.map(async (issue) => {
        await acquire();
        try {
          // Secondary idempotency check — catches the race where a PR was
          // opened between the hoisted check and now.
          const existingPr = await findOpenPrForBranch(issue.branch);
          if (existingPr !== null) {
            console.log(
              `  #${issue.number}: PR #${existingPr} already open for ${issue.branch}; skipping.`,
            );
            return { kind: "kept" as const, prNumber: existingPr };
          }

          // Skip implementer when the branch already has commits ahead of
          // origin/main from a prior run — re-running the implementer would
          // only re-explore the repo (~25k+ tokens of redundant `gh issue
          // view` / `find` / `wc -l` calls per log). See agent-swarm #99.
          //
          // Check both local (same-machine retry) and origin (a previous run
          // pushed the branch but failed before opening the PR — possibly
          // from another machine). Probe with ls-remote / rev-parse --quiet
          // first so a fresh issue produces no stderr noise.
          const remoteLs = await hostGit([
            "ls-remote",
            "--heads",
            "origin",
            issue.branch,
          ]);
          const branchOnOrigin =
            remoteLs.exitCode === 0 && remoteLs.stdout.trim().length > 0;
          if (branchOnOrigin) {
            const fetchBranch = await hostGit([
              "fetch",
              "origin",
              `${issue.branch}:refs/remotes/origin/${issue.branch}`,
            ]);
            if (fetchBranch.exitCode !== 0) {
              throw new Error(
                `git fetch ${issue.branch} exited ${fetchBranch.exitCode}`,
              );
            }
          }
          const localExists =
            (await hostGit(["rev-parse", "--verify", "--quiet", issue.branch]))
              .exitCode === 0;
          const aheadBeforeImplement = Math.max(
            localExists
              ? await countCommitsAhead(issue.branch, "origin/main", hostGit)
              : 0,
            branchOnOrigin
              ? await countCommitsAhead(
                  `origin/${issue.branch}`,
                  "origin/main",
                  hostGit,
                )
              : 0,
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
            if (!skipImplement) {
              const implResult = await runIssueSandbox({
                name: `implementer #${issue.number}`,
                maxIterations: IMPLEMENTER_MAX_ITERATIONS,
                agent: sandcastle.claudeCode("claude-sonnet-4-6"),
                promptFile: "./.sandcastle/templates/agent-swarm-pr/implement-prompt.md",
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
              console.log(summarizeRunResult(`implementer #${issue.number}`, IMPLEMENTER_MAX_ITERATIONS, implResult));

              // Ask the branch — not the sandbox commit count — whether work
              // landed. The implementer's git-plumbing recovery path can
              // commit without sandcastle observing it; the branch is the
              // source of truth. See agent-swarm #99.
              const aheadAfterImplement = await countCommitsAhead(
                issue.branch,
                "origin/main",
                hostGit,
              );
              if (aheadAfterImplement === 0) {
                return { kind: "noop" as const };
              }
            }

            const reviewResult = await runIssueSandbox({
              name: `reviewer #${issue.number}`,
              maxIterations: 1,
              agent: sandcastle.claudeCode("claude-sonnet-4-6"),
              promptFile: "./.sandcastle/templates/agent-swarm-pr/review-prompt.md",
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
            console.log(summarizeRunResult(`reviewer #${issue.number}`, 1, reviewResult));

            const aheadAfterReview = await countCommitsAhead(
              issue.branch,
              "origin/main",
              hostGit,
            );
            if (aheadAfterReview === 0) {
              return { kind: "noop" as const };
            }

            // Push from the host so the bind-mounted worktree's branch lands
            // on origin under the host's git config. `-u` is safe to re-run.
            const push = await hostGit(["push", "-u", "origin", issue.branch]);
            if (push.exitCode !== 0) {
              throw new Error(`git push for ${issue.branch} exited ${push.exitCode}`);
            }

            const prAuthor = await runIssueSandbox({
              name: `pr-author #${issue.number}`,
              maxIterations: 1,
              agent: sandcastle.claudeCode("claude-sonnet-4-6"),
              promptFile: "./.sandcastle/templates/agent-swarm-pr/pr-prompt.md",
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
                    agent: "pr",
                  }),
                ),
              },
            });
            console.log(summarizeRunResult(`pr-author #${issue.number}`, 1, prAuthor));

            const { title, body } = parsePrTag(prAuthor.stdout);
            const created = await gh([
              "pr",
              "create",
              "--head",
              issue.branch,
              "--base",
              "main",
              "--title",
              title,
              "--body",
              body,
            ]);
            if (created.exitCode !== 0) {
              throw new Error(`gh pr create for ${issue.branch} exited ${created.exitCode}: ${created.stderr}`);
            }
            const prUrl = created.stdout.trim();
            console.log(`  #${issue.number}: opened PR → ${prUrl}`);
            return { kind: "opened" as const, prUrl };
          } finally {
            await issueSandbox.close();
          }
        } finally {
          release();
        }
      }),
    );

    const { opened, kept, noop, errored } = categorizeOutcomes(settled, issues);

    const fmt = (list: IssuePlan[]) =>
      list.length ? list.map((i) => `#${i.number}`).join(", ") : "(none)";
    console.log(
      `opened: [${fmt(opened)}]; kept: [${fmt(kept)}]; noop: [${fmt(noop)}]; errored: [${fmt(errored.map((e) => e.issue))}]`,
    );

    for (const failure of errored) {
      console.error(`  ✗ ${failure.issue.number} (${failure.issue.branch}) failed: ${failure.reason}`);
    }

    if (opened.length === 0) {
      idleIterations += 1;
      console.log(
        `No new PRs opened. Idle iteration ${idleIterations}/${MAX_IDLE_ITERATIONS}.`,
      );
      if (idleIterations >= MAX_IDLE_ITERATIONS) {
        const exitMessage = kept.length > 0
          ? "In-flight PRs preserved; exiting."
          : "Queue drained for this run; exiting.";
        console.log(exitMessage);
        break;
      }
      continue;
    }

    idleIterations = 0;
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
