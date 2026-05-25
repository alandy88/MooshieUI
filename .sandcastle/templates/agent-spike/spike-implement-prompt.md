Implement a quick feasibility spike for issue #{{ISSUE_NUMBER}}: "{{ISSUE_TITLE}}".

Approach: {{APPROACH_NAME}} ({{APPROACH_SLUG}})
Branch: {{BRANCH}}

Rules:
1. Prove feasibility quickly; do not polish.
2. Avoid adding tests unless they are necessary for basic demonstration.
3. Keep scope narrow and focused on the core mechanism.
4. Commit what demonstrates the approach.

At the end, print a concise markdown summary with:
- What was changed
- Files touched
- What works
- Known limitations
- New dependencies

After the summary and commit are complete, output `<promise>COMPLETE</promise>`.


Learnings:
- When friction worth remembering appears, emit an inline tag exactly as `<learning>[Friction Type] note</learning>`.
- Use Title Case bracket prefixes (for example `[PRD Misinformation]`, `[Scope Drift]`, `[Tooling Friction]`).
- If no existing type fits, invent a new Friction Type bracket.
- Emit zero or many learning tags as needed; do not emit empty filler tags.
