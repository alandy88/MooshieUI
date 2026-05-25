# TASK

Write the title and description for a pull request that closes issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}.

The implementation is already done — commits sit on branch
`{{BRANCH}}`. You are NOT implementing anything. You are NOT running
tests. You are summarising work that already exists.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly. Never prefix a `gh` invocation with `GH_TOKEN=… gh …` or echo the
token in any shell command.

# CONTEXT

Read the issue:

```
gh issue view {{ISSUE_NUMBER}} --comments
```

Read what changed on the branch:

```
git log main..{{BRANCH}} --reverse
git diff main..{{BRANCH}} --stat
git diff main..{{BRANCH}}
```

If the diff is large, focus on the commit messages and the `--stat`
summary; only `git diff` specific files when a commit message is
unclear.

# OUTPUT

Emit a single block as the last thing in your response:

<output>
{
  "prTitle": "feat: short imperative summary",
  "prDescription": "## Summary\n\n- bullet 1\n- bullet 2\n\nCloses #{{ISSUE_NUMBER}}"
}
</output>

- `prTitle` must be a single line, under 70 characters, conventional-commit style (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- `prDescription` must include `Closes #{{ISSUE_NUMBER}}` so the PR closes the issue on merge.
