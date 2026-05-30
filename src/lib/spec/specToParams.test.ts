/**
 * Byte-diff: prove the extracted pure assembler `specToParams` produces output
 * byte-identical to the legacy `GenerationStore.toParams()`.
 *
 * The legacy `toParams()` cannot run headless (Svelte `$state` runes + the
 * `styles` / `promptPresets` singletons are undefined under `node --test`). So
 * `legacyToParams` below is a *field-driven* transcription of the original
 * `toParams()` body — `this.X` → `f.X`, the singleton-resolved contributions
 * passed in as the same `injections` the production wrapper now resolves. It is
 * the oracle.
 *
 * The assertion `specToParams(specFromFields(f), injections)` deep-equals
 * `legacyToParams(f, injections)` therefore proves two things at once:
 *   1. the Spec round-trip (`specFromFields`) carries every param field, and
 *   2. the spec-driven assembler reads them back into exactly the original shape.
 *
 * Both paths share the moved pure helpers (mergeTagPrompts / NAI / schedule), so
 * the test isolates the one thing the refactor introduced: the Spec indirection.
 *
 * Architecture detection is rune-bound (lives in the wrapper as an injection),
 * so the fixture's resolved architecture is fed to BOTH paths.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { specFromFields } from "./projection.ts";
import type { GenerationFields } from "./projection.ts";
import { specToParams, type SpecToParamsInjections } from "./specToParams.ts";
import { STYLE_PRESETS } from "./stylePresets.ts";
import { mergeTagPrompts, translateNaiWeightSyntax } from "./promptAssembly.ts";
import { parseScheduledPrompt } from "../utils/promptSchedule.ts";
import { FIXTURES, FIXTURE_ARCHITECTURE, animaTxt2img } from "./fixtures.ts";

/**
 * Field-driven transcription of the original `GenerationStore.toParams()`
 * (commit before the extraction). Kept structurally faithful to the original so
 * it is an independent oracle, not a paraphrase of `specToParams`.
 */
function legacyToParams(f: GenerationFields, injections: SpecToParamsInjections) {
  const { styleFragment, resolvedPresets, architecture } = injections;
  const isAnima = architecture === "anima";
  const isIllustrious = architecture === "illustrious";
  const isPony = architecture === "pony";
  const isNanosaur = architecture === "nanosaur";

  const style = f.stylePresetsEnabled
    ? (STYLE_PRESETS.find((preset) => preset.id === f.stylePreset) ?? STYLE_PRESETS[0])
    : STYLE_PRESETS[0];

  const inlinePositive = resolvedPresets.inlinePositive;
  const inlineNegative = resolvedPresets.inlineNegative;

  let positivePrompt = mergeTagPrompts(inlinePositive, style.positive);
  let negativePrompt = mergeTagPrompts(inlineNegative, style.negative);

  if (styleFragment) {
    positivePrompt = mergeTagPrompts(positivePrompt, styleFragment);
  }

  if (resolvedPresets.prepend) {
    positivePrompt = mergeTagPrompts(resolvedPresets.prepend, positivePrompt);
  }
  if (resolvedPresets.append) {
    positivePrompt = mergeTagPrompts(positivePrompt, resolvedPresets.append);
  }

  if (f.autoQualityTags) {
    if (isAnima) {
      positivePrompt = mergeTagPrompts(f.customAnimaPositiveQuality, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, f.customAnimaNegativeQuality);
    }
    if (isIllustrious) {
      positivePrompt = mergeTagPrompts(f.customIllustriousPositiveQuality, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, f.customIllustriousNegativeQuality);
    }
    if (isPony) {
      positivePrompt = mergeTagPrompts(f.customPonyPositiveQuality, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, f.customPonyNegativeQuality);
    }
    if (isNanosaur) {
      positivePrompt = mergeTagPrompts(f.customNanosaurPositiveQuality, positivePrompt);
      negativePrompt = mergeTagPrompts(negativePrompt, f.customNanosaurNegativeQuality);
    }
  }

  let upscalePositivePrompt: string | null = null;
  let upscaleNegativePrompt: string | null = null;
  if (f.upscaleEnabled && f.upscaleTiling && f.autoQualityTags) {
    if (isAnima) {
      upscalePositivePrompt = f.customAnimaPositiveQuality;
      upscaleNegativePrompt = f.customAnimaNegativeQuality;
    } else if (isIllustrious) {
      upscalePositivePrompt = f.customIllustriousPositiveQuality;
      upscaleNegativePrompt = f.customIllustriousNegativeQuality;
    } else if (isPony) {
      upscalePositivePrompt = f.customPonyPositiveQuality;
      upscaleNegativePrompt = f.customPonyNegativeQuality;
    } else if (isNanosaur) {
      upscalePositivePrompt = f.customNanosaurPositiveQuality;
      upscaleNegativePrompt = f.customNanosaurNegativeQuality;
    }
  }

  const parsedPositive = parseScheduledPrompt(positivePrompt);
  const parsedNegative = parseScheduledPrompt(negativePrompt);

  return {
    mode: f.mode,
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
    checkpoint: f.checkpoint,
    vae: f.vae || null,
    loras: f.loras
      .filter((l) => l.enabled && l.name)
      .map(({ name, strength_model, strength_clip }) => ({
        name,
        strength_model,
        strength_clip,
      })),
    sampler_name: f.samplerName,
    scheduler: f.scheduler,
    steps: f.steps,
    cfg: f.cfg,
    seed: f.seed,
    width: f.width,
    height: f.height,
    batch_size: f.batchSize,
    denoise: f.denoise,
    differential_diffusion: f.differentialDiffusion,
    input_image: f.inputImage,
    mask_image: f.maskImage,
    grow_mask_by: f.growMaskBy,
    upscale_enabled: f.upscaleEnabled,
    upscale_method: f.upscaleMethod,
    upscale_model: f.upscaleModel,
    upscale_scale: f.upscaleScale,
    upscale_denoise: f.upscaleDenoise,
    upscale_steps: f.upscaleSteps,
    upscale_tile_size: f.upscaleTileSize,
    upscale_tiling: f.upscaleTiling,
    upscale_soft_guidance: f.upscaleSoftGuidance,
    upscale_soft_guidance_multiplier: f.upscaleSoftGuidanceMultiplier,
    smart_guidance: f.smartGuidance,
    flux_guidance: f.fluxGuidance,
    upscale_positive_prompt: upscalePositivePrompt,
    upscale_negative_prompt: upscaleNegativePrompt,
    use_split_model: f.useSplitModel,
    diffusion_model: f.diffusionModel,
    clip_model: f.clipModel,
    clip_type: f.clipType,
    controlnet: f.controlnetEnabled
      ? {
          enabled: true,
          preset: f.controlnetMode === "preset" ? f.controlnetPreset : null,
          controlnet_model: f.controlnetModel,
          preprocessor: f.controlnetMode === "preset" ? f.controlnetPreprocessor : null,
          image: f.controlnetImage,
          strength: f.controlnetStrength,
          start_percent: f.controlnetStartPercent,
          end_percent: f.controlnetEndPercent,
        }
      : null,
    facefix_enabled: f.facefixEnabled,
    facefix_detector: f.facefixDetector,
    facefix_denoise: f.facefixDenoise,
    facefix_steps: f.facefixSteps,
    facefix_guide_size: f.facefixGuideSize,
    facefix_max_faces: f.facefixMaxFaces,
    model_architecture: architecture,
    output_bit_depth: f.outputBitDepth,
    output_format: f.outputFormat,
  };
}

