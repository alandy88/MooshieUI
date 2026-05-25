# TASK

Process branches sequentially and create one GitHub PR per issue. Do not merge branches locally into the current branch.

Target branch is always `main`.

Issue/branch context:

{{ISSUE_BRANCHES}}

## Per-branch loop

For each `#<N> | <issue title> | <branch>` entry above, in order:

1. `git checkout <branch>`
2. `git fetch origin main && git merge origin/main --no-edit`
3. Run `bun run typecheck && bun run test`
4. Push: `git push -u origin <branch>`
5. Open PR:
   - `gh pr create --base main --title "<issue title>" --body "Closes #<N>\n\n<one-line summary>"`
6. Merge PR:
   - `gh pr merge --squash --delete-branch`
7. Local cleanup for successful merge:
   - remove any worktree for `<branch>` if present
   - `git branch -D <branch>`

## BLOCK path (conflict or validation failure)

If merge-from-main conflict cannot be resolved cleanly, or `bun run typecheck && bun run test` fails:

1. Preserve work: `git push -u origin <branch>` (or `git push origin <branch>` if upstream already exists)
2. Open PR to `main` with failure context in body (do not merge)
3. Relabel issue:
   - `gh issue edit <N> --remove-label ready-for-agent --add-label swarm-blocked`
4. Add failure detail comment on the blocked PR:
   - `gh pr comment <PR_NUMBER> --body "<failure detail and next fix hint>"`
5. Keep local branch/worktree for follow-up and continue to next branch

A blocked branch must not abort the full merge phase.

## Closing behavior

- Implementation issues should close via the PR body `Closes #<N>` when squash-merged.
- After processing all branches, explicitly close any parent PRD issue whose last open child was just merged.

When all branches are processed, output `<promise>COMPLETE</promise>`.


Learnings:
- When friction worth remembering appears, emit an inline tag exactly as `<learning>[Friction Type] note</learning>`.
- Use Title Case bracket prefixes (for example `[PRD Misinformation]`, `[Scope Drift]`, `[Tooling Friction]`).
- If no existing type fits, invent a new Friction Type bracket.
- Emit zero or many learning tags as needed; do not emit empty filler tags.
