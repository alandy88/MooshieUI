export type RetroParseResult =
  | { kind: "content"; content: string }
  | { kind: "skip" }
  | { kind: "error"; error: string };

export type RetroFlow = "spike" | "swarm";

type BaseNoteInput = {
  now?: Date;
  flow: RetroFlow;
  runId: string;
  issueNumber: number | null;
  branch: string | null;
};

export type ComposeRetroNoteInput = BaseNoteInput & {
  outcome: "completed" | "killed" | "failed" | "retro-failed";
  insight: string;
  retroBody: string;
};

export type ComposeStubNoteInput = BaseNoteInput & {
  error: string;
};

export function parseRetroTag(output: string): RetroParseResult {
  const skipMatch = output.match(/<retro\s+skip=(?:"true"|'true')\s*\/>/i);
  if (skipMatch) {
    return { kind: "skip" };
  }

  const contentMatch = output.match(/<retro>([\s\S]*?)<\/retro>/i);
  if (contentMatch?.[1] !== undefined) {
    return { kind: "content", content: contentMatch[1] };
  }

  if (/<retro\b/i.test(output)) {
    return { kind: "error", error: "Unclosed <retro> tag in agent output." };
  }

  return { kind: "error", error: "Missing <retro> tag in agent output." };
}

export function extractInFlightTags(stdouts: string[]): string[] {
  const tags: string[] = [];
  const learningTagRe = /<learning>([\s\S]*?)<\/learning>/g;

  for (const stdout of stdouts) {
    for (const match of stdout.matchAll(learningTagRe)) {
      const value = match[1]?.trim();
      if (value) {
        tags.push(value);
      }
    }
  }

  return tags;
}

export function composeRetroNoteFile(input: ComposeRetroNoteInput): { filename: string; content: string } {
  const date = isoDate(input.now);
  const flowLabel = input.flow === "spike" ? "Spike" : "Swarm";
  const issueToken = input.issueNumber === null ? "No-Issue" : `#${input.issueNumber}`;
  const insight = normalizeInsight(input.insight);
  const filename = `${date} - Sandcastle ${flowLabel} ${issueToken} - ${insight}.md`;

  const issueValue = input.issueNumber === null ? "null" : String(input.issueNumber);
  const branchValue = input.branch === null ? "null" : input.branch;
  const issueLink = input.issueNumber === null ? "[[Issue Unknown]]" : `[[Issue ${input.issueNumber}]]`;

  const content = [
    "---",
    `date: ${date}`,
    `flow: ${input.flow}`,
    `run-id: ${input.runId}`,
    `issue: ${issueValue}`,
    `branch: ${branchValue}`,
    `outcome: ${input.outcome}`,
    "---",
    "",
    input.retroBody.trim(),
    "",
    "---",
    "",
    "[[Sandcastle Learnings Index]]",
    issueLink,
    input.flow === "spike" ? "[[Spike Flow]]" : "[[Swarm Flow]]",
    "",
  ].join("\n");

  return { filename, content };
}

export function composeStubNote(input: ComposeStubNoteInput): { filename: string; content: string } {
  return composeRetroNoteFile({
    now: input.now,
    flow: input.flow,
    runId: input.runId,
    issueNumber: input.issueNumber,
    branch: input.branch,
    outcome: "retro-failed",
    insight: `Retro Failed ${input.runId}`,
    retroBody: [
      "## What happened",
      "",
      "- Retro phase failed before a learning note could be generated.",
      "",
      "## Frictions",
      "",
      "- [Retro Failure] Retro phase execution failed.",
      "",
      "## Improvement seeds",
      "",
      "- Stabilize retro prompt or parser path.",
      "",
      "## Error",
      "",
      "```text",
      input.error,
      "```",
    ].join("\n"),
  });
}

function isoDate(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

function normalizeInsight(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const source = cleaned.length > 0 ? cleaned : "Learning";
  return source
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
