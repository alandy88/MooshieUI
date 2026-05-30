/**
 * Built-in style presets — pure, deterministic data consumed by the Spec→params
 * assembler (`specToParams`). Moved out of the rune-bound generation store so the
 * assembler stays headless-testable. The store re-imports these for its dropdown
 * options (`stylePresetOptions`) and its `stylePreset` field type.
 */

export type StylePresetId =
  | "none"
  | "anime"
  | "cinematic"
  | "photoreal"
  | "digital_art"
  | "line_art";

export interface StylePreset {
  id: StylePresetId;
  label: string;
  positive: string;
  negative: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "none",
    label: "None",
    positive: "",
    negative: "",
  },
  {
    id: "anime",
    label: "Anime",
    positive: "anime style, vibrant colors, clean linework, detailed illustration",
    negative: "photo, realistic skin texture, grainy",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    positive: "cinematic lighting, dramatic composition, film still, volumetric light",
    negative: "flat lighting, low contrast",
  },
  {
    id: "photoreal",
    label: "Photoreal",
    positive: "photorealistic, ultra-detailed, natural lighting, high dynamic range",
    negative: "cartoon, anime, painting, cgi",
  },
  {
    id: "digital_art",
    label: "Digital Art",
    positive: "digital painting, concept art, painterly details, high detail",
    negative: "low detail, flat colors",
  },
  {
    id: "line_art",
    label: "Line Art",
    positive: "line art, clean outlines, monochrome illustration",
    negative: "heavy shading, photorealistic texture, noisy background",
  },
];
