# MooshieUI (LIF Fork)

An extended fork of MooshieUI that adds custom anime production pipelines on top of the existing app. MooshieUI's built-in features (txt2img, img2img, gallery, model management, multi-user auth, i18n) remain intact. The fork adds custom generation templates, a character-aware Control Panel, Pipeline Profiles, and batch queue for professional production work.

## Language

**Pipeline Profile**:
A saved, reusable preset of the per-profile parameters (model configuration, LoRA stacks, sampling defaults, template selection). Seeds a **Generation Spec** at the start of a job; conversely, a Spec's reusable subset can be saved back out as a Profile. Predefined and selected — never the live source of truth.
_Avoid_: Workflow variation, preset, config

**Generation Spec**:
The live, request-only configuration for a single generation — the single source of truth that both the chat agent and the Control Panel mutate while a job is composed and run. Seeded from a **Pipeline Profile**, then filled with per-job parameters. Transient: one per request, never reused (iterating produces a new Spec referencing a prior Result, not a saved profile).
_Avoid_: Job config, request, params, pipeline profile

**Result**:
The domain record of one generation — the resolved Spec, effective seed, scores, and verdict, with a handle to its image. The anchor for iteration and refine: "再来4张" and fix-hand both reference a Result (`parent`), never a bare image. Embedded in the saved PNG so any image re-opens as a Result. (The gallery's display handle for raw pixels is a projection, not a Result.)
_Avoid_: Output, output image, generation

**Workflow**:
A ComfyUI node-graph for one operation (txt2img, img2img, inpaint, upscale, facefix, controlnet) exposing injectable slots that a resolved **Generation Spec** fills. Selected by a **Pipeline Profile**. Origin-agnostic: may be a built-in workflow or an imported user ComfyUI preset. **Dual-Draft** / **Single-Draft Template** are kinds of Workflow.
_Avoid_: Preset, comfyui preset, node graph

The stack runs **Generation Spec → Pipeline Profile → Workflow**: the Spec uses a Profile, which selects a Workflow and supplies its slot values; execution runs the Workflow and fills its slots from the resolved Spec.

**Dual-Draft Template**:
A generation pipeline where two models participate in the 1st pass via sequential KSamplerAdvanced nodes (base then refiner), with the refiner continuing into the 2nd pass and face detailing.
_Avoid_: Two-pass, multi-model

**Single-Draft Template**:
A generation pipeline where one model runs the 1st pass via a single KSampler, and a separate refiner model enters only at the 2nd pass and face detailing.
_Avoid_: Single-pass, one-model

**Operator**:
The sole human user of the app — selects characters, sets composition, queues generations, reviews output, and now also directs the **Agent** in natural language. Clients never interact with the app directly.
_Avoid_: User, client

**Agent**:
A judgment instrument the Operator directs in natural language. Does three bounded jobs — intent→Spec, refine→Spec-delta, and Result verdicts (judge) — all structured output. Never orchestrates and holds no authority: deterministic code runs the loop, and a **Human Gate** policy decides delivery.
_Avoid_: Assistant, bot, autonomous agent, orchestrator

**Human Gate**:
The approval checkpoint between the agent's scored shortlist and delivery. Its strictness is a per-run policy — `per_iteration`, `per_batch`, or `none` (unattended, with post-hoc spot-check). Relaxing it removes the Operator from the per-image loop; it never transfers orchestration to the Agent.
_Avoid_: Approval step, review gate

**Session**:
One chat thread and its Result board — like a ChatGPT conversation: opening a new chat starts a new Session with fresh agent context and a fresh board. The scope the agent refines within; `parent` references ("再来4张", "like #3") resolve against the current Session's Results by default. Reopenable.
_Avoid_: Login session, tab, conversation

**Control Panel**:
The Operator's direct-manipulation surface — one of three, alongside the chat panel and Result board. Consolidates the ~15 parameters the Operator changes per job into a single view (replacing a 156-node ComfyUI graph), projecting from the **Generation Spec** rather than owning state.
_Avoid_: Dashboard, settings page, spec inspector

**Generation Spec (per-job parameters)**:
Character selection, composition prompt, aspect ratio, seed, ControlNet settings, LoRA weight tweaks. Set fresh each job (these live on the Spec, not the Profile).

**Pipeline Profile (per-profile parameters)**:
Base model checkpoint, refiner model checkpoint, template selection, LoRA stacks with default weights, sampler, scheduler, steps, CFG, 2nd pass scale/denoise.

## Example Dialogue

> **Dev:** "The operator wants to generate Uzui Tengen in a red background pose using the Anima fanart pipeline."
>
> **Domain expert:** "They'd load the Anima Fanart **Pipeline Profile**, which selects the **Single-Draft Template**, sets the Anima checkpoint as base and NoobAI as refiner, and loads the fanart LoRA stack. Then per-job, they pick Uzui Tengen from the character selector, type the composition prompt, and hit generate."
>
> **Dev:** "Where does the character data come from?"
>
> **Domain expert:** "The **Control Panel** queries ComfyUI's HTTP API — the CharacterPromptSelector node serves collection lists and character metadata through its routes. The app never reads datafiles directly."
