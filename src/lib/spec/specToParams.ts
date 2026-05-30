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
 * `toParams()` becomes a thin wrapper that does (1)+(2) then calls this.
 *
 * The built-in style-preset lookup and the per-architecture quality-tag rules
 * ARE deterministic, so they stay here (driven by the resolved Spec + the
 * injected `architecture`).
 */

import type { Spec } from "./spec.ts";
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
 * Everything `specToParams` needs that the resolved Spec does NOT carry — the
 * rune-read / non-deterministic pieces the wrapper resolves first.
 */
export interface SpecToParamsInjections {
  /** Artist-Styles fragment (`styles.buildPromptFragment()`); `""` if none. */
  styleFragment: string;
  /** Prompt-preset resolution (non-deterministic wildcard rolls done upstream). */
  resolvedPresets: ResolvedPresetText;
  /** Detected model architecture (`generation.detectedArchitecture`). */
  architecture: ModelArchitecture;
}

/**
 * Assemble the ComfyUI generation params from a resolved Spec + injected
 * rune-read context. Pure: identical inputs ⇒ identical output (the byte-diff
 * guarantee). The shape is byte-identical to the legacy `toParams()` return.
 */
export function specToParams(spec: Spec, injections: SpecToParamsInjections) {
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

  const controlnet = spec.pipeline.controlnet;

  return {
    mode: spec.workflow as "txt2img" | "img2img" | "inpainting",
    positive_prompt: translateNaiWeightSyntax(parsedPositive.baseText),
    negative_prompt: translateNaiWeightSyntax(parsedNegative.baseText),
    positive_segments: parsedPositive.segments.map((s) => ({
      text: translateNaiWeightSyntax(s.text),
      start: s.start,
      end: s.end,
    })),
    negative_segments: parsedNegative.segments.map((s) => ({
      text: translateNaiWeightSyntax(s.text),
      start: s.start,
      end: s.end,
    })),
    raw_positive_prompt: translateNaiWeightSyntax(positivePrompt),
    raw_negative_prompt: translateNaiWeightSyntax(negativePrompt),
    checkpoint: spec.model.checkpoint,
    vae: spec.pipeline.splitModel.vae,
    loras: spec.model.loras
      .filter((l) => l.enabled && l.name)
      .map(({ name, strengthModel, strengthClip }) => ({
        name,
        strength_model: strengthModel,
        strength_clip: strengthClip,
      })),
    sampler_name: spec.sampling.sampler,
    scheduler: spec.sampling.scheduler,
    steps: spec.sampling.steps,
    cfg: spec.sampling.cfg,
    seed: spec.sampling.seed,
    width: spec.dimensions.width,
    height: spec.dimensions.height,
    batch_size: spec.dimensions.batch,
    denoise: spec.sampling.denoise,
    differential_diffusion: spec.input.differentialDiffusion,
    input_image: spec.input.image,
    mask_image: spec.input.mask,
    grow_mask_by: spec.input.growMaskBy,
    upscale_enabled: upscale.enabled,
    upscale_method: upscale.method,
    upscale_model: upscale.model,
    upscale_scale: upscale.scale,
    upscale_denoise: upscale.denoise,
    upscale_steps: upscale.steps,
    upscale_tile_size: upscale.tileSize,
    upscale_tiling: upscale.tiling,
    upscale_soft_guidance: upscale.softGuidance,
    upscale_soft_guidance_multiplier: upscale.softGuidanceMultiplier,
    smart_guidance: spec.pipeline.guidance.smart,
    flux_guidance: spec.pipeline.guidance.flux,
    upscale_positive_prompt: upscalePositivePrompt,
    upscale_negative_prompt: upscaleNegativePrompt,
    use_split_model: spec.pipeline.splitModel.enabled,
    diffusion_model: spec.pipeline.splitModel.diffusionModel,
    clip_model: spec.pipeline.splitModel.clipModel,
    clip_type: spec.pipeline.splitModel.clipType,
    controlnet: controlnet.enabled
      ? {
          enabled: true,
          preset: controlnet.mode === "preset" ? controlnet.preset : null,
          controlnet_model: controlnet.model,
          preprocessor: controlnet.mode === "preset" ? controlnet.preprocessor : null,
          image: controlnet.image,
          strength: controlnet.strength,
          start_percent: controlnet.startPercent,
          end_percent: controlnet.endPercent,
        }
      : null,
    facefix_enabled: spec.pipeline.facefix.enabled,
    facefix_detector: spec.pipeline.facefix.detector,
    facefix_denoise: spec.pipeline.facefix.denoise,
    facefix_steps: spec.pipeline.facefix.steps,
    facefix_guide_size: spec.pipeline.facefix.guideSize,
    facefix_max_faces: spec.pipeline.facefix.maxFaces,
    model_architecture: architecture,
    output_bit_depth: spec.pipeline.output.bitDepth,
    output_format: spec.pipeline.output.format,
  };
}
