/**
 * Human Gate policy (Phase 5, ADR 0002).
 *
 * The Agent *judges* (verdict + scores); the Operator decides delivery. The
 * autonomy knob is this **gate policy**, never the Agent driving a loop — a
 * local model's unreliability can't run away because the deterministic gate, not
 * the model, decides what ships and what waits for a human (frontend design
 * §"Model for judgment only"; PRD stories 28–33).
 *
 * `gateDecision` is a pure function of (judge outcome, policy, accept threshold).
 * It is the whole policy; the store/UI only carry it out and present approvals.
 */

import type { Verdict, ResultScores } from "../spec/result.ts";

/** How closely the Operator supervises a run (story 30). */
export type GatePolicy = "per_iteration" | "per_batch" | "none";

/** What the deterministic gate does with a judged Result. */
export type GateAction =
  /** Accepted unattended — kept/shipped with no human action. */
  | "deliver"
  /** Surfaced to the Operator to approve or regenerate (story 29). */
  | "await_approval"
  /** Not delivered and not awaiting a human — flagged for the post-hoc
   *  spot-check surface (a rejected or below-threshold unattended Result; story 32). */
  | "hold";

export interface GateDecision {
  action: GateAction;
  /** Human-readable rationale, for the board and telemetry. */
  reason: string;
}

/** The judge's summarised outcome the gate reasons over. */
export interface JudgeOutcome {
  verdict: Verdict | null;
  /** Gating score in [0,1], or null when unjudged / no numeric score. */
  score: number | null;
}

/**
 * The single score the gate compares against the threshold: an explicit
 * `overall` score wins; otherwise the mean of the provided scores; null when
 * there are none. Keeps the judge free to emit either shape.
 */
export function primaryScore(scores: ResultScores): number | null {
  if (typeof scores.overall === "number") return scores.overall;
  const values = Object.values(scores).filter((v) => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Decide what the gate does with a judged Result.
 *
 * - `per_iteration` — full supervision: every Result awaits the Operator; the
 *   verdict is advisory.
 * - `none` — fully unattended (overnight runs, story 31): auto-`deliver` when the
 *   judge accepted AND the score clears the threshold; otherwise `hold` (flagged
 *   for the morning spot-check) — never awaits, because nobody is watching.
 * - `per_batch` — bulk supervision (story 37): clear winners
 *   (accepted ≥ threshold) auto-`deliver` so the Operator only reviews the rest,
 *   which `await_approval` and are presented as a batch.
 *
 * An unjudged Result (`verdict: null`) can never auto-deliver: under `none` it
 * holds; under the supervised policies it awaits a human.
 */
export function gateDecision(
  outcome: JudgeOutcome,
  policy: GatePolicy,
  acceptThreshold: number,
): GateDecision {
  const autoAccept =
    outcome.verdict === "accepted" &&
    outcome.score != null &&
    outcome.score >= acceptThreshold;

  if (policy === "per_iteration") {
    return { action: "await_approval", reason: "per-iteration gate: operator approves each Result" };
  }

  if (policy === "none") {
    if (autoAccept) return { action: "deliver", reason: "unattended: judge accepted and score ≥ threshold" };
    if (outcome.verdict === "reject") return { action: "hold", reason: "unattended: rejected by judge" };
    return { action: "hold", reason: "unattended: below threshold — flagged for spot-check" };
  }

  // per_batch
  if (autoAccept) return { action: "deliver", reason: "clear accept auto-delivered; rest batched for approval" };
  return { action: "await_approval", reason: "batched for operator approval" };
}
