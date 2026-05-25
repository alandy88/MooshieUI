import { applyHostEnv } from "../../lib/host-env.mjs";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

import {
  buildSpikeBranchName,
  composeRecommendationComment,
  nextAttempt,
  parseTaggedJson,
  parseTaggedText,
  slugify,
  type IssueContext,
} from "./orchestrator.mts";
import { extractInFlightTags } from "../../lib/retro-note.mts";
import {
  buildVaultWriter,
  runRetro,
} from "../../lib/run-retro.mts";
import {
  buildRunId,
  ensureLogParent,
  installRunLog,
  spikeLogPath,
} from "../../lib/run-logging.mts";
import { withCapWarning } from "../../lib/run-with-cap-warning.mts";

applyHostEnv();

const execFile = promisify(execFileCb);

type IssueView = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: Array<{ name: string }>;
  comments: Array<{ body: string }>;
};

type PhaseConfig = {
  agent: ReturnType<typeof sandcastle.codex> | ReturnType<typeof sandcastle.claudeCode>;
  maxIterations: number;
};

type SpikeApproach = {
  name: string;
  slug?: string;
};

type ResearchDecision = {
  decision: "KILL" | "SPIKE";
  reason?: string;
  approaches?: SpikeApproach[];
};

type SpikeRunResult = {
  approach: string;
  branch: string;
  status: "completed" | "failed";
  stdout: string;
  error: string;
};

const sandbox = docker({
  mounts: [
    { hostPath: "~/.codex/auth.json", sandboxPath: "/home/agent/.codex/auth.json", readonly: true },
  ],
});

const hooks = {
  sandbox: {
    onSandboxReady: [{ command: "bun install --frozen-lockfile" }],
  },
};

const phaseConfig: Record<string, PhaseConfig> = {
  "research-gather": {
    agent: sandcastle.codex("gpt-5.3-codex", { effort: "high" }),
    maxIterations: 2,
  },
  "research-analyze": {
    agent: sandcastle.claudeCode("claude-opus-4-6"),
    maxIterations: 1,
  },
  "synthesis-gather": {
    agent: sandcastle.codex("gpt-5.3-codex", { effort: "high" }),
    maxIterations: 2,
  },
  "synthesis-recommend": {
    agent: sandcastle.claudeCode("claude-opus-4-6"),
    maxIterations: 1,
  },
  retro: {
    agent: sandcastle.claudeCode("claude-sonnet-4-6"),
    maxIterations: 1,
  },
};

