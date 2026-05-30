/**
 * Lightweight Workflow registry + `@slot:` model (ADR 0003, frontend design
 * §"Workflows: built-in builders + user presets").
 *
 * A **Workflow** is the ComfyUI graph for one operation, filled by injecting a
 * resolved Spec's values into declared slots. Two origins coexist:
 *
 *   - **built-in** — today's Rust `templates/` builders (txt2img / img2img /
 *     inpaint base graphs + upscale / facefix / controlnet pipelines layered on
 *     top). They keep their baked-in correctness (Anima split-model VAE, per-
 *     architecture defaults, the facefix detailer chain) and are the v1 path.
 *   - **user-preset** — imported ComfyUI API graphs whose nodes declare injectable
 *     points via `@slot:<name>` title tags. **Deferred** (Phase 7): only the
 *     `@slot:` model + parser are built here; the importer + slot-injector are not.
 *
 * This registry is just a *catalog*: each Workflow lists the slots it exposes. A
 * Pipeline Profile selects a Workflow from here — that is all the registry does
 * (no resolver service; the Profile carries the defaults). Per the PRD this
 * module is exercised through behaviour, not isolated unit tests.
 */

/**
 * The canonical injectable-slot vocabulary — the `@slot:<name>` names a user
 * preset may tag, and the keys a slot-injector would fill from the neutral
 * resolved slot-values (`ResolvedSlotValues` in spec/specToParams.ts). snake_case
 * to match both the node-title convention and the `GenerationParams` field names.
 */
export const SLOT_NAMES = [
  "positive_prompt",
  "negative_prompt",
  "checkpoint",
  "vae",
  "loras",
  "seed",
  "sampler",
  "scheduler",
  "steps",
  "cfg",
  "width",
  "height",
  "batch_size",
  "denoise",
  "input_image",
  "mask_image",
  "grow_mask_by",
  "upscale_model",
  "controlnet_model",
  "controlnet_image",
  "facefix_detector",
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

const SLOT_NAME_SET: ReadonlySet<string> = new Set(SLOT_NAMES);

/** A declared injectable point on a Workflow. */
export interface SlotDecl {
  name: SlotName;
  /** Human-readable purpose of the slot (shown when wiring a user preset). */
  description: string;
}

export type WorkflowOrigin = "builtin" | "user-preset";

/** A Workflow in the catalog: its identity, origin, and the slots it exposes. */
export interface Workflow {
  /** Stable id; for built-ins this matches the Rust `templates/` module name. */
  id: string;
  label: string;
  origin: WorkflowOrigin;
  /**
   * The `mode` passed to the Rust `build_workflow` for a base Workflow, or `null`
   * for a feature pipeline (upscale / facefix / controlnet) that is layered onto
   * a base graph via a toggle rather than selected standalone.
   */
  mode: "txt2img" | "img2img" | "inpainting" | null;
  slots: SlotDecl[];
}

/** Slots every Workflow exposes (the core sampling + model points). */
const CORE_SLOTS: SlotDecl[] = [
  { name: "positive_prompt", description: "Positive conditioning text" },
  { name: "negative_prompt", description: "Negative conditioning text" },
  { name: "checkpoint", description: "Checkpoint / base model file" },
  { name: "vae", description: "VAE file (split-model setups)" },
  { name: "loras", description: "LoRA stack (name + strengths)" },
  { name: "seed", description: "Sampler seed" },
  { name: "sampler", description: "Sampler name" },
  { name: "scheduler", description: "Scheduler name" },
  { name: "steps", description: "Sampling steps" },
  { name: "cfg", description: "CFG scale" },
  { name: "width", description: "Latent width" },
  { name: "height", description: "Latent height" },
  { name: "batch_size", description: "Batch size" },
  { name: "denoise", description: "Denoise strength" },
];

const INPUT_IMAGE_SLOT: SlotDecl = { name: "input_image", description: "Source image (img2img / inpaint)" };
const MASK_SLOTS: SlotDecl[] = [
  { name: "mask_image", description: "Inpaint mask image" },
  { name: "grow_mask_by", description: "Mask grow/feather amount" },
];

/** The six built-in Workflows, mapped to the Rust `templates/` modules. */
export const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    id: "txt2img",
    label: "Text to Image",
    origin: "builtin",
    mode: "txt2img",
    slots: [...CORE_SLOTS],
  },
  {
    id: "img2img",
    label: "Image to Image",
    origin: "builtin",
    mode: "img2img",
    slots: [...CORE_SLOTS, INPUT_IMAGE_SLOT],
  },
  {
    id: "inpainting",
    label: "Inpaint",
    origin: "builtin",
    mode: "inpainting",
    slots: [...CORE_SLOTS, INPUT_IMAGE_SLOT, ...MASK_SLOTS],
  },
  {
    id: "upscale",
    label: "Upscale",
    origin: "builtin",
    mode: null,
    slots: [...CORE_SLOTS, { name: "upscale_model", description: "Upscale model (model method)" }],
  },
  {
    id: "facefix",
    label: "Face Fix",
    origin: "builtin",
    mode: null,
    slots: [...CORE_SLOTS, { name: "facefix_detector", description: "Face detector model" }],
  },
  {
    id: "controlnet",
    label: "ControlNet",
    origin: "builtin",
    mode: null,
    slots: [
      ...CORE_SLOTS,
      { name: "controlnet_model", description: "ControlNet model file" },
      { name: "controlnet_image", description: "ControlNet guide image" },
    ],
  },
];

const WORKFLOWS_BY_ID: Map<string, Workflow> = new Map(BUILTIN_WORKFLOWS.map((w) => [w.id, w]));

/** All registered Workflows (built-ins now; user presets register here later). */
export function listWorkflows(): Workflow[] {
  return [...WORKFLOWS_BY_ID.values()];
}

/** Look up a Workflow by id, or `undefined` if not registered. */
export function getWorkflow(id: string): Workflow | undefined {
  return WORKFLOWS_BY_ID.get(id);
}

/**
 * Parse a ComfyUI node title into the slot it declares. A user preset marks an
 * injectable node by titling it `@slot:<name>` (e.g. `@slot:positive_prompt`).
 * Returns the slot name for a recognised tag, else `null` (untagged node, or an
 * `@slot:` tag naming an unknown slot — surfaced to the importer in Phase 7).
 */
const SLOT_TAG = /^@slot:([a-z0-9_]+)$/;
export function parseSlotTag(nodeTitle: string): SlotName | null {
  const match = SLOT_TAG.exec(nodeTitle.trim());
  if (!match) return null;
  const name = match[1];
  return SLOT_NAME_SET.has(name) ? (name as SlotName) : null;
}
