/**
 * Judge verdict parsing tests (Phase 5). Pins robustness to the two shapes a
 * local model emits — a fenced ```json block or a bare object — and that a
 * malformed / wrong-verdict reply yields null (so the Result stays unjudged
 * rather than getting a bogus verdict).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseJudgeReply } from "./judge.ts";

test("parses a fenced json verdict (last block wins)", () => {
  const reply = 'Looks good.\n```json\n{"verdict":"accepted","scores":{"overall":0.82},"notes":"clean"}\n```';
  const v = parseJudgeReply(reply);
  assert.equal(v?.verdict, "accepted");
  assert.equal(v?.scores.overall, 0.82);
  assert.equal(v?.notes, "clean");
});

test("parses a bare json object", () => {
  const v = parseJudgeReply('{"verdict":"reject","scores":{"overall":0.1,"anatomy":0.05}}');
  assert.equal(v?.verdict, "reject");
  assert.equal(v?.scores.anatomy, 0.05);
  assert.equal(v?.notes, "");
});

test("drops non-numeric scores, keeps numeric ones", () => {
  const v = parseJudgeReply('{"verdict":"refine","scores":{"overall":0.6,"prompt_fit":"high"}}');
  assert.equal(v?.scores.overall, 0.6);
  assert.equal("prompt_fit" in (v?.scores ?? {}), false);
});

test("returns null on an unknown verdict or invalid json", () => {
  assert.equal(parseJudgeReply('{"verdict":"maybe"}'), null);
  assert.equal(parseJudgeReply("not json at all"), null);
});
