## Stack

- **Frontend:** Svelte 5, Tailwind CSS v4, TypeScript, Vite
- **Desktop:** Tauri v2 (Rust backend, WebView frontend)
- **Canvas:** Konva / svelte-konva for node editor
- **Package manager:** bun (frozen lockfile in CI/sandbox)

## Conventions

- Svelte 5 runes (`$state`, `$derived`, `$effect`) — no legacy `$:` reactive declarations.
- Components use `<script lang="ts">` with typed props via `let { prop }: { prop: Type } = $props()`.
- Prefer `$derived` over `$effect` for computed values.
- Tailwind utility classes directly in markup — no `@apply` in component styles.
- TypeScript strict mode. No `any` unless interfacing with untyped external APIs.
- File names: kebab-case for components (`node-editor.svelte`), camelCase for utilities.
- Imports: use `$lib/` alias for `src/lib/`.

## Testing

- Tests verify behavior through public interfaces, not implementation details.
- No mocking internal collaborators — mock at system boundaries only.
- TDD vertical slices: RED → GREEN one test at a time, not all tests first.

## Code Quality

- No unnecessary comments — well-named identifiers speak for themselves.
- Prefer explicit code over clever one-liners.
- No nested ternaries — use if/else or switch.
- Functions should return results, not produce side effects where possible.
- Deep modules: small interface, deep implementation.

## Commits

- Conventional-commit style: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.
- Do NOT use `RALPH:` prefix in standalone workflow commits — that prefix is reserved for the swarm loop.
