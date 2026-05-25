import { execFileSync } from "node:child_process";
import { z } from "zod";

const PrView = z.object({
  title: z.string(),
  body: z.string().nullable().default(""),
  headRefOid: z.string(),
  comments: z.array(
    z.object({
      id: z.string().optional(),
      author: z.object({ login: z.string() }).nullable().optional(),
      body: z.string(),
      createdAt: z.string().optional(),
    })
  ),
});

const ReviewSchema = z.array(
  z.object({
    id: z.number(),
    user: z.object({ login: z.string() }).nullable(),
    body: z.string().nullable().default(""),
    state: z.string(),
    submitted_at: z.string().nullable().optional(),
  })
);

const ThreadsSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              comments: z.object({
                nodes: z.array(
                  z.object({
                    id: z.string(),
                    path: z.string().nullable(),
                    line: z.number().nullable(),
                    originalLine: z.number().nullable(),
                    body: z.string(),
                    author: z.object({ login: z.string() }).nullable(),
                  })
                ),
              }),
            })
          ),
        }),
      }),
    }),
  }),
});

function sh(cmd: string): string {
  const [bin, ...args] = cmd.split(" ");
  return execFileSync(bin!, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function safeSh(cmd: string): string {
  try { return sh(cmd); } catch { return ""; }
}

export type PrComments = {
  issueNumber: string;
  issueTitle: string;
  issue_comments: { author: string; body: string; createdAt?: string }[];
  review_summaries: { author: string; state: string; body: string | null; submittedAt?: string | null }[];
  review_threads: { commentId: string; threadId: string; path: string | null; line: number | null; author: string; body: string }[];
};

export function fetchPrComments(prNumber: string, ghRepo: string): PrComments {
  const prViewJson = sh(`gh pr view ${prNumber} --json title,body,headRefOid,comments`);
  const prView = PrView.parse(JSON.parse(prViewJson));

  const issueMatch = prView.body?.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  const issueNumber = issueMatch?.[1] ?? "";
  const issueTitle = issueNumber
    ? safeSh(`gh issue view ${issueNumber} --json title --jq .title`).trim()
    : "";

  const reviewsJson = sh(`gh api repos/{owner}/{repo}/pulls/${prNumber}/reviews`);
  const reviews = ReviewSchema.parse(JSON.parse(reviewsJson));

  const graphqlQuery = `
query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:50) {
            nodes {
              id
              path
              line
              originalLine
              body
              author { login }
            }
          }
        }
      }
    }
  }
}`;

  const [owner, repo] = ghRepo.split("/");
  const threadsJson = execFileSync(
    "gh",
    ["api", "graphql", "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `number=${prNumber}`, "-f", `query=${graphqlQuery}`],
    { encoding: "utf8" }
  );
  const threadsParsed = ThreadsSchema.parse(JSON.parse(threadsJson));
  const unresolvedThreads = threadsParsed.data.repository.pullRequest.reviewThreads.nodes.filter(
    (t) => !t.isResolved
  );

  return {
    issueNumber,
    issueTitle,
    issue_comments: prView.comments.map((c) => ({
      author: c.author?.login ?? "unknown",
      body: c.body,
      createdAt: c.createdAt,
    })),
    review_summaries: reviews
      .filter((r) => r.body && r.body.trim().length > 0)
      .map((r) => ({
        author: r.user?.login ?? "unknown",
        state: r.state,
        body: r.body,
        submittedAt: r.submitted_at,
      })),
    review_threads: unresolvedThreads.flatMap((t) =>
      t.comments.nodes.map((c) => ({
        commentId: c.id,
        threadId: t.id,
        path: c.path,
        line: c.line ?? c.originalLine,
        author: c.author?.login ?? "unknown",
        body: c.body,
      }))
    ),
  };
}
