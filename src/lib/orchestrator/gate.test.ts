/**
 * Human Gate policy tests (Phase 5, ADR 0002). The gate is the autonomy knob:
 * these pin that the deterministic policy — not the judge — decides what ships,
 * what awaits a human, and what is held for spot-check, across the three
 * supervision levels.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { gateDecision, primaryScore } from "./gate.ts";

const THRESHOLD = 0.7;

test("primaryScore: overall wins, else mean, else null", () => {
  assert.equal(primaryScore({ overall: 0.9, aesthetic: 0.2 }), 0.9);
  assert.equal(primaryScore({ aesthetic: 0.6, identity: 0.8 }), 0.7);
  assert.equal(primaryScore({}), null);
});

test("per_iteration always awaits the operator, regardless of verdict", () => {
  for (const verdict of ["accepted", "refine", "reject", null] as const) {
    const d = gateDecision({ verdict, score: 0.99 }, "per_iteration", THRESHOLD);
    assert.equal(d.action, "await_approval");
  }
});

test("none: auto-delivers only an accepted Result clearing the threshold", () => {
  assert.equal(gateDecision({ verdict: "accepted", score: 0.8 }, "none", THRESHOLD).action, "deliver");
  // accepted but below threshold ⇒ held for spot-check, never delivered unattended
  assert.equal(gateDecision({ verdict: "accepted", score: 0.6 }, "none", THRESHOLD).action, "hold");
});

test("none: rejects and refines are held, never await (nobody is watching)", () => {
  assert.equal(gateDecision({ verdict: "reject", score: 0.1 }, "none", THRESHOLD).action, "hold");
  assert.equal(gateDecision({ verdict: "refine", score: 0.65 }, "none", THRESHOLD).action, "hold");
});

test("none: an unjudged Result holds (cannot auto-deliver)", () => {
  assert.equal(gateDecision({ verdict: null, score: null }, "none", THRESHOLD).action, "hold");
});

test("per_batch: clear winners deliver; everything else awaits batch approval", () => {
  assert.equal(gateDecision({ verdict: "accepted", score: 0.85 }, "per_batch", THRESHOLD).action, "deliver");
  assert.equal(gateDecision({ verdict: "accepted", score: 0.5 }, "per_batch", THRESHOLD).action, "await_approval");
  assert.equal(gateDecision({ verdict: "refine", score: 0.9 }, "per_batch", THRESHOLD).action, "await_approval");
  assert.equal(gateDecision({ verdict: "reject", score: 0.2 }, "per_batch", THRESHOLD).action, "await_approval");
  assert.equal(gateDecision({ verdict: null, score: null }, "per_batch", THRESHOLD).action, "await_approval");
});

test("threshold boundary is inclusive", () => {
  assert.equal(gateDecision({ verdict: "accepted", score: 0.7 }, "none", 0.7).action, "deliver");
});
