# Agentic Image App — Frontend / Client Architecture

Date: 2026-05-30
Status: Draft

## Goal

Build a custom **dual-surface (chat + canvas) agentic desktop app** for LIF image
generation, by **forking MooshieUI** (`D:\Git\MooshieUI`) as the substrate and
adding an agent layer. The agent (an OpenAI-compatible LLM, initially local on
`llm.lif.home`) captures intent and judges output; a visual canvas of Results
gives direct manipulation. Both surfaces mutate one shared Generation Spec.

UX north star: the **agent mode of 即梦 (Jimeng)** — state a high-level goal, the
agent runs the multi-step pipeline, refine conversationally on a board of results.
Power-user delta over Jimeng: precise knobs (characters, LoRAs, styles, mask
editing) backed by the LIF asset registry, on the *same* underlying Spec.

This is the spec for **MooshieUI as the sole front-end**. The Generation Spec, the
Result, the check funnel, and the Asset Registry concepts originate in the
orchestration design (lif-studio repo,
`docs/superpowers/specs/2026-05-30-agentic-image-generation-flow-design.md`), but
MooshieUI now **owns** them — there are no other front-ends to share a contract
with. That document is a design reference, not a governing contract.

## Why now (the directional change)

ComfyUI use-cases alone did not justify a custom UI — MooshieUI-style forms over
a node graph were a marginal gain. **The agent changes the economics:** it
supplies conversational leverage (exploration, bulk, refine) that a form UI
cannot, and a generic chat client (Claude Desktop) cannot render the visual
canvas + domain controls image work needs. The custom app is the only surface
that delivers *both* — leverage and knobs — which is exactly the gap between the
two references.

## Decisions locked

- **Fork MooshieUI** (not rebuild, not extract-backend). Rationale below.
- **License is a non-issue** — internal/personal use only; AGPL-3.0 network
  copyleft never triggers. Revisit only if distribution is ever considered.
- **Agent runtime is OpenAI-compatible, embedded, configurable base URL.**
  Default `llm.lif.home` (local llama-swap; Qwen3.6-27B / Gemma-4-31B). Swappable
  to a cloud model with no architecture change. Implemented Rust-side (`reqwest`,
  already a dep) streaming to the chat panel via the existing IPC/SSE fan-out.
- **Hybrid chat + canvas; the Generation Spec is the single source of truth.**
  Chat mutates it (intent → Spec, refine → Spec-delta); forms mutate it (direct
  edits). Both submit through the same `execute()`. MooshieUI's form-state stores
  become **projections of the Spec**, not the source of truth.
- **Model for judgment only (CLAUDE.md rule 5), reinforced for local LLMs.** The
  agent does NL→Spec, Spec-delta, and judge verdicts — all structured output. No
  long autonomous tool loop. Fan-out, retry, and gating are deterministic app
  code. This is what makes a 27–31B local model viable.
- **One `execute()` backbone — MooshieUI's Rust ComfyUI client + templates.**
  MooshieUI is the *only* front-end (Claude Desktop, Hermes, and
  `comfyui-mcp-server` are retired from this design). The Svelte UI and the agent
  both go through the same Rust `execute()`; bulk runs on MooshieUI's own fan-out
  orchestrator over that same path. Spec/Result/check/registry logic lives in an
  internal core library (testable, never in the Svelte UI).

## Build strategy — recommendation: FORK

| Option | Inherits | Cost | Verdict |
|---|---|---|---|
| **Fork MooshieUI** | shell, Rust `comfyui/` client, WS streaming, `templates/` (txt2img/img2img/inpaint/upscale/**facefix**/controlnet), JXL gallery, **Konva mask editor**, Compare/XYZ grid, model hub, Danbooru/Anima tag DBs, i18n | adapt form-stores → Spec projections; learn its IPC/store conventions; no test framework to lean on | **Chosen** |
| Reference, fresh build | nothing (clean Spec/Result architecture) | reimplement streaming/templates/gallery/canvas — months | rejected: throws away ~70% already built |
| Extract Rust backend + new UI | Rust client + templates | rebuild all UI; still AGPL on extracted Rust | rejected: UI is the cheap part to keep, not rebuild |

