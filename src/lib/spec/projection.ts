/**
 * Projection between the inverted `Spec` and MooshieUI's flat store fields.
 *
 * `GenerationFields` is a plain (rune-free) snapshot of the param-relevant
 * `$state` fields on `generation.svelte.ts` — same names, no Svelte dependency,
 * so it runs under `node --test`. The store, post-inversion, would expose exactly
 * these as getters projecting from a held `Spec`.
 *
 * Two functions, inverse of each other on the single-cast txt2img slice:
 *   specFromFields(fields) → Spec        (store → Spec)
 *   fieldsFromSpec(spec)   → GenerationFields   (Spec → store projection)
 *
 * The spike asserts `fieldsFromSpec(specFromFields(f))` deep-equals `f`. Because
 * `toParams()` is a deterministic pure function of these fields (+ the external
 * style/preset stores, which are unchanged by the inversion), field-level
 * losslessness ⟹ byte-identical `toParams()` output. We prove the cheaper,
 * decisive thing.
 */

import type { LoraEntry } from "../types/index.ts";
import type { ResolvedSpec, SpecLora } from "./spec.ts";

/** Param-relevant snapshot of the generation store. Mirrors `$state` field names. */
export interface GenerationFields {
  mode: "txt2img" | "img2img" | "inpainting";
  positivePrompt: string;
  negativePrompt: string;
  stylePreset: string;
  stylePresetsEnabled: boolean;
  checkpoint: string;
  vae: string;
  loras: LoraEntry[];
  samplerName: string;
  scheduler: string;
  steps: number;
  cfg: number;
  seed: number;
  width: number;
  height: number;
  batchSize: number;
  denoise: number;
  inputImage: string | null;
  maskImage: string | null;
  growMaskBy: number;
  differentialDiffusion: boolean;
  upscaleEnabled: boolean;
  upscaleMethod: "algorithmic" | "model";
  upscaleModel: string | null;
  upscaleScale: number;
  upscaleDenoise: number;
  upscaleSteps: number;
  upscaleTileSize: number;
  upscaleTiling: boolean;
  upscaleSoftGuidance: boolean;
  upscaleSoftGuidanceMultiplier: number;
  smartGuidance: boolean;
  fluxGuidance: number;
  useSplitModel: boolean;
  diffusionModel: string | null;
  clipModel: string | null;
  clipType: string | null;
  controlnetEnabled: boolean;
  controlnetMode: "preset" | "custom";
  controlnetPreset: string | null;
  controlnetModel: string | null;
  controlnetPreprocessor: string | null;
  controlnetImage: string | null;
  controlnetStrength: number;
  controlnetStartPercent: number;
  controlnetEndPercent: number;
  facefixEnabled: boolean;
  facefixDetector: string | null;
  facefixDenoise: number;
  facefixSteps: number;
  facefixGuideSize: number;
  facefixMaxFaces: number;
  outputBitDepth: "8bit" | "16bit";
  outputFormat: "png" | "jxl";
  metadataMode: "text_chunk" | "stealth" | "both";
  autoQualityTags: boolean;
  customAnimaPositiveQuality: string;
  customAnimaNegativeQuality: string;
  customIllustriousPositiveQuality: string;
  customIllustriousNegativeQuality: string;
  customPonyPositiveQuality: string;
  customPonyNegativeQuality: string;
  customNanosaurPositiveQuality: string;
  customNanosaurNegativeQuality: string;
}

/**
 * Which Spec tier each field lands in — the coverage map that is the spike's
 * headline finding. `orchestration` = clean (in the orchestration Spec);
 * `input` = edit/inputs; `pipeline` = template escape-hatch.
 */
