/**
 * Spec → ComfyUI params assembler — the deterministic core extracted from the
 * rune-bound `GenerationStore.toParams()`.
 *
 * `toParams()` did three kinds of work:
 *   1. read rune state,
 *   2. resolve non-deterministic external contributions (random wildcard rolls
 *      from the `promptPresets` singleton, the active `styles` fragment), and
 *   3. deterministically assemble the params object.
 *
 * Only (3) lives here, and (1)+(2) are passed in as `injections` (dependency
 * injection) so this function is pure and headless-testable. The store's
 * `toParams()` is a thin wrapper that does (1)+(2) then calls this.
 *
 * Two-step (ADR 0003): `resolveSlotValues` produces *path-neutral resolved
 * slot-values* (camelCase, target-agnostic), then `slotValuesToParams` maps them
 * to the snake_case `GenerationParams` the built-in Rust builders consume. The
 * neutral layer is the seam a future user-preset slot-injector targets instead —
 * the Spec→values rules are path-neutral; only the final injection step differs.
 *
 * The built-in style-preset lookup and the per-architecture quality-tag rules
 * ARE deterministic, so they stay here (driven by the resolved Spec + the
 * injected `architecture`).
 */

import type { ResolvedSpec } from "./spec.ts";
import type { PromptSegment } from "../types/index.ts";
import { STYLE_PRESETS } from "./stylePresets.ts";
import { mergeTagPrompts, translateNaiWeightSyntax } from "./promptAssembly.ts";
import { parseScheduledPrompt } from "../utils/promptSchedule.ts";

/** Model family detected from modelspec/filename — drives quality-tag injection. */
export type ModelArchitecture =
  | "sdxl"
  | "illustrious"
  | "sd15"
  | "sd3"
  | "flux"
  | "pony"
  | "auraflow"
  | "pixart"
  | "hunyuandit"
  | "cascade"
  | "kolors"
  | "mugen"
  | "nanosaur"
  | "anima"
  | "unknown";

/** Pre-resolved prompt-preset contributions (wildcard rolls already done). */
export interface ResolvedPresetText {
  /** User positive prompt after inline `@preset:` expansion. */
  inlinePositive: string;
  /** User negative prompt after inline `@preset:` expansion. */
  inlineNegative: string;
  /** Active prompt-preset prepend fragment (`""` if none). */
  prepend: string;
  /** Active prompt-preset append + wildcard fragment (`""` if none). */
  append: string;
}

/**
 * Everything `resolveSlotValues` needs that the resolved Spec does NOT carry —
 * the rune-read / non-deterministic pieces the wrapper resolves first.
 */
export interface SpecToParamsInjections {
  /** Artist-Styles fragment (`styles.buildPromptFragment()`); `""` if none. */
  styleFragment: string;
  /** Prompt-preset resolution (non-deterministic wildcard rolls done upstream). */
  resolvedPresets: ResolvedPresetText;
  /** Detected model architecture (`generation.detectedArchitecture`). */
  architecture: ModelArchitecture;
}

/** A LoRA in path-neutral form (camelCase, before the snake_case payload mapping). */
export interface ResolvedLoraSlot {
  name: string;
  strengthModel: number;
  strengthClip: number;
}

/**
 * Path-neutral resolved slot-values — the target-agnostic intermediate the
 * Spec→values rules produce. Either the built-in Rust builders (via
 * `slotValuesToParams`) or a future preset slot-injector consume these.
 */
export interface ResolvedSlotValues {
  mode: "txt2img" | "img2img" | "inpainting";
  /** Assembled base prompt text, scheduling tags stripped + NAI-weight translated. */
  positivePrompt: string;
  negativePrompt: string;
  positiveSegments: PromptSegment[];
  negativeSegments: PromptSegment[];
  /** Raw assembled prompt (scheduling tags intact) for metadata embedding. */
  rawPositivePrompt: string;
  rawNegativePrompt: string;
  /** Quality-only prompts for tiled-upscale seam reduction (null when not applicable). */
  upscalePositivePrompt: string | null;
  upscaleNegativePrompt: string | null;
  checkpoint: string;
  loras: ResolvedLoraSlot[];
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  seed: number;
  width: number;
  height: number;
  batch: number;
  denoise: number;
  differentialDiffusion: boolean;
  inputImage: string | null;
  maskImage: string | null;
  growMaskBy: number;
  smartGuidance: boolean;
  fluxGuidance: number;
  // Structured pipeline blocks pass through neutrally (already resolved on the Spec).
  upscale: ResolvedSpec["pipeline"]["upscale"];
  splitModel: ResolvedSpec["pipeline"]["splitModel"];
  controlnet: ResolvedSpec["pipeline"]["controlnet"];
  facefix: ResolvedSpec["pipeline"]["facefix"];
  output: ResolvedSpec["pipeline"]["output"];
  architecture: ModelArchitecture;
}