**Why fork wins here specifically:** the AGPL downside is moot (internal-only),
and MooshieUI already implements the *deterministic* half of the backend spec
(stages ③④⑦, partial ⑤ via `MooshieFaceFix`, and edit-by-mask via the Konva
editor) for the *exact* stack (ComfyUI + Anima/Illustrious + Danbooru tags). It
even shares the sandcastle/superpowers toolchain. The only thing missing is the
agentic brain — which is the net-new work regardless of strategy.

**The one real adaptation cost:** MooshieUI is architected so its Svelte singleton
stores *are* the param form (source of truth). We invert that — the **Spec** is
the source of truth, and the stores become reactive projections that both the
chat agent and the forms read/write. This is the main refactor and the main risk.

Reading the actual `generation.svelte.ts` (a ~70-field flat singleton) sharpens
the shape of that risk. The store is **not** "the Spec minus its projections" — it
is a **lower-altitude, single-image, single-cast projection** of the Spec, and the
Spec is a strict **superset**. Three Spec concepts have *no* home in the store and
should not gain one — they belong to the agent/orchestrator layer *above* it:

| Spec concept | Store today | Where it lives post-fork |
|---|---|---|
| `cast[]` (per-char prompt + LoRA + region) | flattened into `positivePrompt` text + global `loras[]` | above the store (agent grounds it, then projects one cast slice down) |
| `fanout` (axis / over / count) | only `batchSize` | orchestrator |
| `accept` (checks / gate / retry) | absent | orchestrator + check funnel |

The store projects only the per-image, single-cast slice. That makes the inversion
far more contained than "rewrite the stores": the real seam is **`toParams()`**,
which already performs deterministic Spec-style assembly (quality tags by detected
architecture, style/preset injection). The inversion is introducing a `Spec` type
and a `specToParams(spec)` assembler alongside it — not rewriting ~70 `$state`
fields. The residual risk moves from "huge refactor" to a **mapping question**:
the Spec→store projection is lossy by design (it drops cast-regions, fan-out, and
accept-policy), so the spike must prove the *single-cast* slice round-trips losslessly.

## Architecture

### Layered view (what's inherited vs net-new)

```
┌─ NET-NEW: Agentic layer ────────────────────────────────────────────────┐
│  Chat panel (token stream)   Intent→Spec │ Spec-delta │ Judge verdicts    │
│  Orchestrator (deterministic): fan-out, retry budget, gate policy         │
│  Agent runtime: OpenAI-compatible client → llm.lif.home (configurable)    │
├─ SHARED CORE LIB (no UI) ────────────────────────────────────────────────┤
│  Generation Spec + Result contracts │ check funnel │ Asset Registry access │
├─ INHERITED from MooshieUI (the substrate) ───────────────────────────────┤
│  Spec→API JSON templates │ Rust ComfyUI client + WS │ gallery │ mask editor │
│  model hub │ tag DBs │ compare grid │ i18n │ Tauri shell (desktop+browser) │
└──────────────────────────────────────────────────────────────────────────┘
```

### The dual-surface principle (core idea)

```
        ┌──────────────── Generation Spec (single source of truth) ───────────────┐
        │                                                                          │
   ┌────┴─────┐                                                          ┌─────────┴────────┐
   │   CHAT   │  intent→Spec, refine→Spec-delta                          │   FORMS / CANVAS │  direct edits
   │  (agent) │ ───────────────────────────────►  SPEC  ◄─────────────── │ (MooshieUI knobs)│
   └──────────┘                                    │                     └──────────────────┘
                                                   ▼
                                            execute() (Rust ComfyUI)
                                                   │
                                                   ▼  WS previews + Result
                                            CANVAS / BOARD of Results ──► judge ──► human gate
```

