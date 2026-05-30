# PRD — Agentic Image App (MooshieUI)

Date: 2026-05-30
Status: Ready for agent
Source: grill-with-docs session; design at
`2026-05-30-agentic-image-app-frontend-design.md`; ADRs 0001–0004.

## Problem Statement

The Operator produces anime imagery on ComfyUI through MooshieUI's Control Panel.
Even consolidated, that surface is form-driven: every job is hand-tuned knob by
knob, exploration is slow, and bulk work (rosters, sweeps) is punishing. A generic
chat client (Claude Desktop) could capture intent conversationally but can't render
the visual board and domain controls image work needs; MooshieUI has the controls
but no conversational leverage. The Operator wants to state a high-level goal in
natural language, have the system run the multi-step pipeline, and refine on a
board of results — without giving up the precise knobs (characters, LoRAs, styles,
mask editing) when they want them.

## Solution

A dual-surface agentic desktop app, built into MooshieUI as the sole front-end. The
Operator opens a **Session** (like a new ChatGPT chat) and states intent. The
**Agent** interprets it (asking back when unclear) and emits a **Generation Spec** —
the single source of truth for the job. Both the chat and the **Control Panel**
mutate that one Spec, so the Operator can drop from a sentence to a slider and back
without losing state. Generations stream previews onto a **Result board**; the
Operator refines conversationally ("再来4张", "like #3 but warmer", "fix the hand"),
each refine referencing a prior **Result**. The Agent scores Results (judgment
only); a **Human Gate** policy decides delivery, and can be relaxed so large runs
proceed unattended. Generation runs on MooshieUI's existing Rust ComfyUI backbone;
**Workflows** are the built-in Rust templates today and importable user ComfyUI
presets later.

## User Stories

### Sessions & intent
1. As an Operator, I want to open a new Session like a new chat, so that each piece of work has its own conversation and board with fresh Agent context.
2. As an Operator, I want to reopen a past Session, so that I can resume or reference earlier work.
3. As an Operator, I want to state a high-level goal in natural language, so that I don't have to set every knob by hand.
4. As an Operator, I want the Agent to ask me clarifying questions when my intent is ambiguous, so that it doesn't guess wrong.
5. As an Operator, I want the Agent to turn my message into a Generation Spec, so that there is one concrete, reviewable plan of execution.
6. As an Operator, I want to see the Agent's tokens stream as it responds, so that I get immediate feedback.

### Dual surface (chat + Control Panel)
7. As an Operator, I want the Control Panel to always reflect the current Spec, so that chat-driven changes show up as editable forms.
8. As an Operator, I want my direct edits in the Control Panel to update the same Spec, so that the Agent sees what I changed.
9. As an Operator, I want to switch between chatting and adjusting sliders mid-job, so that I never lose state moving between surfaces.
10. As an Operator, I want to drop an image into chat as a reference, so that I can drive img2img or supply a pose.

### Pipeline Profiles
11. As an Operator, I want to load a Pipeline Profile, so that a job starts from a known-good model/LoRA/sampler baseline.
12. As an Operator, I want the Agent to pick a matching Profile from my intent ("fanart style"), so that I don't have to name it explicitly.
13. As an Operator, I want to save the reusable subset of my current Spec back as a Profile, so that I can reuse a setup I just dialed in.
14. As an Operator, I want per-job fields (cast, composition, seed) kept off the Profile, so that Profiles stay reusable and transient details don't leak in.

### Cast & composition
15. As an Operator, I want to put one character in a frame, so that I can generate a single subject.
16. As an Operator, I want to put multiple characters in one frame, each with their own LoRA and spatial region, so that multi-character scenes are controlled.
17. As an Operator, I want a shared scene/style/negative context separate from the cast, so that scene direction doesn't get tangled with who's in frame.

### Generation & streaming
18. As an Operator, I want to generate from either chat or the Generate button, so that both surfaces can drive execution.
19. As an Operator, I want live WebSocket previews routed to the active Result card, so that I can watch a generation form.
20. As an Operator, I want every generation to honour the resolved Spec exactly, so that what I see is what I specified.

### Result board, refine, edit
21. As an Operator, I want generated images to appear as cards on a Result board, so that I can compare and act on them.
22. As an Operator, I want to ask for variations ("再来4张"), so that I can explore around a result.
23. As an Operator, I want to say "like #3 but warmer", so that a new Spec inherits #3 and applies my delta.
24. As an Operator, I want to fix a bad hand by mask, so that I can repair a result without regenerating from scratch.
25. As an Operator, I want fix-hand to reuse the same mask editor and face-fix machinery, so that edit and refine are one consistent operation.
26. As an Operator, I want to promote a preview to a full-quality render with the seed pinned, so that I can commit to a good exploration.
27. As an Operator, I want refines to reference a Result, never a bare image, so that provenance and reproducibility hold.

