/**
 * Slot-injector — the user-preset assembly path (Phase 7, ADR 0003).
 *
 * The assembly seam keeps both Workflow origins open: `spec/specToParams.ts`
 * produces *path-neutral resolved slot-values*; the built-in Rust builders consume
 * them one way, and THIS injector consumes the same values the other way — filling
 * an imported preset graph at its `@slot:`-tagged nodes. The Spec→values rules are
 * shared; only this final injection step differs from the built-in path.
 *
 * Deterministic and pure: it writes each slot's value into a conventional widget
 * key on the tagged node (a fixed slot→widget table — NOT class_type inference,
 * the design's explicit constraint). Anything it cannot place — a slot tagged on a
 * node without that widget, a value not applicable to the run, the LoRA stack
 * (which needs graph rewiring, out of scope) — is reported as a warning, never
 * silently dropped.
 */

import type { ResolvedSlotValues } from "../spec/specToParams.ts";
import type { Workflow, SlotName } from "./registry.ts";
import type { ComfyGraph } from "./import.ts";

/**
 * The conventional ComfyUI widget key each slot writes into. These are the
 * standard widget names on the node types that bear each value (CLIPTextEncode's
 * `text`, CheckpointLoaderSimple's `ckpt_name`, KSampler's `seed`, …). The
 * injector tries this key first, then the slot name, then a generic `value`, so a
 * primitive/reroute node works too — but it never inspects `class_type`.
 */
const SLOT_WIDGET_KEY: Record<SlotName, string> = {
  positive_prompt: "text",
  negative_prompt: "text",
  checkpoint: "ckpt_name",
  vae: "vae_name",
  loras: "", // unsupported — see below
  seed: "seed",
  sampler: "sampler_name",
  scheduler: "scheduler",
  steps: "steps",
  cfg: "cfg",
  width: "width",
  height: "height",
  batch_size: "batch_size",
  denoise: "denoise",
  input_image: "image",
  mask_image: "image",
  grow_mask_by: "expand",
  upscale_model: "model_name",
  controlnet_model: "control_net_name",
  controlnet_image: "image",
  facefix_detector: "model_name",
};

/**
 * The value each slot injects, pulled from the path-neutral slot-values. Returns
 * `undefined` when the run does not supply that value (e.g. no mask on a txt2img
 * run) so the injector leaves the preset's own default untouched. `loras` returns
 * `undefined` — stack injection is unsupported (warned separately).
 */
function valueForSlot(slot: SlotName, v: ResolvedSlotValues): string | number | null | undefined {
  switch (slot) {
    case "positive_prompt": return v.positivePrompt;
    case "negative_prompt": return v.negativePrompt;
    case "checkpoint": return v.checkpoint;
    case "vae": return v.splitModel.vae ?? undefined;
    case "seed": return v.seed;
    case "sampler": return v.sampler;
    case "scheduler": return v.scheduler;
    case "steps": return v.steps;
    case "cfg": return v.cfg;
    case "width": return v.width;
    case "height": return v.height;
    case "batch_size": return v.batch;
    case "denoise": return v.denoise;
    case "input_image": return v.inputImage ?? undefined;
    case "mask_image": return v.maskImage ?? undefined;
    case "grow_mask_by": return v.growMaskBy;
    case "upscale_model": return v.upscale.model ?? undefined;
    case "controlnet_model": return v.controlnet.model ?? undefined;
    case "controlnet_image": return v.controlnet.image ?? undefined;
    case "facefix_detector": return v.facefix.detector ?? undefined;
    case "loras": return undefined;
  }
}

export interface InjectResult {
  /** The filled graph, ready to submit to ComfyUI. A deep clone — never mutates the preset. */
  graph: ComfyGraph;
  /** Problems the Operator should see (unplaceable slot, unsupported LoRA stack, …). */
  warnings: string[];
}

/** Pick the widget key to write on a node: conventional → slot name → generic `value`. */
function targetKey(inputs: Record<string, unknown>, slot: SlotName): string | null {
  for (const key of [SLOT_WIDGET_KEY[slot], slot, "value"]) {
    if (key && key in inputs) return key;
  }
  return null;
}

/**
 * Fill a user-preset Workflow's graph from the resolved slot-values, returning a
 * new graph ready for a raw ComfyUI submit. Each declared slot is written into its
 * tagged node's conventional widget. Throws if the Workflow is not an importable
 * preset (no graph) — that is a programming error, not operator input.
 */
export function injectSlots(workflow: Workflow, values: ResolvedSlotValues): InjectResult {
  if (workflow.origin !== "user-preset" || !workflow.preset) {
    throw new Error(`Workflow "${workflow.id}" is not a user preset — nothing to inject.`);
  }

  const graph = structuredClone(workflow.preset.graph) as ComfyGraph;
  const warnings: string[] = [];

  for (const [slot, nodeId] of Object.entries(workflow.preset.slotNodes) as [SlotName, string][]) {
    if (slot === "loras") {
      warnings.push("LoRA-stack injection into presets is unsupported — bake LoRAs into the preset graph.");
      continue;
    }
    const node = graph[nodeId];
    if (!node) {
      warnings.push(`Slot "${slot}" points at missing node "${nodeId}".`);
      continue;
    }
    const value = valueForSlot(slot, values);
    if (value === undefined) continue; // run doesn't supply it — keep the preset's default

    const key = targetKey(node.inputs, slot);
    if (!key) {
      warnings.push(`Node "${nodeId}" (slot "${slot}") has no "${SLOT_WIDGET_KEY[slot]}" widget to fill — skipped.`);
      continue;
    }
    node.inputs[key] = value;
  }

  return { graph, warnings };
}
