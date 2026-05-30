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

/**
 * The injectable payload a user-preset Workflow carries (Phase 7). Built-ins have
 * none — they assemble in Rust. A preset stores its ComfyUI API graph plus the
 * map from each declared slot to the node id that bears its `@slot:` tag, so the
 * slot-injector (`workflows/inject.ts`) can fill it without re-parsing.
 */
export interface PresetPayload {
  /** The imported ComfyUI API-format graph (nodeId → node). */
  graph: Record<string, unknown>;
  /** slot name → the node id tagged `@slot:<name>`. */
  slotNodes: Partial<Record<SlotName, string>>;
}

/** A Workflow in the catalog: its identity, origin, and the slots it exposes. */
export interface Workflow {
  /** Stable id; for built-ins this matches the Rust `templates/` module name. */
  id: string;
  label: string;
  origin: WorkflowOrigin;
  /**
   * The `mode` passed to the Rust `build_workflow` for a base Workflow, or `null`
   * for a feature pipeline (upscale / facefix / controlnet) that is layered onto
   * a base graph via a toggle rather than selected standalone. A user preset runs
   * through the slot-injector + raw submit, not `build_workflow`, so its `mode` is
   * informational only.
   */
  mode: "txt2img" | "img2img" | "inpainting" | null;
  slots: SlotDecl[];
  /** Present only for `origin: "user-preset"` — the graph + slot→node map. */
  preset?: PresetPayload;
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

/** All registered Workflows — built-ins and imported user presets, one catalog
 *  (story 43: the Agent and Profiles select from a single list). */
export function listWorkflows(): Workflow[] {
  return [...WORKFLOWS_BY_ID.values()];
}

/** Look up a Workflow by id, or `undefined` if not registered. */
export function getWorkflow(id: string): Workflow | undefined {
  return WORKFLOWS_BY_ID.get(id);
}

/**
 * Register (or replace) a user-preset Workflow into the shared catalog (Phase 7).
 * Built-in ids are protected — a preset can never shadow `txt2img` et al. Returns
 * the registered Workflow. The presets store calls this on import and on hydrate.
 */
export function registerWorkflow(workflow: Workflow): Workflow {
  const existing = WORKFLOWS_BY_ID.get(workflow.id);
  if (existing && existing.origin === "builtin") {
    throw new Error(`Cannot override built-in Workflow "${workflow.id}".`);
  }
  WORKFLOWS_BY_ID.set(workflow.id, workflow);
  return workflow;
}

/** Remove a user-preset Workflow from the catalog. Built-ins are never removed. */
export function unregisterWorkflow(id: string): void {
  const existing = WORKFLOWS_BY_ID.get(id);
  if (existing && existing.origin === "user-preset") WORKFLOWS_BY_ID.delete(id);
}

/** Whether an id is already taken (built-in or an imported preset). */
export function workflowIdExists(id: string): boolean {
  return WORKFLOWS_BY_ID.has(id);
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