Either surface can drive a generation; both read back the same Spec so they never
diverge. Drop from chat to a slider and back without losing state.

### Proposed UI layout (hybrid)

```
┌───────────────┬──────────────────────────────────────┬──────────────────┐
│  CHAT         │   CANVAS / RESULT BOARD              │  SPEC INSPECTOR   │
│  (agent       │   - grid of Results (cards)         │  (the live Spec   │
│   thread,     │   - select → lightbox / mask edit   │   as editable     │
│   refine,     │   - variations / upscale / fix-hand │   forms: cast,    │
│   clarify)    │   - compare/XYZ grid                 │   model, loras,   │
│               │   - live WS preview while running    │   sampling,       │
│  drop images  │                                      │   accept/checks)  │
│  for ref/i2i  │   [human gate: approve / regen]      │                   │
└───────────────┴──────────────────────────────────────┴──────────────────┘
```
The right panel is MooshieUI's existing three-panel controls, re-bound to the
Spec. The left panel is net-new. The center is MooshieUI's gallery + canvas,
extended with the Result board and human-gate actions.

### Agent runtime (OpenAI-compatible, embedded)

- **Client:** Rust-side, `reqwest` streaming `POST /v1/chat/completions` to a
  configurable base URL (default `http://llm.lif.home/...`). Tokens streamed to
  the chat panel via existing `ipcListen` SSE fan-out. API-key optional (LAN).
- **The model's three jobs (structured output, not a loop):**
  1. **Intent → Spec** — user message + registry context → a Generation Spec
     (JSON-schema-constrained / function-call response).
  2. **Refine → Spec-delta** — "warmer lighting", "different pose", "再来4张" →
     a patch against the current Spec (+ `parent` ref when editing a Result).
  3. **Judge** — a Result + its Spec → a verdict `{accepted|refine|reject}` +
     scores, feeding the check funnel.
- **Tool surface (kept minimal for local-model reliability):**
  `query_registry(kind, q)` (characters/loras/styles/profiles),
  `set_spec(spec)`, `submit()`, `judge(result_id)`. Everything else — fan-out,
  retries, gate batching — is deterministic orchestrator code the model never
  drives.
- **Local-model guardrails:** constrained/JSON output, small tool set, one
  decision per call, deterministic validation of every Spec the model emits
  against the schema before it can run (fail loud, re-prompt on invalid).

### Spec representations: request vs resolved

The Spec exists in two shapes, mirroring the orchestration spec's request **Spec**
vs `Result.resolved_spec`:

- **Request Spec** (thin) — what the agent emits and what is transmitted/persisted:
  `subject` / `cast` / `sampling` + a **Pipeline Profile** reference + *sparse*
  overrides. Small enough for a 27–31B model to emit reliably (the whole point of
  the split).
- **Resolved Spec** (fat) — what the Control Panel binds to and what executes: the
  request merged onto the selected Profile's defaults, including the 44-field
  `pipeline` block (upscale/facefix/controlnet/split-model/output/quality). This is
  the spike's shape and the single source of truth at run time.

A deterministic **merge** (Profile defaults ← sparse request) is the whole
expansion — the orchestration spec's grounding (②) + assembly (③), done in app
code. **No workflow registry or resolver service is built in the client:** a
Pipeline Profile *is* the named bundle of pipeline defaults, so it plays the role
the orchestration spec's workflow-registry plays for the headless siblings.
Sequencing: until the agent panel lands (Phase 3), request ≡ resolved (no
overrides, no merge) — the spike's resolved shape works today.

### Workflows: built-in builders + user presets

A **Workflow** is the ComfyUI graph for one operation, with injectable slots a
resolved Spec fills. Two origins coexist (see ADR 0003):

- **Built-in Workflows** — today's Rust `templates/` builders (txt2img, img2img,
  inpaint, upscale, facefix, controlnet). They keep the hard-won correctness a raw
  graph lacks: Anima split-model VAE selection (the 16-channel-latent decode
  crash), per-architecture sampler/CFG defaults, the facefix detailer chain. These
  are the v1 path.