export const FIELD_TIER: Record<keyof GenerationFields, "orchestration" | "input" | "pipeline"> = {
  mode: "orchestration",
  positivePrompt: "orchestration",
  negativePrompt: "orchestration",
  stylePreset: "orchestration",
  stylePresetsEnabled: "orchestration",
  checkpoint: "orchestration",
  loras: "orchestration",
  samplerName: "orchestration",
  scheduler: "orchestration",
  steps: "orchestration",
  cfg: "orchestration",
  seed: "orchestration",
  width: "orchestration",
  height: "orchestration",
  batchSize: "orchestration",
  denoise: "orchestration",
  inputImage: "input",
  maskImage: "input",
  growMaskBy: "input",
  differentialDiffusion: "input",
  vae: "pipeline",
  useSplitModel: "pipeline",
  diffusionModel: "pipeline",
  clipModel: "pipeline",
  clipType: "pipeline",
  smartGuidance: "pipeline",
  fluxGuidance: "pipeline",
  upscaleEnabled: "pipeline",
  upscaleMethod: "pipeline",
  upscaleModel: "pipeline",
  upscaleScale: "pipeline",
  upscaleDenoise: "pipeline",
  upscaleSteps: "pipeline",
  upscaleTileSize: "pipeline",
  upscaleTiling: "pipeline",
  upscaleSoftGuidance: "pipeline",
  upscaleSoftGuidanceMultiplier: "pipeline",
  controlnetEnabled: "pipeline",
  controlnetMode: "pipeline",
  controlnetPreset: "pipeline",
  controlnetModel: "pipeline",
  controlnetPreprocessor: "pipeline",
  controlnetImage: "pipeline",
  controlnetStrength: "pipeline",
  controlnetStartPercent: "pipeline",
  controlnetEndPercent: "pipeline",
  facefixEnabled: "pipeline",
  facefixDetector: "pipeline",
  facefixDenoise: "pipeline",
  facefixSteps: "pipeline",
  facefixGuideSize: "pipeline",
  facefixMaxFaces: "pipeline",
  outputBitDepth: "pipeline",
  outputFormat: "pipeline",
  metadataMode: "pipeline",
  autoQualityTags: "pipeline",
  customAnimaPositiveQuality: "pipeline",
  customAnimaNegativeQuality: "pipeline",
  customIllustriousPositiveQuality: "pipeline",
  customIllustriousNegativeQuality: "pipeline",
  customPonyPositiveQuality: "pipeline",
  customPonyNegativeQuality: "pipeline",
  customNanosaurPositiveQuality: "pipeline",
  customNanosaurNegativeQuality: "pipeline",
};

function loraToSpec(l: LoraEntry): SpecLora {
  return {
    name: l.name,
    strengthModel: l.strength_model,
    strengthClip: l.strength_clip,
    enabled: l.enabled,
  };
}

function loraFromSpec(l: SpecLora): LoraEntry {
  return {
    name: l.name,
    strength_model: l.strengthModel,
    strength_clip: l.strengthClip,
    enabled: l.enabled,
  };
}

/** store → Spec. Single-cast txt2img: characters are prompt-encoded ⇒ cast = []. */
export function specFromFields(f: GenerationFields): ResolvedSpec {
  return {
    task: f.mode === "txt2img" ? "generate" : "edit",
    intent: null,
    parent: null,
    cast: [],
    subject: {
      positive: f.positivePrompt,
      negative: f.negativePrompt,
      stylePreset: f.stylePreset,
      stylePresetsEnabled: f.stylePresetsEnabled,
    },
    model: {
      checkpoint: f.checkpoint,
      loras: f.loras.map(loraToSpec),
    },
    sampling: {
      seed: f.seed,
      steps: f.steps,
      cfg: f.cfg,
      sampler: f.samplerName,
      scheduler: f.scheduler,
      denoise: f.denoise,
    },
    dimensions: { width: f.width, height: f.height, batch: f.batchSize },
    // For the spike a workflow-id stands in for the mode; Phase 2 decides whether
    // the pipeline knobs below collapse into this id or stay explicit.
    workflow: f.mode,
    input: {
      image: f.inputImage,
      mask: f.maskImage,
      growMaskBy: f.growMaskBy,
      differentialDiffusion: f.differentialDiffusion,
    },
    pipeline: {
      splitModel: {
        enabled: f.useSplitModel,
        vae: f.vae === "" ? null : f.vae,
        diffusionModel: f.diffusionModel,
        clipModel: f.clipModel,
        clipType: f.clipType,
      },
      guidance: { smart: f.smartGuidance, flux: f.fluxGuidance },
      upscale: {
        enabled: f.upscaleEnabled,
        method: f.upscaleMethod,
        model: f.upscaleModel,
        scale: f.upscaleScale,
        denoise: f.upscaleDenoise,
        steps: f.upscaleSteps,
        tileSize: f.upscaleTileSize,
        tiling: f.upscaleTiling,
        softGuidance: f.upscaleSoftGuidance,
        softGuidanceMultiplier: f.upscaleSoftGuidanceMultiplier,
      },
      controlnet: {
        enabled: f.controlnetEnabled,
        mode: f.controlnetMode,
        preset: f.controlnetPreset,
        model: f.controlnetModel,
        preprocessor: f.controlnetPreprocessor,
        image: f.controlnetImage,
        strength: f.controlnetStrength,
        startPercent: f.controlnetStartPercent,
        endPercent: f.controlnetEndPercent,
      },
      facefix: {
        enabled: f.facefixEnabled,
        detector: f.facefixDetector,
        denoise: f.facefixDenoise,
        steps: f.facefixSteps,
        guideSize: f.facefixGuideSize,
        maxFaces: f.facefixMaxFaces,
      },
      quality: {
        auto: f.autoQualityTags,
        animaPositive: f.customAnimaPositiveQuality,
        animaNegative: f.customAnimaNegativeQuality,
        illustriousPositive: f.customIllustriousPositiveQuality,
        illustriousNegative: f.customIllustriousNegativeQuality,
        ponyPositive: f.customPonyPositiveQuality,
        ponyNegative: f.customPonyNegativeQuality,
        nanosaurPositive: f.customNanosaurPositiveQuality,
        nanosaurNegative: f.customNanosaurNegativeQuality,
      },
      output: {
        bitDepth: f.outputBitDepth,
        format: f.outputFormat,
        metadataMode: f.metadataMode,
      },
    },
  };
}

