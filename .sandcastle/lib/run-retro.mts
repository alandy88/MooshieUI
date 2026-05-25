import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  composeRetroNoteFile,
  composeStubNote,
  parseRetroTag,
  type RetroFlow,
} from "./retro-note.mts";

type RunInput = {
  name: string;
  promptFile: string;
  promptArgs: Record<string, string>;
};

type RunOutput = {
  stdout: string;
};

type IssueSummary = {
  number: number;
  title: string;
  body: string;
  url: string;
};

export type RetroContext = {
  flow: RetroFlow;
  issue: IssueSummary;
  runId: string;
  mainSha: string;
  branch: string | null;
  outcome: "completed" | "killed" | "failed";
  finalDiff: string;
  phaseSummary: string;
  inFlightTags: string[];
  recommendation: string;
  now?: Date;
};

export type RetroDeps = {
  run: (input: RunInput) => Promise<RunOutput>;
  writer: (input: { filename: string; content: string }) => Promise<void>;
};

export type RetroRunResult =
  | { status: "written"; filename: string }
  | { status: "skipped" }
  | { status: "stub"; filename: string; error: string };

export async function runRetro(input: { deps: RetroDeps; context: RetroContext }): Promise<RetroRunResult> {
  const { deps, context } = input;

  try {
    const retro = await deps.run({
      name: "retro",
      promptFile: "./.sandcastle/templates/retro-prompt.md",
      promptArgs: {
        FLOW: context.flow,
        ISSUE_NUMBER: String(context.issue.number),
        ISSUE_TITLE: context.issue.title,
        ISSUE_BODY: context.issue.body,
        ISSUE_URL: context.issue.url,
        MAIN_SHA: context.mainSha,
        RUN_ID: context.runId,
        BRANCH: context.branch ?? "(none)",
        OUTCOME: context.outcome,
        FINAL_DIFF: context.finalDiff,
        PHASE_SUMMARY: context.phaseSummary,
        IN_FLIGHT_TAGS: context.inFlightTags.length > 0
          ? context.inFlightTags.map((tag) => `- ${tag}`).join("\n")
          : "(none)",
        RECOMMENDATION: context.recommendation,
      },
    });

    const parsed = parseRetroTag(retro.stdout);
    if (parsed.kind === "skip") {
      return { status: "skipped" };
    }
    if (parsed.kind === "error") {
      throw new Error(parsed.error);
    }

    const { insight, body } = splitRetroContent(parsed.content);
    const note = composeRetroNoteFile({
      now: context.now,
      flow: context.flow,
      runId: context.runId,
      issueNumber: context.issue.number,
      branch: context.branch,
      outcome: context.outcome,
      insight,
      retroBody: body,
    });

    await deps.writer(note);
    return { status: "written", filename: note.filename };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const stub = composeStubNote({
      now: context.now,
      flow: context.flow,
      runId: context.runId,
      issueNumber: context.issue.number,
      branch: context.branch,
      error: reason,
    });

    try {
      await deps.writer(stub);
    } catch {
      // Best effort: retro failures must never break the main run.
    }

    return { status: "stub", filename: stub.filename, error: reason };
  }
}

export function resolveLearningsDir(env: NodeJS.ProcessEnv = process.env): string {
  const vaultRoot = env.LIF_NOTES_VAULT?.trim() || "D:\\Git\\lif-notes";
  return path.join(vaultRoot, "work", "development", "sandcastle-learnings");
}

export function buildVaultWriter(options?: { learningsDir?: string }): RetroDeps["writer"] {
  const learningsDir = options?.learningsDir ?? resolveLearningsDir();

  return async ({ filename, content }) => {
    await mkdir(learningsDir, { recursive: true });
    const fullPath = path.join(learningsDir, filename);
    await writeFile(fullPath, content, "utf8");
  };
}

function splitRetroContent(raw: string): { insight: string; body: string } {
  const trimmed = raw.trim();
  const lines = trimmed.split("\n");

  const first = lines[0]?.trim() ?? "";
  if (/^insight\s*:/i.test(first)) {
    const insight = first.replace(/^insight\s*:/i, "").trim();
    return {
      insight: insight || "Learning",
      body: lines.slice(1).join("\n").trim() || "## What happened\n\n- (no details provided)",
    };
  }

  return {
    insight: "Learning",
    body: trimmed || "## What happened\n\n- (no details provided)",
  };
}