- **User ComfyUI presets** — imported ComfyUI API-format graphs. The Operator
  declares injectable points with explicit **`@slot:` title tags** on nodes
  (`@slot:positive_prompt`, `@slot:checkpoint`, `@slot:seed`, …). Deterministic; no
  node-type inference.

Both register in a **lightweight Workflow registry**: a catalog of Workflows, each
with its slot declarations. The Profile/agent selects from it — that is *all* the
registry does (no resolver service; the Pipeline Profile still carries defaults).

**Assembly seam (keeps both paths open):** `specToParams` produces *neutral
resolved slot-values*; a final injector consumes them — the Rust builder for
built-ins, a slot-injector for user presets. The Spec→values rules are
path-neutral; only the last injection step differs.

**Sequencing — design-now, build-later:** v1 ships on the built-in Workflows; the
Workflow abstraction + `@slot:` model is designed now so nothing hardcodes the Rust
path. The preset importer + slot-injector land in a later phase.

### Execution & streaming (inherited, lightly extended)

- `execute(prompt_json)` = MooshieUI's Rust ComfyUI client + `templates/`
  builders. Assembly (Spec → API JSON) extends the existing template builders to
  consume the Spec's `cast`/`edit`/`fanout` fields.
- WS previews already stream to the UI; route them to the active Result card.
- PNG metadata embed already exists; extend it to embed the **Result**
  (`resolved_spec` + effective seed) so any image is reproducible/re-openable —
  this realises the Result contract's persistence requirement for free.

## Non-Goals

- Other front-ends — MooshieUI is the sole front-end; Claude Desktop, Hermes, and
  `comfyui-mcp-server` are out (retired from this design). No shared Spec contract.
- Distribution/hosting (would re-open the AGPL question) — internal use only.
- Video generation (Jimeng does it; out of scope for v1 — image + edit only).
- A long autonomous agent loop — the model does bounded judgment, not orchestration.
- The full check funnel for v1 — detectors / preference-rank / identity-filter are
  deferred; v1 is VLM-judge-on-crops + human gate (see Phase 5).
