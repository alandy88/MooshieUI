# ISSUES

Open issues labelled `ready-for-agent` (titles + labels only — bodies elided to save tokens):

<issues-json>

!`gh issue list --state open --label ready-for-agent --json number,title,labels --jq '[.[] | {number, title, labels: [.labels[].name]}]'`

</issues-json>

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

If a title or labels alone don't make the dependency picture clear, run `gh issue view <number>` to fetch the body and comments for the specific issues you need to disambiguate. Don't fetch bodies you don't need.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

If the issue appears to be a PRD and it has implementation issues which link to it, the PRD cannot be worked on.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{number}-{slug}`.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"number": 42, "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).


Learnings:
- When friction worth remembering appears, emit an inline tag exactly as `<learning>[Friction Type] note</learning>`.
- Use Title Case bracket prefixes (for example `[PRD Misinformation]`, `[Scope Drift]`, `[Tooling Friction]`).
- If no existing type fits, invent a new Friction Type bracket.
- Emit zero or many learning tags as needed; do not emit empty filler tags.
