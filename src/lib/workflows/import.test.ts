/**
 * Preset importer tests (Phase 7). These pin the external behaviour: a tagged
 * graph yields a registrable user-preset Workflow with the right slot→node map,
 * a structurally bad graph fails loudly, and every wiring problem (unknown tag,
 * duplicate, missing core slot, no tags) surfaces as a warning — never silently.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { importPresetGraph, assertComfyGraph, type ComfyGraph } from "./import.ts";

/** A minimal, well-tagged ComfyUI API graph (the shape a "Save (API Format)" export has). */
const goodGraph: ComfyGraph = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "base.safetensors" }, _meta: { title: "@slot:checkpoint" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "placeholder", clip: ["1", 1] }, _meta: { title: "@slot:positive_prompt" } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "placeholder", clip: ["1", 1] }, _meta: { title: "@slot:negative_prompt" } },
  "4": { class_type: "KSampler", inputs: { seed: 0, steps: 20, cfg: 7, model: ["1", 0] }, _meta: { title: "@slot:seed" } },
  "5": { class_type: "MooshieSaveImage", inputs: { images: ["4", 0] }, _meta: { title: "Save" } },
};

test("imports a tagged graph into a user-preset Workflow with the slot→node map", () => {
  const { workflow, warnings } = importPresetGraph(goodGraph, { id: "my-preset", label: "My Preset" });
  assert.equal(workflow.origin, "user-preset");
  assert.equal(workflow.id, "my-preset");
  assert.deepEqual(workflow.preset?.slotNodes, {
    checkpoint: "1",
    positive_prompt: "2",
    negative_prompt: "3",
    seed: "4",
  });
  // slot declarations mirror what was found.
  assert.deepEqual(workflow.slots.map((s) => s.name).sort(), ["checkpoint", "negative_prompt", "positive_prompt", "seed"]);
  // the graph is carried for the injector.
  assert.ok(workflow.preset?.graph["5"]);
  // all core slots present ⇒ no warnings.
  assert.deepEqual(warnings, []);
});

test("an @slot: tag naming an unknown slot is warned and ignored, not fatal", () => {
  const graph: ComfyGraph = {
    ...goodGraph,
    "9": { class_type: "Note", inputs: {}, _meta: { title: "@slot:made_up_slot" } },
  };
  const { workflow, warnings } = importPresetGraph(graph, { id: "p", label: "P" });
  assert.ok(!Object.values(workflow.preset!.slotNodes).includes("9"));
  assert.ok(warnings.some((w) => w.includes("unknown slot") && w.includes("made_up_slot")));
});

test("a slot tagged twice keeps the first node and warns about the rest", () => {
  const graph: ComfyGraph = {
    ...goodGraph,
    "6": { class_type: "CLIPTextEncode", inputs: { text: "x" }, _meta: { title: "@slot:positive_prompt" } },
  };
  const { workflow, warnings } = importPresetGraph(graph, { id: "p", label: "P" });
  assert.equal(workflow.preset?.slotNodes.positive_prompt, "2"); // first wins
  assert.ok(warnings.some((w) => w.includes("multiple nodes") && w.includes("positive_prompt")));
});

test("a graph with no tags imports but warns it has no injectable points", () => {
  const graph: ComfyGraph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "x" } },
    "2": { class_type: "KSampler", inputs: { seed: 1 } },
  };
  const { workflow, warnings } = importPresetGraph(graph, { id: "p", label: "P" });
  assert.equal(workflow.slots.length, 0);
  assert.ok(warnings.some((w) => w.includes("No @slot: tags")));
});

test("missing core slots are warned (so the app knows it can't set them)", () => {
  const graph: ComfyGraph = {
    "2": { class_type: "CLIPTextEncode", inputs: { text: "x" }, _meta: { title: "@slot:positive_prompt" } },
  };
  const { warnings } = importPresetGraph(graph, { id: "p", label: "P" });
  assert.ok(warnings.some((w) => w.includes("@slot:checkpoint")));
  assert.ok(warnings.some((w) => w.includes("@slot:seed")));
});

test("a top-level `title` (not just _meta.title) is accepted as the tag source", () => {
  const graph: ComfyGraph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "x" }, title: "@slot:checkpoint" },
  };
  const { workflow } = importPresetGraph(graph, { id: "p", label: "P" });
  assert.equal(workflow.preset?.slotNodes.checkpoint, "1");
});

test("assertComfyGraph rejects non-graphs loudly", () => {
  assert.throws(() => assertComfyGraph(null), /expected an object/);
  assert.throws(() => assertComfyGraph([]), /expected an object/);
  assert.throws(() => assertComfyGraph({}), /Empty graph/);
  assert.throws(() => assertComfyGraph({ "1": { inputs: {} } }), /class_type/);
  assert.throws(() => assertComfyGraph({ "1": { class_type: "X" } }), /inputs/);
});