/**
 * Resolve a Spec + injected rune-context into path-neutral slot-values. Pure:
 * identical inputs ⇒ identical output. This is where the deterministic prompt
 * assembly (built-in styles, Artist-Styles fragment, prompt presets, per-family
 * quality tags, scheduling + NAI-weight translation) happens.
 */
export function resolveSlotValues(
  spec: ResolvedSpec,
  injections: SpecToParamsInjections,
): ResolvedSlotValues {
  const { styleFragment, resolvedPresets, architecture } = injections;
  const isAnima = architecture === "anima";
  const isIllustrious = architecture === "illustrious";
  const isPony = architecture === "pony";
  const isNanosaur = architecture === "nanosaur";

  const style = spec.subject.stylePresetsEnabled
    ? (STYLE_PRESETS.find((preset) => preset.id === spec.subject.stylePreset) ?? STYLE_PRESETS[0])
    : STYLE_PRESETS[0];

  // Inline `@preset:` directives were expanded upstream (wildcard rolls happen
  // before any merging), so we merge the resolved inline prompts with the style.
  let positivePrompt = mergeTagPrompts(resolvedPresets.inlinePositive, style.positive);
  let negativePrompt = mergeTagPrompts(resolvedPresets.inlineNegative, style.negative);

  // Inject tags contributed by any currently-active Artist Styles.
  if (styleFragment) {
    positivePrompt = mergeTagPrompts(positivePrompt, styleFragment);
  }

  // Inject active Prompt Presets (prepend / append / wildcard).
  if (resolvedPresets.prepend) {
    positivePrompt = mergeTagPrompts(resolvedPresets.prepend, positivePrompt);
  }
  if (resolvedPresets.append) {
    positivePrompt = mergeTagPrompts(positivePrompt, resolvedPresets.append);
  }

  const quality = spec.pipeline.quality;

  // Auto-apply quality tags for supported model families
  if (quality.auto) {
    // Anima models (positive before, negative after)
    if (isAnima) {
      positivePrompt = mergeTagPrompts(quality.animaPositive, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, quality.animaNegative);
    }

    // Illustrious/NoobAI family (positive before, negative after)
    if (isIllustrious) {
      positivePrompt = mergeTagPrompts(quality.illustriousPositive, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, quality.illustriousNegative);
    }

    // Pony Diffusion (score-based quality tags)
    if (isPony) {
      positivePrompt = mergeTagPrompts(quality.ponyPositive, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, quality.ponyNegative);
    }

    // Nanosaur (newest/oldest quality tags)
    if (isNanosaur) {
      positivePrompt = mergeTagPrompts(quality.nanosaurPositive, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, quality.nanosaurNegative);
    }
  }

  const upscale = spec.pipeline.upscale;

  // Build quality-only prompts for tiled upscale (reduces tile seam artifacts)
  let upscalePositivePrompt: string | null = null;
  let upscaleNegativePrompt: string | null = null;
  if (upscale.enabled && upscale.tiling && quality.auto) {
    if (isAnima) {
      upscalePositivePrompt = quality.animaPositive;
      upscaleNegativePrompt = quality.animaNegative;
    } else if (isIllustrious) {
      upscalePositivePrompt = quality.illustriousPositive;
      upscaleNegativePrompt = quality.illustriousNegative;
    } else if (isPony) {
      upscalePositivePrompt = quality.ponyPositive;
      upscaleNegativePrompt = quality.ponyNegative;
    } else if (isNanosaur) {
      upscalePositivePrompt = quality.nanosaurPositive;
      upscaleNegativePrompt = quality.nanosaurNegative;
    }
  }

  // Parse timestep scheduling tags from prompts before NAI weight translation
  const parsedPositive = parseScheduledPrompt(positivePrompt);
  const parsedNegative = parseScheduledPrompt(negativePrompt);

  return {
    mode: spec.workflow as ResolvedSlotValues["mode"],
    positivePrompt: translateNaiWeightSyntax(parsedPositive.baseText),
    negativePrompt: translateNaiWeightSyntax(parsedNegative.baseText),
    positiveSegments: parsedPositive.segments.map((s) => ({
      text: translateNaiWeightSyntax(s.text),
      start: s.start,
      end: s.end,
    })),
    negativeSegments: parsedNegative.segments.map((s) => ({
      text: translateNaiWeightSyntax(s.text),
      start: s.start,
      end: s.end,
    })),
    rawPositivePrompt: translateNaiWeightSyntax(positivePrompt),
    rawNegativePrompt: translateNaiWeightSyntax(negativePrompt),
    upscalePositivePrompt,
    upscaleNegativePrompt,
    checkpoint: spec.model.checkpoint,
    loras: spec.model.loras
      .filter((l) => l.enabled && l.name)
      .map((l) => ({ name: l.name, strengthModel: l.strengthModel, strengthClip: l.strengthClip })),
    sampler: spec.sampling.sampler,
    scheduler: spec.sampling.scheduler,
    steps: spec.sampling.steps,
    cfg: spec.sampling.cfg,
    seed: spec.sampling.seed,
    width: spec.dimensions.width,
    height: spec.dimensions.height,
    batch: spec.dimensions.batch,
    denoise: spec.sampling.denoise,
    differentialDiffusion: spec.input.differentialDiffusion,
    inputImage: spec.input.image,
    maskImage: spec.input.mask,
    growMaskBy: spec.input.growMaskBy,
    smartGuidance: spec.pipeline.guidance.smart,
    fluxGuidance: spec.pipeline.guidance.flux,
    upscale,
    splitModel: spec.pipeline.splitModel,
    controlnet: spec.pipeline.controlnet,
    facefix: spec.pipeline.facefix,
    output: spec.pipeline.output,
    architecture,
  };
}

