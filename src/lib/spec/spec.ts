/**
 * Generation Spec — client-side, spike scope (txt2img, single-cast).
 *
 * This is the inverted source of truth the frontend spec calls for: instead of
 * `generation.svelte.ts`'s ~70 `$state` fields owning generation state, a `Spec`
 * owns it and the store becomes a projection. See
 * `docs/superpowers/specs/2026-05-30-agentic-image-app-frontend-design.md`.
 *
 * SCOPE OF THIS SPIKE: only the slice needed to prove the main risk — that the
 * single-cast txt2img params round-trip losslessly through a Spec. It mirrors the
 * orchestration spec's keystone schema
 * (`lif-studio/.../2026-05-30-agentic-image-generation-flow-design.md`) where the
 * shapes align, and deliberately diverges where MooshieUI's store carries
 * template-level ComfyUI knobs the high-level Spec never modelled.
 *
 * The divergence IS the finding. Fields split into three tiers:
 *   - `orchestration`  — clean, present in the orchestration Spec (subject/model/sampling/cast).
 *   - `input`          — img2img / mask inputs (orchestration `edit`/`inputs`).
 *   - `pipeline`       — template knobs (upscale/facefix/controlnet/split-model/
 *                        output/quality) the orchestration Spec does NOT model.
 *                        Parked in an escape-hatch block so the round-trip stays
 *                        lossless without polluting the high-level surface.
 */

/** A character in the frame. Orchestration `cast[]`. Empty for prompt-encoded txt2img. */
export interface CastMember {
  character: string;                 // char-hash-id (registry-resolved)
  promptOverride: string | null;
  lora: { id: string; weight: number } | null;
  region: "left" | "right" | "center" | "auto";
  weight: number;
}

/** Job-global LoRA (style/quality). Character LoRAs live on `cast[]`. */
export interface SpecLora {
  name: string;
  strengthModel: number;
  strengthClip: number;
  enabled: boolean;
}

export interface ResolvedSpec {
  // ── orchestration-clean ──────────────────────────────────────────────────
  task: "generate" | "edit";
  intent: string | null;             // free-text the user asked for (provenance/judge)
  parent: string | null;             // <result-ref> — iterate/edit a prior Result

  cast: CastMember[];                // WHO is in the frame; [] ⇒ prompt-encoded

  subject: {
    // MooshieUI carries free-text prompts + a single style enum, not preset-id
    // lists. Modelled as-is for the client; grounding to registry IDs is a later
    // concern (the agent layer), not the store projection.
    positive: string;
    negative: string;
    stylePreset: string;             // "none" | "anime" | …
    stylePresetsEnabled: boolean;
  };

  model: {
    checkpoint: string;
    loras: SpecLora[];
  };

  sampling: {
    seed: number;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;               // MooshieUI splits sampler/scheduler; orch folds into sampler-id
    denoise: number;
  };

  dimensions: { width: number; height: number; batch: number };

  workflow: string | null;           // <workflow-id|'preview'>; null ⇒ infer from task

  // ── inputs (orchestration `edit`/`inputs`) ───────────────────────────────
  input: {
    image: string | null;
    mask: string | null;
    growMaskBy: number;
    differentialDiffusion: boolean;
  };

  // ── pipeline escape-hatch (NOT in the orchestration Spec) ─────────────────
  // Template-level ComfyUI knobs. These are why the projection is lossy in the
  // orchestration direction: a clean Spec cannot reconstruct them. Parking them
  // here keeps the client round-trip lossless. Open question for Phase 2: do
  // these bind to a `workflow-id` in the registry, or stay an explicit block?
  pipeline: {
    splitModel: {
      enabled: boolean;
      vae: string | null;
      diffusionModel: string | null;
      clipModel: string | null;
      clipType: string | null;
    };
    guidance: { smart: boolean; flux: number };
    upscale: {
      enabled: boolean;
      method: "algorithmic" | "model";
      model: string | null;
      scale: number;
      denoise: number;
      steps: number;
      tileSize: number;
      tiling: boolean;
      softGuidance: boolean;
      softGuidanceMultiplier: number;
    };
    controlnet: {
      enabled: boolean;
      mode: "preset" | "custom";
      preset: string | null;
      model: string | null;
      preprocessor: string | null;
      image: string | null;
      strength: number;
      startPercent: number;
      endPercent: number;
    };
    facefix: {
      enabled: boolean;
      detector: string | null;
      denoise: number;
      steps: number;
      guideSize: number;
      maxFaces: number;
    };
    quality: {
      auto: boolean;
      animaPositive: string;
      animaNegative: string;
      illustriousPositive: string;
      illustriousNegative: string;
      ponyPositive: string;
      ponyNegative: string;
      nanosaurPositive: string;
      nanosaurNegative: string;
    };
    output: {
      bitDepth: "8bit" | "16bit";
      format: "png" | "jxl";
      metadataMode: "text_chunk" | "stealth" | "both";
    };
  };
}
