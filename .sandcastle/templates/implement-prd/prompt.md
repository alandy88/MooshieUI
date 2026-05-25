# TASK

You are implementing one sub-issue of a multi-session PRD.

- **PRD:** #{{PRD_NUMBER}} — {{PRD_TITLE}}
- **This sub-issue:** #{{SUB_ISSUE_NUMBER}} — {{SUB_ISSUE_TITLE}}
- **Branch:** `{{BRANCH}}`

The branch may already have commits from earlier sub-issues. Do **not** rebase
or rewrite that history. Add your work on top.

Pull both issues in for context:

- `gh issue view {{PRD_NUMBER}} --comments` — the full PRD. Read this carefully; your implementation of this sub-issue must fit the larger plan.
- `gh issue view {{SUB_ISSUE_NUMBER}} --comments` — the specific step you are implementing now.

You also have access to the full list of sibling sub-issues:

`gh api repos/$GH_REPO/issues/{{PRD_NUMBER}}/sub_issues`

Use this to understand what work has already shipped on this branch and what
is still ahead — but **only implement #{{SUB_ISSUE_NUMBER}}** in this session.
Do not touch work that belongs to a different sub-issue.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly. Never prefix a `gh` invocation with `GH_TOKEN=… gh …` or echo the
token in any shell command.

# CONTEXT

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` before starting.
Explore the repo and fill your context with the parts relevant to this
sub-issue — especially test files that touch the area you'll change.

# EXECUTION

Use red-green-refactor where applicable.

1. RED: write one failing test
2. GREEN: implement to pass it
3. REPEAT until the sub-issue is done
4. REFACTOR

Before committing, run `bun run typecheck` and `bun run test`.

# COMMIT

Make one or more git commits on `{{BRANCH}}`. Use conventional-commit
messages (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). Do NOT use a
`RALPH:` prefix.

Include `Part of #{{PRD_NUMBER}}` in each commit body so the history is
linkable from the PRD. Do **not** include `Closes` in commits — closing the
sub-issue is the workflow's job, and closing the PRD is the merged PR's job.

Do not close the sub-issue yourself. Do not push the branch. The workflow
handles both.

Learnings:
- When friction worth remembering appears, emit an inline tag exactly as `<learning>[Friction Type] note</learning>`.
- Use Title Case bracket prefixes (for example `[PRD Misinformation]`, `[Scope Drift]`, `[Tooling Friction]`).
- If no existing type fits, invent a new Friction Type bracket.
- Emit zero or many learning tags as needed; do not emit empty filler tags.
