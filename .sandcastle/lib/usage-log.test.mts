import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createUsageTracker,
  estimateSonnetCostUsd,
  formatTotals,
  sumIterationUsages,
  type IterationUsageLike,
} from "./usage-log.mts";

function u(
  inputTokens: number,
  cacheCreationInputTokens: number,
  cacheReadInputTokens: number,
  outputTokens: number,
): IterationUsageLike {
  return { inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens };
}

test("sumIterationUsages skips iterations missing usage", () => {
  const totals = sumIterationUsages([
    { usage: u(100, 200, 300, 50) },
    {},
    { usage: u(10, 20, 30, 5) },
  ]);
  assert.deepEqual(totals, {
    inputTokens: 110,
    cacheCreationInputTokens: 220,
    cacheReadInputTokens: 330,
    outputTokens: 55,
    iterations: 2,
  });
});

test("sumIterationUsages returns zero totals when no usage is present", () => {
  const totals = sumIterationUsages([{}, {}]);
  assert.equal(totals.iterations, 0);
  assert.equal(totals.inputTokens, 0);
});

test("estimateSonnetCostUsd applies the documented per-MTok prices", () => {
  // 1M input @ $3 = $3.00
  const usd = estimateSonnetCostUsd({
    inputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    iterations: 1,
  });
  assert.equal(usd, 3);
});

test("estimateSonnetCostUsd sums the four token buckets", () => {
  // input 1k ($0.003) + cacheCreate 1k ($0.00375) + cacheRead 1k ($0.0003) + output 1k ($0.015)
  const usd = estimateSonnetCostUsd({
    inputTokens: 1000,
    cacheCreationInputTokens: 1000,
    cacheReadInputTokens: 1000,
    outputTokens: 1000,
    iterations: 1,
  });
  assert.ok(Math.abs(usd - (0.003 + 0.00375 + 0.0003 + 0.015)) < 1e-9);
});

test("formatTotals emits expected key=value layout", () => {
  const s = formatTotals({
    inputTokens: 1234,
    cacheCreationInputTokens: 5678,
    cacheReadInputTokens: 9012,
    outputTokens: 345,
    iterations: 3,
  });
  assert.match(s, /input=1,234/);
  assert.match(s, /cache_create=5,678/);
  assert.match(s, /cache_read=9,012/);
  assert.match(s, /output=345/);
  assert.match(s, /iters=3/);
  assert.match(s, /~\$\d+\.\d{2}/);
});

test("createUsageTracker records phases and writes usage.json on finalize", async () => {
  const dir = await mkdtemp(join(tmpdir(), "usage-test-"));
  try {
    const tracker = createUsageTracker(dir);
    tracker.record("planner", [{ usage: u(1000, 500, 200, 100) }]);
    tracker.record("implementer #42", [
      { usage: u(800, 400, 8000, 200) },
      { usage: u(200, 100, 9000, 50) },
    ]);
    await tracker.finalize();

    const totals = tracker.totals();
    assert.equal(totals.inputTokens, 2000);
    assert.equal(totals.cacheCreationInputTokens, 1000);
    assert.equal(totals.cacheReadInputTokens, 17_200);
    assert.equal(totals.outputTokens, 350);

    const json = JSON.parse(await readFile(join(dir, "usage.json"), "utf8"));
    assert.equal(json.phases.length, 2);
    assert.equal(json.phases[0].name, "planner");
    assert.equal(json.phases[1].name, "implementer #42");
    assert.equal(json.total.inputTokens, 2000);

    const log = await readFile(join(dir, "usage.log"), "utf8");
    assert.match(log, /phase=planner/);
    assert.match(log, /phase=implementer #42/);
    assert.match(log, /TOTAL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createUsageTracker skips phases whose iterations carry no usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "usage-empty-"));
  try {
    const tracker = createUsageTracker(dir);
    tracker.record("planner", [{}, {}]);
    await tracker.finalize();

    const json = JSON.parse(await readFile(join(dir, "usage.json"), "utf8"));
    assert.equal(json.phases.length, 0);
    assert.equal(json.total.inputTokens, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createUsageTracker warns in usage.log when finalize records no phase data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "usage-warn-"));
  try {
    const tracker = createUsageTracker(dir);
    // No record() calls — simulates Sandbox.run() usage-capture gap
    await tracker.finalize();

    const log = await readFile(join(dir, "usage.log"), "utf8");
    assert.match(log, /no per-phase usage captured/);
    assert.match(log, /TOTAL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