/**
 * Map path-neutral slot-values to the snake_case `GenerationParams` object the
 * built-in Rust template builders consume. Byte-identical to the legacy
 * `toParams()` return shape (guarded by the byte-diff test).
 */
export function slotValuesToParams(s: ResolvedSlotValues) {
  return {
    mode: s.mode,
    positive_prompt: s.positivePrompt,
    negative_prompt: s.negativePrompt,
    positive_segments: s.positiveSegments,
    negative_segments: s.negativeSegments,
    raw_positive_prompt: s.rawPositivePrompt,
    raw_negative_prompt: s.rawNegativePrompt,
    checkpoint: s.checkpoint,
    vae: s.splitModel.vae,
    loras: s.loras.map(({ name, strengthModel, strengthClip }) => ({
      name,
      strength_model: strengthModel,
      strength_clip: strengthClip,
    })),
    sampler_name: s.sampler,
    scheduler: s.scheduler,
    steps: s.steps,
    cfg: s.cfg,
    seed: s.seed,
    width: s.width,
    height: s.height,
    batch_size: s.batch,
    denoise: s.denoise,
    differential_diffusion: s.differentialDiffusion,
    input_image: s.inputImage,
    mask_image: s.maskImage,
    grow_mask_by: s.growMaskBy,
    upscale_enabled: s.upscale.enabled,
    upscale_method: s.upscale.method,
    upscale_model: s.upscale.model,
    upscale_scale: s.upscale.scale,
    upscale_denoise: s.upscale.denoise,
    upscale_steps: s.upscale.steps,
    upscale_tile_size: s.upscale.tileSize,
    upscale_tiling: s.upscale.tiling,
    upscale_soft_guidance: s.upscale.softGuidance,
    upscale_soft_guidance_multiplier: s.upscale.softGuidanceMultiplier,
    smart_guidance: s.smartGuidance,
    flux_guidance: s.fluxGuidance,
    upscale_positive_prompt: s.upscalePositivePrompt,
    upscale_negative_prompt: s.upscaleNegativePrompt,
    use_split_model: s.splitModel.enabled,
    diffusion_model: s.splitModel.diffusionModel,
    clip_model: s.splitModel.clipModel,
    clip_type: s.splitModel.clipType,
    controlnet: s.controlnet.enabled
      ? {
          enabled: true,
          preset: s.controlnet.mode === "preset" ? s.controlnet.preset : null,
          controlnet_model: s.controlnet.model,
          preprocessor: s.controlnet.mode === "preset" ? s.controlnet.preprocessor : null,
          image: s.controlnet.image,
          strength: s.controlnet.strength,
          start_percent: s.controlnet.startPercent,
          end_percent: s.controlnet.endPercent,
        }
      : null,
    facefix_enabled: s.facefix.enabled,
    facefix_detector: s.facefix.detector,
    facefix_denoise: s.facefix.denoise,
    facefix_steps: s.facefix.steps,
    facefix_guide_size: s.facefix.guideSize,
    facefix_max_faces: s.facefix.maxFaces,
    model_architecture: s.architecture,
    output_bit_depth: s.output.bitDepth,
    output_format: s.output.format,
  };
}

/**
 * Assemble the ComfyUI generation params from a resolved Spec + injected
 * rune-read context. Pure: identical inputs ⇒ identical output (the byte-diff
 * guarantee). Composes the neutral slot-value resolution with the built-in
 * params mapping.
 */
export function specToParams(spec: ResolvedSpec, injections: SpecToParamsInjections) {
  return slotValuesToParams(resolveSlotValues(spec, injections));
}
