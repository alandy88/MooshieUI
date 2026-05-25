# TASK

You are running the architecture-review pass. Find one fresh deepening
opportunity in this codebase and propose it as a PRD.

This is an unattended run. There is no user to question. Your job is:

1. List prior proposals labelled `source:architecture-review` (open and
   closed) so you don't re-propose them.
2. Explore the codebase.
3. Pick **one** top candidate.
4. Emit a structured `<output>` block describing the proposed PRD.

# CREDENTIALS

`gh` is already authenticated in this sandbox via the `GH_TOKEN` env var. Call
it directly. Never prefix a `gh` invocation with `GH_TOKEN=… gh …` or echo the
token in any shell command.

# CONTEXT

Read `CONTEXT.md` and any relevant ADRs under `docs/adr/` before proposing
anything. Treat ADRs as binding — do not propose changes that contradict a
recorded decision.

# METHODOLOGY

1. **Scan for duplication, tight coupling, and unclear boundaries.** Look for
   modules that know too much about each other, repeated patterns that
   suggest a missing abstraction, or concepts used inconsistently.

2. **Apply the deletion test.** For each candidate, ask: "If I deleted this
   module, how many other files would break?" High fan-in + complex
   interface = good deepening target.

3. **Prefer deepening over widening.** A better interface to an existing
   module beats a new module. Consolidation beats proliferation.

4. **Check the glossary.** Use the project's terminology from `CONTEXT.md`.
   Don't introduce new terms when existing ones fit.

# RULES

- Read-only on the repo. No commits. No edits to source files.
- One PRD per run.
- If every reasonable candidate is already covered by a prior
  `source:architecture-review` proposal, emit a `skipped` output.
- No questions to a user — there is none.

# OUTPUT

End your response with a single `<output>` block.

## Proposed

<output>
{
  "status": "proposed",
  "title": "Short imperative title for the PRD issue",
  "body": "Full PRD body in markdown. Include: Problem, Proposed Solution, Acceptance Criteria, and any relevant context.",
  "oneLineSummary": "One sentence describing the deepening opportunity.",
  "candidatesConsidered": ["candidate A description", "candidate B description"]
}
</output>

## Skipped (no fresh candidates)

<output>
{
  "status": "skipped",
  "reason": "All reasonable candidates are covered by existing proposals."
}
</output>