### Judge & Human Gate
28. As an Operator, I want the Agent to score each Result (accept/refine/reject + scores), so that obvious failures and winners are flagged for me.
29. As an Operator, I want to approve or regenerate from the board, so that I stay the final authority on delivery.
30. As an Operator, I want to choose a gate policy per run (per-iteration, per-batch, or none), so that I control how closely I supervise.
31. As an Operator, I want to kick off an overnight run that auto-accepts above a threshold and delivers unattended, so that bulk work happens while I sleep.
32. As an Operator, I want a post-hoc spot-check surface for unattended runs, so that I can review what shipped the next morning.
33. As an Operator, I want the Agent to never drive the loop itself, so that a local model's unreliability can't run away.

### Fan-out (sweeps & rosters)
34. As an Operator, I want to vary seed across a batch, so that I can explore variations of one idea.
35. As an Operator, I want to fan out across a roster of characters (50 × 4), so that I can produce a large set from one instruction.
36. As an Operator, I want fan-out to emit one Spec per item, so that cast and fan-out stay distinct concepts.
37. As an Operator, I want roster runs gated per-batch, so that I approve in bulk rather than per image.
38. As an Operator, I want execution ordered to minimise ComfyUI model reloads, so that a multi-Profile run doesn't thrash checkpoints.
39. As an Operator, I want partial failures in a big run handled gracefully, so that one bad item doesn't sink the batch.

### Workflows & user presets
40. As an Operator, I want generation to use the proven built-in Workflows, so that Anima split-model VAE handling, per-architecture defaults, and the face-fix chain just work.
41. As an Operator, I want to import my own ComfyUI preset as a Workflow, so that I can run custom graphs the built-ins don't cover.
42. As an Operator, I want to declare injectable points in my preset with `@slot:` node titles, so that the app knows where to inject prompt/checkpoint/seed/LoRAs.
43. As an Operator, I want built-in and imported Workflows to live in one registry, so that the Agent and Profiles can select from a single catalog.
44. As an Operator, I want a Profile to select which Workflow it uses, so that "which graph + filled-in knobs" is one saved unit.

### Reproducibility
45. As an Operator, I want the Result embedded in each saved PNG, so that any image re-opens as a fully reproducible Result.
46. As an Operator, I want to re-open an old image into a new Session, so that I can iterate on past work with full fidelity.

### Configuration
47. As an Operator, I want the Agent runtime base URL configurable (default `llm.lif.home`), so that I can swap to a cloud model with no architecture change.
48. As an Operator, I want every Spec the Agent emits validated before it can run, so that malformed plans fail loud and re-prompt instead of producing garbage.

## Implementation Decisions

### Store inversion (Phase 1)
- The **Generation Spec** is the single source of truth. MooshieUI's flat
  generation store becomes a **projection** of the Spec, not the owner of state.
- The relationship is **superset, not 1:1** (validated by spike, branch
  `spike/store-inversion-txt2img`): the store represents the per-image, single-cast
  slice; `cast`/`fanout`/`accept` live above it in the Agent/orchestrator layer.
- The assembly seam is the store's existing params-building step; the inversion
  introduces a Spec type + projection rather than rewriting ~70 state fields.
- The spike's field-coverage finding stands: of 64 param fields, 16 are
  orchestration-clean, 4 are inputs, 44 are template-level **pipeline** knobs.

### Request/resolved Spec split
- Two Spec shapes: **request Spec** (thin — `subject`/`cast`/`sampling` + a Pipeline
  Profile reference + sparse overrides) is what the Agent emits; **resolved Spec**
  (fat — includes the 44-field `pipeline` block) is what the Control Panel binds to
  and what executes.
- A deterministic **merge** expands request → resolved: Profile defaults overlaid
  by the sparse request. This is the grounding + assembly step in app code.
- Both shapes are owned by MooshieUI — no shared cross-repo contract (ADR 0004).

### Modules to build/modify
- **Spec core** (deep, pure): request/resolved Spec types, store↔Spec projection,
  and the Profile-defaults ← sparse-request merge. Interface: `specFromFields`,
  `fieldsFromSpec`, `mergeIntoResolved(profileDefaults, request)`.
- **Spec→params assembler** (deep, pure): resolved Spec → neutral resolved
  slot-values → ComfyUI params. Neutral values keep the door open for the future
  preset slot-injector; built-ins consume them via the Rust template builders.
- **Workflow registry** (deep): catalog of Workflows, each with `@slot:` slot
  declarations. Built-in Rust Workflows registered now; `@slot:` parsing modelled
  now; preset importer + slot-injector deferred (ADR 0003).
- **Spec validation** (deep, pure): JSON-schema validation of every Agent-emitted
  Spec; invalid → fail loud + re-prompt.
- **Pipeline Profile store** (modify/new): save/load Profiles (per-profile params +
  Workflow selection); seed a Spec; save a Spec's reusable subset as a Profile.
- **Generation store** (modify): re-bind to project from the resolved Spec.
- **Agent runtime client** (Rust): `reqwest` streaming OpenAI-compatible
  `POST /v1/chat/completions` to a configurable base URL (default `llm.lif.home`),
  tokens fanned to the chat panel over the existing IPC/SSE path. API key optional.