- A heavyweight workflow *resolver service* in the client — the **Pipeline Profile**
  is the defaults carrier. (A *lightweight* Workflow registry — a catalog of
  built-in + user-preset Workflows with slot declarations — **is** in scope; the
  orchestration spec's heavier registry stays with the headless siblings.)

## Risks / open questions

1. **Store inversion** (Spec as source of truth vs MooshieUI's form-state stores)
   is the main refactor — scope a spike before committing the full fork. The
   relationship is **superset, not 1:1**: the Spec's `cast`/`fanout`/`accept` stay
   *above* the store; the store projects only the per-image single-cast slice, and
   `toParams()` is the (already deterministic) assembly seam. This shrinks the
   refactor but surfaces a mapping risk — the Spec→store projection is lossy by
   design, so the open sub-question is whether the single-cast slice round-trips
   losslessly. Phase 1 is scoped to answer exactly that.
2. **Local-model tool-calling reliability** for Intent→Spec on 27–31B models —
   needs an eval; fallback is a tighter, more templated Spec-builder prompt.
3. **Execution paths** — *moot.* MCP is retired; MooshieUI's Rust `execute()` is the
   only backbone (interactive + bulk). `specToParams` targets it directly; no shared
   assembler, no cross-backbone drift.
4. **No test framework in MooshieUI** — agent/Spec logic needs one added
   (the shared core lib should be testable independent of the UI).
5. **Outer orchestrator** (roster batching, partial-failure, human-gate at scale,
   Workflow-batched execution to minimise ComfyUI model reloads) is under-specified
   — and now MooshieUI's to define (Phase 6), since there's no separate backend.

## Phasing (how it comes to life)

1. **Spike — store inversion.** In a fork branch, make one generation mode
   (txt2img) read/write a minimal `Spec` (`subject` + `model` + `sampling` + a
   single-element `cast`) instead of the store owning that state. Concretely:
   define the `Spec` type, write `specToParams(spec)` beside the existing
   `toParams()` (the seam), and bind the txt2img form to a `Spec` that projects
   into the store. **Success = the txt2img form round-trips through a `Spec`
   producing byte-identical `toParams()` output**, proving the single-cast
   projection is lossless. Validates the main risk cheaply. (No agent yet.)
2. **Core lib.** Extract Spec/Result types + schema validation + the Workflow
   abstraction (lightweight registry + `@slot:` model) + registry access into an
   internal, testable module (decoupled from the Svelte UI).
3. **Agent panel — Intent→Spec.** Add the chat panel + OpenAI-compatible Rust
   client → `llm.lif.home`; one round trip producing a valid Spec that fills the
   forms. Human presses Generate.
4. **Refine loop + Result board.** Spec-delta from chat; Results as cards;
   parent-referenced edits (fix-hand reuses the Konva mask editor + `MooshieFaceFix`).
5. **Judge + human gate.** Wire a **minimal** funnel for v1 — a VLM-judge-on-crops
   verdict + the human gate. Defer the detector / preference-rank / identity-filter
   stages (the orchestration spec itself notes detectors degrade on anime) until
   the need is felt. Approve / regen actions on the board.
6. **Fan-out (sweeps/roster).** Deterministic orchestrator over the compare-grid
   substrate; per_batch human gate.
7. **User ComfyUI presets (build-later).** Import ComfyUI API-format graphs as
   Workflows; parse `@slot:` tags; add the slot-injector assembly path alongside
   the Rust built-ins. Abstraction designed in Phase 2; importer ships here.

## Spike 1 — store inversion (txt2img): results

Status: **done** (branch `spike/store-inversion-txt2img`). The main risk is
**de-risked** — the single-cast txt2img slice round-trips losslessly through a
`Spec`.

What was built (throwaway, `src/lib/spec/`): a `Spec` type, a plain rune-free
`GenerationFields` snapshot of the store's param fields, and inverse projections
`specFromFields ⇄ fieldsFromSpec`. A `node --test` round-trip (Node 25's native
type-stripping — **no framework added**, so Risk #4 stays open by choice) asserts
`fieldsFromSpec(specFromFields(f))` deep-equals `f` across three fixtures (Anima
txt2img, SDXL with every pipeline feature on, inpaint-with-mask). All pass.

**Method note (honest scope):** the spike proves *field-level* losslessness, not
a literal `toParams()` byte-diff. `toParams()` is entangled with the `styles` /
`promptPresets` singletons and Svelte runes, so running it headless was out of
scope. The argument: `toParams()` is a deterministic pure function of these
fields (+ those external stores, which the inversion does not touch), so
field-level losslessness ⟹ identical `toParams()` output. A literal byte-diff
belongs in Phase 2 once the assembly logic is extracted from the rune-bound store.

**Headline finding — the Spec is a thin clean core over a fat pipeline tail.**
Of **64** param-relevant store fields:

| Tier | Count | Meaning |
|---|---|---|
| orchestration-clean | 16 | present in the orchestration Spec (`subject`/`model`/`sampling`) |
| input (edit/inputs) | 4 | img2img / mask inputs |
| **pipeline escape-hatch** | **44** | template-level ComfyUI knobs (upscale, facefix, controlnet, split-model, output, per-family quality tags) the orchestration Spec **never modelled** |

So ~⅔ of the store's surface is template config that has no home in the
high-level Spec. The spike parks it in a `pipeline` sub-object to keep the
round-trip lossless. **Resolved** (see "Spec representations: request vs resolved"
above): those 44 fields live in the *resolved* Spec, not the agent-authored
*request* Spec. A **Pipeline Profile** carries their defaults; the agent emits only
a sparse request (subject/cast/sampling), which a deterministic merge expands
against the Profile into the resolved Spec the forms bind to and `specToParams`
consumes. No workflow registry is built in the client — the Profile is the
defaults carrier.
