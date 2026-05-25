# TASK

You are addressing reviewer feedback on PR #{{PR_NUMBER}} (branch `{{BRANCH}}`).

Unlike a review, your job is **not** to compare the code against a spec or coding standards. Your job is to read the unresolved conversation on this PR, decide what (if anything) to change in the code, make those changes, and explain yourself by commenting back where useful.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly: `gh issue view`, `gh pr view`, etc. Never prefix a `gh` invocation
with `GH_TOKEN=… gh …` or echo the token in any shell command — log files
capture stdin/stdout and a leaked credential is a real incident.

# CONTEXT

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` if you need domain context for a comment. Don't go deeper than the comments demand.

<linked-issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</linked-issue>

<diff-to-main>

!`git diff main..HEAD`

</diff-to-main>

<pr-comments>

The unresolved conversation on this PR. Tagged by surface:

- `issue_comment` — top-level PR conversation comment.
- `review_thread` — inline thread anchored to a file + line. Only **unresolved** threads are included. Each comment has a `commentId` you can reply to in-thread.
- `review_summary` — top-level body of a submitted review.

Not everything in here is necessarily actionable — reviewers may leave context, questions, asides, or things they meant to resolve. Use your judgement. **Do not treat unresolved == must-action.**

```json
{{PR_COMMENTS_JSON}}
```

</pr-comments>

# PROCESS

1. Read the conversation. For each item, classify it in your head as: code change needed, reply needed (question / disagreement / clarification), or neither.
2. Make the code changes you decided on. Run `bun run typecheck` and `bun run test` before committing. Use conventional-commit messages (`feat:`, `fix:`, `refactor:`, etc.). Do NOT use a `RALPH:` prefix.
3. If you made no changes that's fine — only commit when there's a real diff.
4. Emit the structured output below describing the replies and any new inline comments you want posted.

You do not have to reply to every thread. Reply only where a reply adds value: confirming what you changed, explaining why you chose not to make a requested change, answering a question, or pointing out something the reviewer should look at. Silence is fine for context-only comments.

You cannot resolve threads. Resolution is the reviewer's job.

# OUTPUT

Emit a single `<output>` block as the **last thing** in your response. Valid JSON, field names exact.

## Example

<output>
{
  "threadReplies": [
    {
      "commentId": "PRRC_kwDOPSEf9c8AAAABX1234",
      "body": "Good catch — fixed in the latest commit by adding the early-return guard."
    }
  ],
  "newInlineComments": [
    {
      "path": "src/lib/components/auth.ts",
      "line": 87,
      "body": "Heads up — while addressing the thread above I also tightened the guard on line 85."
    }
  ],
  "topLevelComments": [
    {
      "body": "Addressed 2 of 3 threads. Left the third for a separate PR — explained inline."
    }
  ]
}
</output>

## Empty output (rare)

If you made no code changes and have nothing to say, emit:

<output>
{ "threadReplies": [], "newInlineComments": [], "topLevelComments": [] }
</output>

## Field reference

| Field                       | Type    | Required | Notes                                                                 |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `threadReplies`             | array   | no       | Replies posted in an existing unresolved review thread.               |
| `threadReplies[].commentId` | string  | **yes**  | Must be a `commentId` from a `review_thread` in `<pr-comments>`.      |
| `threadReplies[].body`      | string  | **yes**  | Markdown reply.                                                       |
| `newInlineComments`         | array   | no       | New inline comments on lines in the diff.                             |
| `newInlineComments[].path`  | string  | **yes**  | Relative file path.                                                   |
| `newInlineComments[].line`  | integer | **yes**  | Single line number in the post-commit HEAD.                           |
| `newInlineComments[].body`  | string  | **yes**  | Markdown.                                                             |
| `topLevelComments`          | array   | no       | New top-level PR conversation comments.                               |
| `topLevelComments[].body`   | string  | **yes**  | Markdown.                                                             |

Do not add fields not listed above.

Learnings:
- When friction worth remembering appears, emit an inline tag exactly as `<learning>[Friction Type] note</learning>`.
- Use Title Case bracket prefixes (for example `[PRD Misinformation]`, `[Scope Drift]`, `[Tooling Friction]`).
- If no existing type fits, invent a new Friction Type bracket.
- Emit zero or many learning tags as needed; do not emit empty filler tags.
