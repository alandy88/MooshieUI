export type IssueContext = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  comments: string[];
};

export function buildSpikeBranchName(issueNumber: number, slug: string, attempt: number): string {
  const normalizedAttempt = Number.isFinite(attempt) && attempt > 1 ? Math.floor(attempt) : 1;
  if (normalizedAttempt === 1) {
    return `spike/${issueNumber}-${slug}`;
  }
  return `spike/${issueNumber}-v${normalizedAttempt}-${slug}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "approach";
}

export function parseTaggedJson<T>(output: string, tag: string): T {
  const match = output.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match?.[1]) {
    throw new Error(`Missing <${tag}> JSON tag in agent output.`);
  }
  return JSON.parse(match[1]) as T;
}

export function parseTaggedText(output: string, tag: string): string {
  const match = output.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match?.[1]) {
    throw new Error(`Missing <${tag}> tag in agent output.`);
  }
  return match[1];
}

export function composeRecommendationComment(body: string, mainSha: string): string {
  return [
    body.trim(),
    "",
    "---",
    "",
    `*Recommendation based on \`main\` at ${mainSha}. Rerun /spike if the area has materially changed since.*`,
  ].join("\n");
}

export function nextAttempt(issue: IssueContext): number {
  const hasNeedsRework = issue.labels.includes("needs-rework");
  if (!hasNeedsRework) return 1;

  let maxSeen = 1;
  for (const comment of issue.comments) {
    const matches = comment.matchAll(new RegExp(`spike\\/${issue.number}-(?:v(\\d+)-)?[a-z0-9-]+`, "g"));
    for (const match of matches) {
      const versionRaw = match[1];
      const version = versionRaw ? Number(versionRaw) : 1;
      if (Number.isFinite(version) && version > maxSeen) {
        maxSeen = version;
      }
    }
  }
  return maxSeen + 1;
}
