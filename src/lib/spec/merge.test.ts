/**
 * Request → Resolved merge tests (the PRD-specified Spec-core cases): empty
 * request, full override, partial override, transient-field exclusion. Assert on
 * resulting Spec/field values, never on private helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { specFromFields } from "./projection.ts";
import { mergeIntoResolved, profileDefaultsFromResolved } from "./merge.ts";
import type { RequestSpec } from "./merge.ts";
import { animaTxt2img, sdxlEverything } from "./fixtures.ts";

test("empty request ⇒ resolved equals the Profile defaults", () => {
  const profile = profileDefaultsFromResolved(specFromFields(animaTxt2img));
  const resolved = mergeIntoResolved(profile, { profile: "anima-default" });
  assert.deepStrictEqual(resolved, profile);
});

test("full override ⇒ every spoken field wins over the Profile", () => {
  const profile = profileDefaultsFromResolved(specFromFields(sdxlEverything));
  const request: RequestSpec = {
    profile: "p",
    task: "edit",
    intent: "make it warmer",
    parent: "result-123",
    cast: [
      { character: "hash-1", promptOverride: null, lora: null, region: "left", weight: 1 },
    ],
    subject: {
      positive: "new positive",
      negative: "new negative",
      stylePreset: "photoreal",
      stylePresetsEnabled: false,
    },
    model: { checkpoint: "other.safetensors", loras: [] },
    sampling: { seed: 999, steps: 50, cfg: 7, sampler: "dpmpp_2m", scheduler: "karras", denoise: 0.5 },
    dimensions: { width: 768, height: 1152, batch: 2 },
    pipeline: { upscale: { enabled: false } },
  };

  const resolved = mergeIntoResolved(profile, request);

  assert.equal(resolved.task, "edit");
  assert.equal(resolved.intent, "make it warmer");
  assert.equal(resolved.parent, "result-123");
  assert.deepStrictEqual(resolved.cast, request.cast);
  assert.deepStrictEqual(resolved.subject, request.subject);
  assert.deepStrictEqual(resolved.sampling, request.sampling);
  assert.deepStrictEqual(resolved.dimensions, request.dimensions);
  assert.equal(resolved.model.checkpoint, "other.safetensors");
  assert.deepStrictEqual(resolved.model.loras, []);
  assert.equal(resolved.pipeline.upscale.enabled, false);
  // sibling pipeline fields the request did NOT speak to keep the Profile value
  assert.equal(resolved.pipeline.upscale.scale, profile.pipeline.upscale.scale);
});

test("partial override ⇒ defaults where silent, request where it speaks", () => {
  const profile = profileDefaultsFromResolved(specFromFields(animaTxt2img));
  const request: RequestSpec = {
    profile: "p",
    subject: { positive: "a lone astronaut" },
    sampling: { steps: 12 },
    pipeline: { facefix: { enabled: true } },
  };

  const resolved = mergeIntoResolved(profile, request);

  // spoken → request wins
  assert.equal(resolved.subject.positive, "a lone astronaut");
  assert.equal(resolved.sampling.steps, 12);
  assert.equal(resolved.pipeline.facefix.enabled, true);

  // silent → Profile defaults retained (including nested siblings)
  assert.equal(resolved.subject.negative, profile.subject.negative);
  assert.equal(resolved.subject.stylePreset, profile.subject.stylePreset);
  assert.equal(resolved.subject.stylePresetsEnabled, profile.subject.stylePresetsEnabled);
  assert.equal(resolved.sampling.cfg, profile.sampling.cfg);
  assert.equal(resolved.sampling.sampler, profile.sampling.sampler);
  assert.equal(resolved.sampling.denoise, profile.sampling.denoise);
  assert.equal(resolved.pipeline.facefix.steps, profile.pipeline.facefix.steps);
  assert.equal(resolved.pipeline.upscale.enabled, profile.pipeline.upscale.enabled);
  assert.deepStrictEqual(resolved.model, profile.model);
});

test("transient fields never leak into a saved Profile", () => {
  const resolved = specFromFields(animaTxt2img);
  resolved.cast = [
    { character: "hash-1", promptOverride: "x", lora: null, region: "auto", weight: 1 },
  ];
  resolved.intent = "some intent";
  resolved.parent = "result-9";
  resolved.sampling.seed = 424242;

  const profile = profileDefaultsFromResolved(resolved);

  // transient stripped to neutral defaults
  assert.deepStrictEqual(profile.cast, []);
  assert.equal(profile.intent, null);
  assert.equal(profile.parent, null);
  assert.equal(profile.sampling.seed, -1);

  // everything reusable is preserved
  assert.equal(profile.subject.positive, resolved.subject.positive);
  assert.equal(profile.model.checkpoint, resolved.model.checkpoint);
  assert.equal(profile.sampling.steps, resolved.sampling.steps);
  assert.deepStrictEqual(profile.pipeline, resolved.pipeline);

  // the merge round-trips: re-applying the original transient values reconstructs it
  const back = mergeIntoResolved(profile, {
    profile: "p",
    intent: resolved.intent,
    parent: resolved.parent,
    cast: resolved.cast,
    sampling: { seed: resolved.sampling.seed },
  });
  assert.deepStrictEqual(back, resolved);
});
