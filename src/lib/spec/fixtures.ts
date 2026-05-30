/**
 * Shared test fixtures — the three `GenerationFields` snapshots the spike used,
 * reused by both the round-trip test (projection.test.ts) and the byte-diff test
 * (specToParams.test.ts). Not a `*.test.ts` file, so the runner imports it
 * without trying to execute it as a suite.
 */

import type { GenerationFields } from "./projection.ts";
import type { ModelArchitecture } from "./specToParams.ts";

/** Anima txt2img — the production default (matches applyModelSpecificPreset). */
export const animaTxt2img: GenerationFields = {
  mode: "txt2img",
  positivePrompt: "1girl, uzui tengen, red background",
  negativePrompt: "lowres",
  stylePreset: "anime",
  stylePresetsEnabled: true,
  checkpoint: "anima_v1.safetensors",
  vae: "qwen_image_vae.safetensors",
  loras: [
    { name: "detail.safetensors", strength_model: 0.8, strength_clip: 0.8, enabled: true },
    { name: "style.safetensors", strength_model: 0.5, strength_clip: 0.5, enabled: false },
  ],
  samplerName: "er_sde",
  scheduler: "sgm_uniform",
  steps: 30,
  cfg: 4.0,
  seed: 123456,
  width: 1024,
  height: 1024,
  batchSize: 4,
  denoise: 0.7,
  inputImage: null,
  maskImage: null,
  growMaskBy: 6,
  differentialDiffusion: false,
  upscaleEnabled: false,
  upscaleMethod: "algorithmic",
  upscaleModel: null,
  upscaleScale: 2.0,
  upscaleDenoise: 0.4,
  upscaleSteps: 10,
  upscaleTileSize: 1024,
  upscaleTiling: true,
  upscaleSoftGuidance: true,
  upscaleSoftGuidanceMultiplier: 0.4,
  smartGuidance: false,
  fluxGuidance: 3.5,
  useSplitModel: true,
  diffusionModel: "anima_diffusion.safetensors",
  clipModel: "qwen_clip.safetensors",
  clipType: "qwen_image",
  controlnetEnabled: false,
  controlnetMode: "preset",
  controlnetPreset: null,
  controlnetModel: null,
  controlnetPreprocessor: null,
  controlnetImage: null,
  controlnetStrength: 1.0,
  controlnetStartPercent: 0.0,
  controlnetEndPercent: 1.0,
  facefixEnabled: false,
  facefixDetector: null,
  facefixDenoise: 0.4,
  facefixSteps: 10,
  facefixGuideSize: 512,
  facefixMaxFaces: 8,
  outputBitDepth: "8bit",
  outputFormat: "png",
  metadataMode: "both",
  autoQualityTags: true,
  customAnimaPositiveQuality: "newest, masterpiece, best quality",
  customAnimaNegativeQuality: "worst quality, low quality",
  customIllustriousPositiveQuality: "best quality, masterpiece",
  customIllustriousNegativeQuality: "worst quality, bad anatomy",
  customPonyPositiveQuality: "score_9, score_8_up",
  customPonyNegativeQuality: "score_1, score_2",
  customNanosaurPositiveQuality: "newest, masterpiece",
  customNanosaurNegativeQuality: "oldest, low quality",
};

/** SDXL with every pipeline feature engaged — exercises the escape-hatch tier. */
export const sdxlEverything: GenerationFields = {
  ...animaTxt2img,
  positivePrompt: "landscape, cinematic",
  stylePreset: "cinematic",
  checkpoint: "SIH-1.5.safetensors",
  vae: "sdxl_vae.safetensors",
  samplerName: "euler_cfg_pp",
  cfg: 1.4,
  steps: 20,
  useSplitModel: false,
  diffusionModel: null,
  clipModel: null,
  clipType: null,
  smartGuidance: true,
  upscaleEnabled: true,
  upscaleMethod: "model",
  upscaleModel: "4x-UltraSharp.pth",
  controlnetEnabled: true,
  controlnetMode: "custom",
  controlnetModel: "control_depth.safetensors",
  controlnetPreprocessor: "depth_anything",
  controlnetImage: "input/pose.png",
  controlnetStrength: 0.6,
  facefixEnabled: true,
  facefixDetector: "bbox/face_yolov8m.pt",
  outputBitDepth: "16bit",
  outputFormat: "jxl",
  metadataMode: "stealth",
};

/** Inpaint with a mask — exercises the `input` tier. */
export const inpaint: GenerationFields = {
  ...animaTxt2img,
  mode: "inpainting",
  inputImage: "input/src.png",
  maskImage: "input/src.mask.png",
  growMaskBy: 12,
  differentialDiffusion: true,
  vae: "",
};

export const FIXTURES: Array<[string, GenerationFields]> = [
  ["anima txt2img", animaTxt2img],
  ["sdxl everything", sdxlEverything],
  ["inpaint w/ mask", inpaint],
];

/**
 * The architecture each fixture's model resolves to via the store's
 * `detectedArchitecture` getter (filename heuristics — "anima" matches anima,
 * "sih" matches the illustrious/NoobAI family). The byte-diff feeds the same
 * value to both the legacy oracle and `specToParams`, since architecture
 * detection is rune-bound and lives in the wrapper (an injection), not in the
 * pure assembler.
 */
export const FIXTURE_ARCHITECTURE: Record<string, ModelArchitecture> = {
  "anima txt2img": "anima",
  "sdxl everything": "illustrious",
  "inpaint w/ mask": "anima",
};