- **Agent orchestrator** (deterministic): owns fan-out, retry budget, gate
  batching, and Workflow-batched execution ordering. The model never drives it
  (ADR 0002).
- **Chat panel** (Svelte, net-new): conversation thread, refine/clarify, image drop.
- **Result board** (extend gallery/canvas): Result cards, live preview routing,
  human-gate actions.

### Agent behaviour (ADR 0002)
- The Agent does exactly three structured-output jobs: intent→request Spec,
  refine→Spec-delta (with `parent` Result ref), and Result verdict (judge).
- Minimal tool surface: `query_registry(kind, q)` over
  characters/loras/styles/profiles, `set_spec`, `submit`, `judge`.
- Autonomy is a **Human Gate** policy (`per_iteration | per_batch | none`), never
  agent orchestration. Local-model guardrails: constrained JSON, one decision per
  call, schema validation before any run.

### Result contract
- A **Result** carries the resolved Spec, the effective seed, scores, and a verdict,
  with a handle to its image. It is embedded in the output PNG so any image
  re-opens as a Result. Refines reference a Result via `parent`.

### Cast vs fan-out (orchestration F1)
- **Cast** = who is in each frame (per-character prompt override, per-character
  LoRA, spatial region). **Fan-out** = what varies across emitted images
  (seed/character/outfit/grid); a roster fans out over characters and emits one
  request Spec per character.

### Execution
- Single backbone: MooshieUI's Rust ComfyUI client + template builders (MCP retired,
  ADR 0004). Built-in Workflows preserve Anima split-model VAE selection,
  per-architecture sampler/CFG defaults, and the face-fix detailer chain.

## Testing Decisions

Per the module check, automated tests cover **Spec core (projection + merge)** only.

- **What makes a good test here:** assert external behaviour, not internal shape.
  For Spec core that means: (a) a resolved Spec round-trips losslessly through the
  store projection (`fieldsFromSpec(specFromFields(f))` deep-equals `f`), and (b)
  the merge produces the correct resolved Spec from Profile defaults + a sparse
  request (defaults applied where the request is silent; overrides win where the
  request speaks; transient fields never leak into a saved Profile). Tests assert on
  resulting Spec/field values, never on private helpers.
- **Module under test:** Spec core — the projection and the merge. These are pure
  and rune-free by construction, so they test without the Svelte runtime.
- **Prior art:** the spike already proved the projection round-trip with Node's
  built-in `node --test` runner and Node 25 native type-stripping — zero added
  dependencies. The production tests extend that exact pattern (add merge cases:
  empty request, full override, partial override, transient-field exclusion).
- **Explicitly not unit-tested** (per the user's choice): the Spec→params
  assembler, the Workflow registry/`@slot:` parsing, and Spec validation. These are
  exercised through behaviour during their phases, not via isolated tests in this
  PRD.

## Out of Scope

- **Video generation** — image + edit only for v1.
- **Distribution / hosting** — internal, single-Operator use; AGPL network-copyleft
  never triggers (revisit only if distribution is considered).
- **Other front-ends / MCP** — MooshieUI is the sole front-end; Claude Desktop,
  Hermes, and `comfyui-mcp-server` are retired (ADR 0004). No shared Spec contract.
- **Heavyweight workflow resolver service** — a Pipeline Profile is the defaults
  carrier; only a *lightweight* slot-declaration registry is in scope.
- **The full check funnel for v1** — v1 judging is a VLM-judge-on-crops verdict +
  the Human Gate; detector / preference-rank / identity-filter stages are deferred
  (detectors degrade on anime art).
- **Node-type slot inference** — slots are declared explicitly with `@slot:` tags;
  inference is a possible later convenience.
- **The preset importer + slot-injector** — the Workflow abstraction and `@slot:`
  model are designed now (Phase 2) but the importer ships later (Phase 7); v1 runs
  on the built-in Rust Workflows.

## Further Notes

- Phasing (the build order this PRD spans): (1) store inversion, (2) core lib —
  Spec/Result types + validation + Workflow registry + `@slot:` model, (3) Agent
  panel doing intent→Spec, (4) refine loop + Result board, (5) judge + Human Gate,
  (6) fan-out (sweeps/roster) + Workflow-batched execution, (7) user ComfyUI preset
  importer.
- The store inversion is de-risked: the spike (branch
  `spike/store-inversion-txt2img`) proved the single-cast slice round-trips
  losslessly and is the shape Phase 1 promotes to production.
- A Session maps to a chat thread (ChatGPT model): new chat = new Session, with its
  own board and Agent context; `parent` refines resolve against the current
  Session's Results by default.
- Glossary terms used here are defined in `CONTEXT.md` (Generation Spec, Result,
  Workflow, Pipeline Profile, Agent, Human Gate, Operator, Control Panel, Session).
- Decisions of record: ADR 0001 (modular-extension fork), 0002 (agent
  judgment-only; autonomy = gate policy), 0003 (workflow slot-injection over
  built-in + user presets), 0004 (MooshieUI sole front-end; MCP retired).