function parseIssueArg(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--issue") {
      const raw = argv[i + 1];
      const value = raw ? Number(raw) : NaN;
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid issue number: ${raw ?? "(missing)"}.\nUsage: bun run sc:spike -- --issue <number>`);
      }
      return value;
    }
  }
  throw new Error("Missing --issue argument.\nUsage: bun run sc:spike -- --issue <number>");
}

async function runGh(args: string[]): Promise<string> {
  const { stdout } = await execFile("gh", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function fetchIssue(issueNumber: number): Promise<IssueContext> {
  const json = await runGh([
    "issue",
    "view",
    String(issueNumber),
    "--json",
    "number,title,body,url,labels,comments",
  ]);

  const issue = JSON.parse(json) as IssueView;
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.url,
    labels: issue.labels.map((label) => label.name),
    comments: issue.comments.map((comment) => comment.body ?? ""),
  };
}

async function fetchIssueLabels(issueNumber: number): Promise<string[]> {
  const json = await runGh([
    "issue",
    "view",
    String(issueNumber),
    "--json",
    "labels",
  ]);
  const issue = JSON.parse(json) as Pick<IssueView, "labels">;
  return issue.labels.map((label) => label.name);
}

async function editIssueLabels(input: {
  issueNumber: number;
  add: string[];
  remove: string[];
}): Promise<void> {
  const { issueNumber } = input;
  const current = await fetchIssueLabels(issueNumber);
  const add = input.add.filter((label) => label.length > 0 && !current.includes(label));
  const remove = input.remove.filter((label) => label.length > 0 && current.includes(label));

  if (add.length === 0 && remove.length === 0) {
    return;
  }

  const args = ["issue", "edit", String(issueNumber)];
  for (const label of add) {
    args.push("--add-label", label);
  }
  for (const label of remove) {
    args.push("--remove-label", label);
  }
  await runGh(args);
}

async function postIssueComment(input: {
  issueNumber: number;
  body: string;
}): Promise<void> {
  await runGh([
    "issue",
    "comment",
    String(input.issueNumber),
    "--body",
    input.body,
  ]);
}

async function pushBranch(input: { branch: string }): Promise<void> {
  await execFile("git", ["push", "-u", "origin", input.branch], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function getMainSha(): Promise<string> {
  const { stdout } = await execFile("git", ["rev-parse", "main"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim().slice(0, 7);
}

async function summarizeDiff(branch: string | null, mainSha: string): Promise<string> {
  if (!branch) {
    return "(none)";
  }

  try {
    const { stdout } = await execFile("git", ["diff", "--no-color", "--stat", `${mainSha}...${branch}`], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : "(no diff)";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `(diff unavailable: ${detail})`;
  }
}

function summarizeSpikeResults(results: SpikeRunResult[]): string {
  return results
    .map((result) => {
      if (result.status === "completed") {
        return [
          `- approach: ${result.approach}`,
          `  branch: ${result.branch}`,
          "  status: completed",
          `  notes: ${result.stdout.slice(0, 1000)}`,
        ].join("\n");
      }
      return [
        `- approach: ${result.approach}`,
        `  branch: ${result.branch}`,
        "  status: failed",
        `  error: ${result.error}`,
      ].join("\n");
    })
    .join("\n");
}

async function main(): Promise<void> {
  const issueNumber = parseIssueArg(process.argv.slice(2));
  const runId = buildRunId("spike", { issueNumber });
  const logs = `./.sandcastle/logs/${runId}`;
  const disposeRunLog = installRunLog(logs);

  try {
    console.log(`logs: ${logs}`);

    const issue = await fetchIssue(issueNumber);
    const mainSha = await getMainSha();
    const runWithCapWarning = withCapWarning(sandcastle.run);
    const writeRetroNote = buildVaultWriter();

    const runPhase = async (input: {
      name: string;
      promptFile: string;
      promptArgs: Record<string, string>;
    }) => {
      const config = phaseConfig[input.name];
      if (!config) {
        throw new Error(`Unknown orchestration phase: ${input.name}`);
      }
      return runWithCapWarning({
        hooks,
        sandbox,
        name: input.name,
        maxIterations: config.maxIterations,
        agent: config.agent,
        promptFile: input.promptFile,
        promptArgs: input.promptArgs,
        logging: {
          type: "file",
          path: ensureLogParent(
            spikeLogPath(logs, { kind: "phase", name: input.name }),
          ),
        },
      });
    };

    const attempt = nextAttempt(issue);

    await editIssueLabels({
      issueNumber: issue.number,
      add: ["spike-in-progress"],
      remove: [],
    });

    const researchGather = await runPhase({
      name: "research-gather",
      promptFile: "./.sandcastle/templates/agent-spike/research-gather-prompt.md",
      promptArgs: {
        ISSUE_NUMBER: String(issue.number),
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        ISSUE_URL: issue.url,
        PRIOR_COMMENTS: issue.comments.join("\n\n---\n\n"),
        REWORK_ATTEMPT: String(attempt),
      },
    });

    const researchAnalyze = await runPhase({
      name: "research-analyze",
      promptFile: "./.sandcastle/templates/agent-spike/research-analyze-prompt.md",
      promptArgs: {
        ISSUE_NUMBER: String(issue.number),
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
        ISSUE_URL: issue.url,
        RESEARCH_FINDINGS: researchGather.stdout,
      },
    });

    const decision = parseTaggedJson<ResearchDecision>(researchAnalyze.stdout, "research");
    const phaseStdouts: string[] = [researchGather.stdout, researchAnalyze.stdout];

    let outcome: "killed" | "completed";
    let finalBranch: string | null = null;
    let finalDiff = "(none)";
    let phaseSummary = "";
    let recommendation = "";

    if (decision.decision === "KILL") {
      await postIssueComment({
        issueNumber: issue.number,
        body: [
          "## Spike Explorer Result: KILL",
          "",
          `Issue #${issueNumber} was killed during research.`,
          "",
          `Reason: ${decision.reason ?? "No reason provided."}`,
        ].join("\n"),
      });

      await editIssueLabels({
        issueNumber: issue.number,
        add: ["declined"],
        remove: ["spike-in-progress"],
      });

      outcome = "killed";
      phaseSummary = "research-gather: completed; research-analyze: decision=KILL";
      recommendation = decision.reason ?? "No reason provided.";
    } else {
      const selectedApproaches = (decision.approaches ?? []).slice(0, 2);
      if (selectedApproaches.length < 2) {
        throw new Error("Research analyze must return at least two approaches when decision is SPIKE.");
      }

      const spikeResults = await Promise.all(
        selectedApproaches.map(async (approach) => {
          const slug = slugify(approach.slug ?? approach.name);
          const branch = buildSpikeBranchName(issue.number, slug, attempt);
          const spikeSandbox = await sandcastle.createSandbox({
            branch,
            sandbox,
            hooks,
          });
          const runInSpikeSandbox = withCapWarning(spikeSandbox.run.bind(spikeSandbox));

          try {
            const spike = await runInSpikeSandbox({
              name: "spike-implement",
              maxIterations: 3,
              agent: sandcastle.claudeCode("claude-opus-4-6"),
              promptFile: "./.sandcastle/templates/agent-spike/spike-implement-prompt.md",
              promptArgs: {
                ISSUE_NUMBER: String(issue.number),
                ISSUE_TITLE: issue.title,
                APPROACH_NAME: approach.name,
                APPROACH_SLUG: slug,
                BRANCH: branch,
              },
              logging: {
                type: "file",
                path: ensureLogParent(
                  spikeLogPath(logs, {
                    kind: "attempt",
                    branch,
                    name: "spike-implement",
                  }),
                ),
              },
            });
            await pushBranch({ branch });

            return {
              approach: approach.name,
              branch,
              status: "completed",
              stdout: spike.stdout,
              error: "",
            } satisfies SpikeRunResult;
          } catch (error) {
            return {
              approach: approach.name,
              branch,
              status: "failed",
              stdout: "",
              error: error instanceof Error ? error.message : String(error),
            } satisfies SpikeRunResult;
          } finally {
            await spikeSandbox.close();
          }
        }),
      );

      for (const result of spikeResults) {
        if (result.stdout) phaseStdouts.push(result.stdout);
      }

      const synthesisGather = await runPhase({
        name: "synthesis-gather",
        promptFile: "./.sandcastle/templates/agent-spike/synthesis-gather-prompt.md",
        promptArgs: {
          ISSUE_NUMBER: String(issue.number),
          ISSUE_TITLE: issue.title,
          ISSUE_BODY: issue.body,
          ISSUE_URL: issue.url,
          SPIKE_RESULTS: summarizeSpikeResults(spikeResults),
        },
      });

      const synthesisRecommend = await runPhase({
        name: "synthesis-recommend",
        promptFile: "./.sandcastle/templates/agent-spike/synthesis-recommend-prompt.md",
        promptArgs: {
          ISSUE_NUMBER: String(issue.number),
          ISSUE_TITLE: issue.title,
          ISSUE_URL: issue.url,
          SYNTHESIS_TABLE: synthesisGather.stdout,
        },
      });
      phaseStdouts.push(synthesisGather.stdout, synthesisRecommend.stdout);
      recommendation = parseTaggedText(synthesisRecommend.stdout, "comment");

      await postIssueComment({
        issueNumber: issue.number,
        body: composeRecommendationComment(recommendation, mainSha),
      });

      await editIssueLabels({
        issueNumber: issue.number,
        add: ["spike-complete"],
        remove: ["spike-in-progress", "needs-rework"],
      });

      outcome = "completed";
      finalBranch = spikeResults.find((r) => r.status === "completed")?.branch ?? null;
      finalDiff = summarizeSpikeResults(spikeResults);
      phaseSummary = [
        "research-gather: completed",
        "research-analyze: decision=SPIKE",
        `spike-implement: ${spikeResults.length} approach(es)`,
        "synthesis-gather: completed",
        "synthesis-recommend: completed",
      ].join("; ");
    }

    await runRetro({
      context: {
        flow: "spike",
        issue,
        runId,
        mainSha,
        branch: finalBranch,
        outcome,
        finalDiff,
        phaseSummary,
        inFlightTags: extractInFlightTags(phaseStdouts),
        recommendation,
      },
      deps: {
        run: async (phaseInput) => {
          const retroConfig = phaseConfig[phaseInput.name];
          if (!retroConfig) {
            throw new Error(`Unknown retro phase: ${phaseInput.name}`);
          }
          return runWithCapWarning({
            name: phaseInput.name,
            maxIterations: retroConfig.maxIterations,
            agent: retroConfig.agent,
            promptFile: phaseInput.promptFile,
            promptArgs: {
              ...phaseInput.promptArgs,
              FINAL_DIFF: await summarizeDiff(finalBranch, mainSha),
            },
            logging: {
              type: "file",
              path: ensureLogParent(
                spikeLogPath(logs, { kind: "phase", name: "retro" }),
              ),
            },
          });
        },
        writer: writeRetroNote,
      },
    });

    console.log(`Spike explorer finished for issue #${issueNumber}: ${outcome}`);
  } finally {
    await disposeRunLog();
  }
}

await main();
