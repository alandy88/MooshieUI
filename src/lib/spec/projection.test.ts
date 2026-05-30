/**
 * Prove the single-cast txt2img slice round-trips losslessly through a Spec:
 * `fieldsFromSpec(specFromFields(f))` deep-equals `f` across the fixtures.
 *
 *   npm test            (node --test "src/lib/spec/**\/*.test.ts")
 *
 * (Node 25 strips the TS types natively; no build step, no deps.)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { specFromFields, fieldsFromSpec, FIELD_TIER } from "./projection.ts";
import { animaTxt2img, FIXTURES } from "./fixtures.ts";

for (const [name, fields] of FIXTURES) {
  test(`round-trips losslessly: ${name}`, () => {
    const back = fieldsFromSpec(specFromFields(fields));
    assert.deepStrictEqual(back, fields);
  });
}

test("FIELD_TIER accounts for every field (no silent drops)", () => {
  const fixtureKeys = Object.keys(animaTxt2img).sort();
  const tierKeys = Object.keys(FIELD_TIER).sort();
  assert.deepStrictEqual(tierKeys, fixtureKeys);
});

test("coverage map — the headline finding", () => {
  const counts: Record<"orchestration" | "input" | "pipeline", number> = {
    orchestration: 0,
    input: 0,
    pipeline: 0,
  };
  for (const field of Object.keys(FIELD_TIER) as (keyof typeof FIELD_TIER)[]) {
    counts[FIELD_TIER[field]]++;
  }
  const total = counts.orchestration + counts.input + counts.pipeline;
  console.log(
    `\n  Field coverage across ${total} param fields:` +
      `\n    orchestration-clean : ${counts.orchestration}` +
      `\n    input (edit/inputs)  : ${counts.input}` +
      `\n    pipeline escape-hatch: ${counts.pipeline}\n`,
  );
  // The clean orchestration Spec covers well under half the store's param surface;
  // the rest is template-level ComfyUI config the high-level Spec never modelled.
  assert.ok(counts.pipeline > counts.orchestration, "expected pipeline tier to dominate");
});
