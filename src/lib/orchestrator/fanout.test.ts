/**
 * Fan-out tests (Phase 6). These pin the *external behaviour* that makes cast and
 * fan-out distinct concepts: a plan expands to one resolved Spec per item, each
 * axis multiplies, transient per-image fields (cast/seed) derive correctly, and
 * the ordering groups by model without dropping or duplicating any Spec.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { expandFanout, orderByModel, fanoutSize, modelKey } from "./fanout.ts";
import { specFromFields } from "../spec/projection.ts";
import { animaTxt2img, sdxlEverything } from "../spec/fixtures.ts";
import type { ResolvedSpec } from "../spec/spec.ts";

/** A concrete resolved Spec to fan out from (anima, pinned seed 123456, batch 4). */
const base: ResolvedSpec = specFromFields(animaTxt2img);

test("a bare seed sweep emits N Specs, batch forced to 1, deterministic seeds from a pinned base", () => {
  const specs = expandFanout(base, { seedsPerItem: 4 });
  assert.equal(specs.length, 4);
  // base seed is 123456 (pinned) ⇒ deterministic sweep base+i.
  assert.deepEqual(specs.map((s) => s.sampling.seed), [123456, 123457, 123458, 123459]);
  // one Spec per item — the base's batch:4 must not leak through as multiplicity.
  assert.ok(specs.every((s) => s.dimensions.batch === 1));
});

test("a single image keeps the base seed verbatim (reproducible one-off)", () => {
  const specs = expandFanout(base, { seedsPerItem: 1 });
  assert.equal(specs.length, 1);
  assert.equal(specs[0]!.sampling.seed, 123456);
});

test("a random base seed rolls a fresh seed per image (never a fixed sweep)", () => {
  const random = { ...base, sampling: { ...base.sampling, seed: -1 } };
  const specs = expandFanout(random, { seedsPerItem: 3 });
  assert.deepEqual(specs.map((s) => s.sampling.seed), [-1, -1, -1]);
});

test("a roster emits one Spec per character, each the single-cast frame (cast ≠ fan-out)", () => {
  const specs = expandFanout(base, {
    roster: [
      { character: "char-a", tags: "hatsune miku, twintails", lora: { name: "miku.safetensors", weight: 0.8 } },
      { character: "char-b" },
    ],
  });
  assert.equal(specs.length, 2);
  assert.equal(specs[0]!.cast.length, 1);
  assert.equal(specs[0]!.cast[0]!.character, "char-a");
  assert.equal(specs[0]!.cast[0]!.region, "auto"); // defaulted
  // the grounded slice projects DOWN into the projectable fields (the store drops cast).
  assert.ok(specs[0]!.subject.positive.includes("hatsune miku"));
  assert.ok(specs[0]!.model.loras.some((l) => l.name === "miku.safetensors" && l.enabled));
  assert.equal(specs[1]!.cast[0]!.character, "char-b");
  // char-b carries no grounding, so the base LoRA stack is untouched.
  assert.equal(specs[1]!.model.loras.length, base.model.loras.length);
  // provenance label carries the varying axis.
  assert.equal(specs[0]!.intent, "char-a");
});

test("roster × seeds is the cross-product (the 50×4 roster run, in miniature)", () => {
  const roster = [{ character: "a" }, { character: "b" }, { character: "c" }];
  const plan = { roster, seedsPerItem: 4 };
  assert.equal(fanoutSize(plan), 12);
  const specs = expandFanout(base, plan);
  assert.equal(specs.length, 12);
  // roster-major: a's four images come before b's.
  assert.deepEqual(specs.slice(0, 4).map((s) => s.cast[0]!.character), ["a", "a", "a", "a"]);
  assert.deepEqual(specs.slice(0, 4).map((s) => s.sampling.seed), [123456, 123457, 123458, 123459]);
});

test("an outfit axis merges into the positive prompt, deduped, one Spec each", () => {
  const specs = expandFanout(base, { outfits: ["school uniform", "red dress"] });
  assert.equal(specs.length, 2);
  assert.ok(specs[0]!.subject.positive.includes("school uniform"));
  assert.ok(specs[1]!.subject.positive.includes("red dress"));
  // the base subject tags survive the merge.
  assert.ok(specs[0]!.subject.positive.startsWith(base.subject.positive));
});

test("expanded Specs are independent clones (no shared references to the base)", () => {
  const specs = expandFanout(base, { roster: [{ character: "a" }, { character: "b" }] });
  specs[0]!.subject.positive = "MUTATED";
  assert.notEqual(specs[1]!.subject.positive, "MUTATED");
  assert.notEqual(base.subject.positive, "MUTATED");
});

test("orderByModel groups identical models adjacently and is stable + lossless", () => {
  // anima base uses split-model diffusion "anima_diffusion.safetensors"; sdxl uses
  // checkpoint "SIH-1.5.safetensors" (split-model off).
  const anima1 = { ...structuredClone(base), intent: "anima-1" };
  const anima2 = { ...structuredClone(base), intent: "anima-2" };
  const sdxl1 = { ...specFromFields(sdxlEverything), intent: "sdxl-1" };
  const sdxl2 = { ...specFromFields(sdxlEverything), intent: "sdxl-2" };
  // interleave so a naive pass would thrash models.
  const ordered = orderByModel([anima1, sdxl1, anima2, sdxl2]);

  // no Spec dropped or duplicated.
  assert.equal(ordered.length, 4);
  // each model contiguous.
  const keys = ordered.map(modelKey);
  assert.equal(new Set(keys).size, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[2], keys[3]);
  // within a model, original (expansion) order preserved.
  const animaIntents = ordered.filter((s) => modelKey(s) === modelKey(anima1)).map((s) => s.intent);
  assert.deepEqual(animaIntents, ["anima-1", "anima-2"]);
});

test("orderByModel does not mutate its input", () => {
  const input = [specFromFields(sdxlEverything), structuredClone(base)];
  const snapshotFirst = input[0]!.model.checkpoint;
  orderByModel(input);
  assert.equal(input[0]!.model.checkpoint, snapshotFirst);
});
