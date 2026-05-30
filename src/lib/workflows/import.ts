/**
 * User ComfyUI preset importer (Phase 7, ADR 0003).
 *
 * v1 runs on the built-in Rust Workflows; this is the build-later path the
 * abstraction was designed for in Phase 2. The Operator exports a graph from
 * ComfyUI ("Save (API Format)") and tags the nodes they want the app to fill with
 * `@slot:<name>` titles (`@slot:positive_prompt`, `@slot:seed`, …). This module
 * turns that graph into a registrable **Workflow** (origin `user-preset`): it
 * finds the tagged nodes, records the slot→node map the injector will use, and
 * surfaces every problem (unknown tags, duplicates, missing core slots) instead
 * of failing silently — a malformed import must be loud, not lossy.
 *
 * Pure and UI-free: parsing is deterministic, with no node-type inference (the
 * design's explicit choice — slots are declared, never guessed from class_type).
 */

import { parseSlotTag, type SlotName, type Workflow, type SlotDecl } from "./registry.ts";

/** One node in a ComfyUI API-format graph. */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  /** API-format carries the node title here. */
  _meta?: { title?: string };
  /** Some exports put the title at the top level — accepted as a fallback. */
  title?: string;
}

/** A ComfyUI API-format graph: node id → node. */
export type ComfyGraph = Record<string, ComfyNode>;

export interface ImportResult {
  /** The registrable Workflow (not yet in the catalog — the store registers it). */
  workflow: Workflow;
  /** Non-fatal problems the Operator should see (unknown tags, duplicates, …). */
  warnings: string[];
}

/** The title a node declares its slot through (`_meta.title` wins; `title` fallback). */
function nodeTitle(node: ComfyNode): string {
  return node._meta?.title ?? node.title ?? "";
}

/** The core slots a renderable preset almost always needs — a missing one is warned. */
const EXPECTED_CORE: SlotName[] = ["positive_prompt", "checkpoint", "seed"];

/**
 * Structurally validate that `value` is a ComfyUI API graph (an object whose
 * entries each have a `class_type` string and an `inputs` object). Throws with a
 * precise message otherwise, so a bad paste fails loudly at the import boundary.
 */
export function assertComfyGraph(value: unknown): asserts value is ComfyGraph {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Not a ComfyUI API graph: expected an object of nodes.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) throw new Error("Empty graph: no nodes found.");
  for (const [id, node] of entries) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(`Node "${id}" is not an object.`);
    }
    const n = node as Record<string, unknown>;
    if (typeof n.class_type !== "string") throw new Error(`Node "${id}" is missing a string "class_type".`);
    if (n.inputs === null || typeof n.inputs !== "object" || Array.isArray(n.inputs)) {
      throw new Error(`Node "${id}" is missing an "inputs" object.`);
    }
  }
}

/**
 * Import a ComfyUI API graph as a user-preset Workflow. Scans every node's title
 * for an `@slot:` tag; a recognised tag records the node as that slot's injection
 * point. Throws only for a structurally invalid graph; everything else (an
 * `@slot:` tag naming an unknown slot, the same slot tagged twice, no tags at all,
 * a missing core slot) is a warning so the Operator can wire the graph correctly.
 */
export function importPresetGraph(
  rawGraph: unknown,
  opts: { id: string; label: string; mode?: Workflow["mode"] },
): ImportResult {
  assertComfyGraph(rawGraph);
  const graph = rawGraph;

  const warnings: string[] = [];
  const slotNodes: Partial<Record<SlotName, string>> = {};

  for (const [nodeId, node] of Object.entries(graph)) {
    const title = nodeTitle(node).trim();
    if (!title.startsWith("@slot:")) continue;

    const slot = parseSlotTag(title);
    if (slot === null) {
      warnings.push(`Node "${nodeId}" tags an unknown slot ("${title}") — ignored.`);
      continue;
    }
    if (slotNodes[slot]) {
      warnings.push(`Slot "${slot}" is tagged on multiple nodes; using "${slotNodes[slot]}", ignoring "${nodeId}".`);
      continue;
    }
    slotNodes[slot] = nodeId;
  }

  const found = Object.keys(slotNodes) as SlotName[];
  if (found.length === 0) {
    warnings.push("No @slot: tags found — this preset has no injectable points.");
  }
  for (const core of EXPECTED_CORE) {
    if (!slotNodes[core]) warnings.push(`No @slot:${core} node — the app cannot set the ${core}.`);
  }

  const slots: SlotDecl[] = found.map((name) => ({ name, description: `Imported @slot:${name}` }));

  const workflow: Workflow = {
    id: opts.id,
    label: opts.label,
    origin: "user-preset",
    mode: opts.mode ?? "txt2img",
    slots,
    preset: { graph: graph as Record<string, unknown>, slotNodes },
  };

  return { workflow, warnings };
}
