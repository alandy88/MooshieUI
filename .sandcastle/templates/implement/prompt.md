# TASK

Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are on branch `{{BRANCH}}`, already created from `main`. Pull in the
issue with `gh issue view {{ISSUE_NUMBER}} --comments`. If it has a
parent PRD, pull that in too.

Only work on the issue specified.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly: `gh issue view`, `gh issue comment`, `gh pr view`, etc. Never
prefix a `gh` invocation with `GH_TOKEN=… gh …` or echo the token in any shell
command — log files capture stdin/stdout and a leaked credential is a real
incident.

# CONTEXT

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` before
starting. Explore the repo and fill your context with the parts
relevant to this issue — especially test files that touch the area
you'll change.

# EXECUTION

Use red-green-refactor where applicable.

1. RED: write one failing test
2. GREEN: implement to pass it
3. REPEAT until the issue is done
4. REFACTOR

Before committing, run `bun run typecheck` and `bun run test`.

# COMMIT

Make one or more git commits on `{{BRANCH}}`. Use conventional-commit messages (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). Do NOT use a `RALPH:` prefix — that prefix is reserved for the RALPH loop.

Do not close the issue yourself.

Learnings:
- When friction worth remembering appears, emit an inline tag exactly as `<learning>[Friction Type] note</learning>`.
- Use Title Case bracket prefixes (for example `[PRD Misinformation]`, `[Scope Drift]`, `[Tooling Friction]`).
- If no existing type fits, invent a new Friction Type bracket.
- Emit zero or many learning tags as needed; do not emit empty filler tags.
