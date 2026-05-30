/**
 * Refine Spec-delta tests (Phase 4 — the refine loop). A refine expands a sparse
 * delta against a *parent Result's* resolved Spec (not Profile defaults), so the
 * behaviours to pin are: silent fields inherit the parent (incl. seed + cast),
 * spoken fields win, `cast` replaces wholesale when given, and `parent` tracks
 * the Result being refined. Assert on resulting Spec values, never on helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { specFromFields } from "./projection.ts";
import { applyRefineDelta } from "./merge.ts";
import type { RequestSpec } from "./merge.ts";
import type { ResolvedSpec } from "./spec.ts";
import { animaTxt2img } from "./fixtures.ts";

/** A parent Result's resolved Spec with the effective seed already pinned in. */
function parentSpec(): ResolvedSpec {
  const spec = specFromFields(animaTxt2img);
  spec.sampling.seed = 424242; // the effective seed the Result was produced with
  return spec;
}

test("silent delta ⇒ inherits the parent verbatim, only parent ref changes", () => {
  const parent = parentSpec();
  const refined = applyRefineDelta(parent, { profile: "ignored", parent: "result-7" });

  // Everything carries over (same composition, same seed) except the linkage.
  assert.deepStrictEqual(refined.subject, parent.subject);
  assert.deepStrictEqual(refined.model, parent.model);
  assert.deepStrictEqual(refined.sampling, parent.sampling);
  assert.equal(refined.sampling.seed, 424242, "silent seed inherits the parent's effective seed");
  assert.equal(refined.parent, "result-7");
  assert.equal(refined.intent, null);
});

test("spoken fields win; unspoken siblings inherit the parent", () => {
  const parent = parentSpec();
  const delta: RequestSpec = {
    profile: "ignored",
    parent: "result-9",
    intent: "warmer lighting",
    subject: { positive: "warm sunset light" },
    sampling: { cfg: 8.5 },
  };
  const refined = applyRefineDelta(parent, delta);

  assert.equal(refined.subject.positive, "warm sunset light");
  // sibling subject fields untouched by the delta inherit the parent
  assert.equal(refined.subject.negative, parent.subject.negative);
  assert.equal(refined.sampling.cfg, 8.5);
  // other sampling knobs inherit, including the pinned seed (composition holds)
  assert.equal(refined.sampling.steps, parent.sampling.steps);
  assert.equal(refined.sampling.seed, 424242);
  assert.equal(refined.intent, "warmer lighting");
});

test('"再来4张" ⇒ delta rolls a fresh seed while keeping the rest', () => {
  const parent = parentSpec();
  const refined = applyRefineDelta(parent, {
    profile: "ignored",
    parent: "result-3",
    sampling: { seed: -1 },
    dimensions: { batch: 4 },
  });

  assert.equal(refined.sampling.seed, -1, "explicit -1 overrides the inherited seed");
  assert.equal(refined.dimensions.batch, 4);
  assert.equal(refined.dimensions.width, parent.dimensions.width);
  assert.equal(refined.subject.positive, parent.subject.positive);
});

test("cast inherits the parent frame when silent, replaces wholesale when given", () => {
  const parent = parentSpec();
  parent.cast = [
    { character: "hash-A", promptOverride: null, lora: null, region: "left", weight: 1 },
  ];

  const inherited = applyRefineDelta(parent, { profile: "ignored", parent: "r" });
  assert.deepStrictEqual(inherited.cast, parent.cast);
  assert.notEqual(inherited.cast, parent.cast, "cast is cloned, not aliased");

  const replaced = applyRefineDelta(parent, {
    profile: "ignored",
    parent: "r",
    cast: [{ character: "hash-B", promptOverride: "smiling", lora: null, region: "right", weight: 0.9 }],
  });
  assert.equal(replaced.cast.length, 1);
  assert.equal(replaced.cast[0]?.character, "hash-B");
});

test("does not mutate the parent resolved Spec", () => {
  const parent = parentSpec();
  const before = structuredClone(parent);
  applyRefineDelta(parent, {
    profile: "ignored",
    parent: "r",
    subject: { positive: "totally different" },
    sampling: { seed: 1 },
  });
  assert.deepStrictEqual(parent, before);
});
