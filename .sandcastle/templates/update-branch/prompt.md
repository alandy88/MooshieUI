# TASK

PR #{{PR_NUMBER}} (branch `{{BRANCH}}`) has merge conflicts against its base `{{BASE_REF}}`. A `git merge origin/{{BASE_REF}} --no-edit` has already been attempted and left the working tree in a conflicted state. Your job is to resolve every conflict, finish the merge, and write a PR comment describing what you did.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly. Never prefix a `gh` invocation with `GH_TOKEN=… gh …` or echo the
token in any shell command.

# CONTEXT

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` before resolving anything substantive.

<pr-view>

!`gh pr view {{PR_NUMBER}}`

</pr-view>

<merge-status>

!`git status`

</merge-status>

<conflicting-files>

!`git diff --name-only --diff-filter=U`

</conflicting-files>

# RESOLUTION POLICY

Always resolve. Do not abort the merge. Do not leave the branch in a half-finished state.

For each conflicting hunk:

1. **Investigate intent on both sides** before choosing a resolution. Use `git log -p --follow -- <path>` on both `origin/{{BASE_REF}}` and `{{BRANCH}}` to see how each side reached this state.
2. **Pick the resolution that preserves both intents** wherever possible. Where the intents are incompatible, pick the one that best matches the PR's stated goal and note the trade-off in your comment.
3. **Do not invent new behaviour.** Your job is reconciliation, not feature work.

After resolving, run `bun run typecheck` (fast) and optionally `bun run test` for stronger confidence. If something is broken, fix what you can; if you can't, flag it clearly in the comment.

# COMMIT

Stage everything and finish the merge with a single commit. Conventional-commit style, e.g. `chore: merge origin/{{BASE_REF}} into {{BRANCH}}`.

# OUTPUT

Emit a single block as the last thing in your response:

<output>
{
  "comment": "Markdown body posted as a PR comment. Describe which conflicts existed, how you resolved each, and flag any uncertainty or remaining problems."
}
</output>

The comment is the only safety net for the human author. Write it like you're handing the branch back and want them to spot any bad call in 30 seconds.