/** Preset-free injections: no inline `@preset:`, no active presets, no Artist Styles. */
function presetFreeInjections(f: GenerationFields, name: string): SpecToParamsInjections {
  return {
    styleFragment: "",
    resolvedPresets: {
      inlinePositive: f.positivePrompt,
      inlineNegative: f.negativePrompt,
      prepend: "",
      append: "",
    },
    architecture: FIXTURE_ARCHITECTURE[name],
  };
}

for (const [name, fields] of FIXTURES) {
  test(`specToParams byte-identical to legacy toParams: ${name}`, () => {
    const injections = presetFreeInjections(fields, name);
    const expected = legacyToParams(fields, injections);
    const actual = specToParams(specFromFields(fields), injections);
    assert.deepStrictEqual(actual, expected);
  });
}

// Exercise the injection plumbing (Artist Styles fragment + prompt-preset
// prepend/append + inline expansion) so the DI seam — not just the preset-free
// path — is byte-checked against the oracle.
test("specToParams byte-identical with non-empty injections", () => {
  const injections: SpecToParamsInjections = {
    styleFragment: "by artist foo, watercolor",
    resolvedPresets: {
      inlinePositive: "1girl, masterpiece",
      inlineNegative: "lowres, bad hands",
      prepend: "ultra detailed",
      append: "dramatic lighting",
    },
    architecture: "anima",
  };
  const expected = legacyToParams(animaTxt2img, injections);
  const actual = specToParams(specFromFields(animaTxt2img), injections);
  assert.deepStrictEqual(actual, expected);
});

// Scheduling + NAI-weight syntax must survive the assembler unchanged.
test("specToParams byte-identical with scheduling + NAI weight syntax", () => {
  const fields: GenerationFields = {
    ...animaTxt2img,
    positivePrompt: "1girl, {emphasized}, <from:0.5>late detail</from>, [de-emphasized]",
    negativePrompt: "1.2::strong negative::, lowres",
  };
  const injections: SpecToParamsInjections = {
    styleFragment: "",
    resolvedPresets: {
      inlinePositive: fields.positivePrompt,
      inlineNegative: fields.negativePrompt,
      prepend: "",
      append: "",
    },
    architecture: "anima",
  };
  const expected = legacyToParams(fields, injections);
  const actual = specToParams(specFromFields(fields), injections);
  assert.deepStrictEqual(actual, expected);
});
