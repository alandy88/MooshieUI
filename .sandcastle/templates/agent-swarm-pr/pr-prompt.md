# TASK

Draft a pull request for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

Branch {{BRANCH}} has been pushed to origin. Read the diff and emit a structured PR title and body. **Do not run `gh pr create` yourself** — the orchestrator opens the PR using your output.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly: `gh issue view`, `gh pr view`, etc. Never prefix a `gh` invocation
with `GH_TOKEN=… gh …` or echo the token in any shell command — log files
capture stdin/stdout and a leaked credential is a real incident.

# CONTEXT

<issue>

!`gh issue view {{ISSUE_NUMBER}}`

</issue>

<diff-stat>

!`git diff --stat main..HEAD`

</diff-stat>

<commits>

!`git log --oneline main..HEAD`

</commits>

<diff-to-main>

!`git diff main..HEAD | head -c 60000`

</diff-to-main>

If `<diff-to-main>` was truncated, request the rest with `git diff main..HEAD -- <path>` for the files you actually need to summarise (see `<diff-stat>` for the file list).

# OUTPUT

Emit exactly one `<pr>` tag containing JSON with `title` and `body`. Nothing else inside the tag.

- **title**: ≤70 chars, conventional-commit-style if the repo uses it. No issue number prefix.
- **body**: markdown. Include a `## Summary` section (1–3 bullets, focused on the *why*) and a `## Test plan` section (markdown checklist of what was verified). End the body with `Closes #{{ISSUE_NUMBER}}` on its own line.

Example:

```
<pr>
{
  "title": "fix: tighten cap-warning threshold for long runs",
  "body": "## Summary\n- Lowered the warning threshold from 90% to 75% so long-running swarms surface usage pressure earlier.\n- Added regression test for the new boundary.\n\n## Test plan\n- [x] `npm run test`\n- [x] Manual: triggered a near-cap run and confirmed the warning fires once\n\nCloses #{{ISSUE_NUMBER}}"
}
</pr>
```

Once you have emitted the `<pr>` tag, output `<promise>COMPLETE</promise>`.
