import assert from "node:assert/strict";
import test from "node:test";

import { withCapWarning } from "./run-with-cap-warning.mts";
import type { UsageTracker } from "./usage-log.mts";

function fakeTracker() {
  const records: Array<{ phase: string; n: number }> = [];
  let finalized = false;
  const tracker: UsageTracker = {
    record(phase, iterations) {
      records.push({ phase, n: iterations.length });
    },
    async finalize() {
      finalized = true;
    },
    totals: () => ({
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
      iterations: 0,
    }),
  };
  return { tracker, records, finalized: () => finalized };
}

test("withCapWarning forwards iterations to usage tracker when supplied", async () => {
  const { tracker, records } = fakeTracker();
  const fakeRun = async () => ({
    iterations: [{ usage: { inputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 1 } }],
    stdout: "<promise>COMPLETE</promise>",
  });
  const wrapped = withCapWarning(fakeRun, { usage: tracker });
  await wrapped({ name: "planner", maxIterations: 1, logging: { type: "stdout" } });
  assert.deepEqual(records, [{ phase: "planner", n: 1 }]);
});

test("withCapWarning is a no-op for tracker when iterations is missing", async () => {
  const { tracker, records } = fakeTracker();
  const fakeRun = async () => ({ stdout: "ok" });
  const wrapped = withCapWarning(fakeRun, { usage: tracker });
  await wrapped({ name: "x", maxIterations: 1, logging: { type: "stdout" } });
  assert.deepEqual(records, []);
});

test("withCapWarning works without a tracker (backwards-compatible)", async () => {
  const fakeRun = async () => ({
    iterations: [{}],
    stdout: "<promise>COMPLETE</promise>",
  });
  const wrapped = withCapWarning(fakeRun);
  const result = await wrapped({ name: "x", maxIterations: 1, logging: { type: "stdout" } });
  assert.equal(result.iterations.length, 1);
});