/** Spec → store projection. Inverse of `specFromFields` on this slice. */
export function fieldsFromSpec(s: ResolvedSpec): GenerationFields {
  return {
    mode: s.workflow as GenerationFields["mode"],
    positivePrompt: s.subject.positive,
    negativePrompt: s.subject.negative,
    stylePreset: s.subject.stylePreset,
    stylePresetsEnabled: s.subject.stylePresetsEnabled,
    checkpoint: s.model.checkpoint,
    vae: s.pipeline.splitModel.vae ?? "",
    loras: s.model.loras.map(loraFromSpec),
    samplerName: s.sampling.sampler,
    scheduler: s.sampling.scheduler,
    steps: s.sampling.steps,
    cfg: s.sampling.cfg,
    seed: s.sampling.seed,
    width: s.dimensions.width,
    height: s.dimensions.height,
    batchSize: s.dimensions.batch,
    denoise: s.sampling.denoise,
    inputImage: s.input.image,
    maskImage: s.input.mask,
    growMaskBy: s.input.growMaskBy,
    differentialDiffusion: s.input.differentialDiffusion,
    upscaleEnabled: s.pipeline.upscale.enabled,
    upscaleMethod: s.pipeline.upscale.method,
    upscaleModel: s.pipeline.upscale.model,
    upscaleScale: s.pipeline.upscale.scale,
    upscaleDenoise: s.pipeline.upscale.denoise,
    upscaleSteps: s.pipeline.upscale.steps,
    upscaleTileSize: s.pipeline.upscale.tileSize,
    upscaleTiling: s.pipeline.upscale.tiling,
    upscaleSoftGuidance: s.pipeline.upscale.softGuidance,
    upscaleSoftGuidanceMultiplier: s.pipeline.upscale.softGuidanceMultiplier,
    smartGuidance: s.pipeline.guidance.smart,
    fluxGuidance: s.pipeline.guidance.flux,
    useSplitModel: s.pipeline.splitModel.enabled,
    diffusionModel: s.pipeline.splitModel.diffusionModel,
    clipModel: s.pipeline.splitModel.clipModel,
    clipType: s.pipeline.splitModel.clipType,
    controlnetEnabled: s.pipeline.controlnet.enabled,
    controlnetMode: s.pipeline.controlnet.mode,
    controlnetPreset: s.pipeline.controlnet.preset,
    controlnetModel: s.pipeline.controlnet.model,
    controlnetPreprocessor: s.pipeline.controlnet.preprocessor,
    controlnetImage: s.pipeline.controlnet.image,
    controlnetStrength: s.pipeline.controlnet.strength,
    controlnetStartPercent: s.pipeline.controlnet.startPercent,
    controlnetEndPercent: s.pipeline.controlnet.endPercent,
    facefixEnabled: s.pipeline.facefix.enabled,
    facefixDetector: s.pipeline.facefix.detector,
    facefixDenoise: s.pipeline.facefix.denoise,
    facefixSteps: s.pipeline.facefix.steps,
    facefixGuideSize: s.pipeline.facefix.guideSize,
    facefixMaxFaces: s.pipeline.facefix.maxFaces,
    outputBitDepth: s.pipeline.output.bitDepth,
    outputFormat: s.pipeline.output.format,
    metadataMode: s.pipeline.output.metadataMode,
    autoQualityTags: s.pipeline.quality.auto,
    customAnimaPositiveQuality: s.pipeline.quality.animaPositive,
    customAnimaNegativeQuality: s.pipeline.quality.animaNegative,
    customIllustriousPositiveQuality: s.pipeline.quality.illustriousPositive,
    customIllustriousNegativeQuality: s.pipeline.quality.illustriousNegative,
    customPonyPositiveQuality: s.pipeline.quality.ponyPositive,
    customPonyNegativeQuality: s.pipeline.quality.ponyNegative,
    customNanosaurPositiveQuality: s.pipeline.quality.nanosaurPositive,
    customNanosaurNegativeQuality: s.pipeline.quality.nanosaurNegative,
  };
}
