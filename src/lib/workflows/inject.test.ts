/**
 * Slot-injector tests (Phase 7). These pin that the injector fills a preset's
 * tagged nodes from the same path-neutral slot-values the built-in path consumes,
 * never mutates the stored preset, and reports — rather than hides — anything it
 * cannot place (a slot on a widget-less node, the unsupported LoRA stack).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { importPresetGraph, type ComfyGraph } from "./import.ts";
import { injectSlots } from "./inject.ts";
import { resolveSlotValues, type SpecToParamsInjections } from "../spec/specToParams.ts";
import { specFromFields } from "../spec/projection.ts";
import { animaTxt2img } from "../spec/fixtures.ts";

/** Neutral injections — no external styles/presets, anima architecture. */
const INJECTIONS: SpecToParamsInjections = {
  styleFragment: "",
  resolvedPresets: { inlinePositive: animaTxt2img.positivePrompt, inlineNegative: animaTxt2img.negativePrompt, prepend: "", append: "" },
  architecture: "anima",
};

const values = resolveSlotValues(specFromFields(animaTxt2img), INJECTIONS);

function graphWith(extra: ComfyGraph = {}): ComfyGraph {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "OLD" }, _meta: { title: "@slot:checkpoint" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "OLD", clip: ["1", 1] }, _meta: { title: "@slot:positive_prompt" } },
    "4": { class_type: "KSampler", inputs: { seed: -999, steps: 1, model: ["1", 0] }, _meta: { title: "@slot:seed" } },
    ...extra,
  };
}

test("injects each tagged node's conventional widget from the resolved slot-values", () => {
  const { workflow } = importPresetGraph(graphWith(), { id: "p", label: "P" });
  const { graph, warnings } = injectSlots(workflow, values);

  assert.equal(graph["1"]!.inputs.ckpt_name, values.checkpoint); // CheckpointLoaderSimple.ckpt_name
  assert.equal(graph["2"]!.inputs.text, values.positivePrompt); // CLIPTextEncode.text
  assert.equal(graph["4"]!.inputs.seed, values.seed); // KSampler.seed
  // untouched inputs survive (the wired connection on node 2).
  assert.deepEqual(graph["2"]!.inputs.clip, ["1", 1]);
  assert.deepEqual(warnings, []);
});

test("does not mutate the stored preset graph (deep clone)", () => {
  const { workflow } = importPresetGraph(graphWith(), { id: "p", label: "P" });
  injectSlots(workflow, values);
  // the preset's own copy still holds the placeholder, not the injected value.
  const stored = workflow.preset!.graph as ComfyGraph;
  assert.equal(stored["1"]!.inputs.ckpt_name, "OLD");
  assert.equal(stored["2"]!.inputs.text, "OLD");
});

test("falls back to the slot name, then `value`, when the conventional widget is absent", () => {
  // a primitive-style node whose value widget is the slot name.
  const graph = graphWith({
    "5": { class_type: "PrimitiveInt", inputs: { value: 0 }, _meta: { title: "@slot:steps" } },
  });
  const { workflow } = importPresetGraph(graph, { id: "p", label: "P" });
  const { graph: filled } = injectSlots(workflow, values);
  assert.equal(filled["5"]!.inputs.value, values.steps);
});

test("a slot on a node with no matching widget is warned, not silently dropped", () => {
  const graph = graphWith({
    "6": { class_type: "Reroute", inputs: { other: 1 }, _meta: { title: "@slot:cfg" } },
  });
  const { workflow } = importPresetGraph(graph, { id: "p", label: "P" });
  const { graph: filled, warnings } = injectSlots(workflow, values);
  assert.equal(filled["6"]!.inputs.other, 1); // untouched
  assert.ok(warnings.some((w) => w.includes("cfg") && w.includes("widget")));
});

test("the LoRA stack slot is reported as unsupported (needs graph rewiring)", () => {
  const graph = graphWith({
    "7": { class_type: "LoraLoader", inputs: { lora_name: "x" }, _meta: { title: "@slot:loras" } },
  });
  const { workflow } = importPresetGraph(graph, { id: "p", label: "P" });
  const { warnings } = injectSlots(workflow, values);
  assert.ok(warnings.some((w) => w.toLowerCase().includes("lora")));
});

test("rejects injecting into a non-preset Workflow", () => {
  const notAPreset = { id: "x", label: "X", origin: "builtin" as const, mode: "txt2img" as const, slots: [] };
  assert.throws(() => injectSlots(notAPreset, values), /not a user preset/);
});
