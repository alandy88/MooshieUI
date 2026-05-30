/**
 * Orchestrator run-driver — fan-out sweeps & rosters (Phase 6, ADR 0002).
 *
 * The *deterministic* half the design calls for: it expands a base Spec across a
 * `FanoutPlan` (`orchestrator/fanout.ts`), orders the Specs to minimise ComfyUI
 * model reloads (story 38), then submits them through the **same** generate path
 * the button uses — one Result card per item, judged + gated by the existing
 * Phase-5 machinery. The model never drives this loop; a local model's
 * unreliability can't run away because app code, not the model, sequences the run
 * (frontend design §"Model for judgment only").
 *
 * Roster runs are gated per-batch (story 37): the run switches the gate to
 * `per_batch` so clear accepts auto-deliver and the operator approves the rest in
 * bulk rather than per image. Partial failures are handled gracefully — a failed
 * item is retried within a small budget, then recorded and skipped so one bad
 * item never sinks the batch (story 39).
 *
 * Submission mirrors `GenerateButton.trackGeneration`: it mutates the live
 * generation store per item (the control panel flickers through the run, as the
 * compare-grid path already does) and restores the operator's Spec when done.
 */

import { generation } from "./generation.svelte.js";
import { progress } from "./progress.svelte.js";
import { results } from "./results.svelte.js";
import { gate } from "./gate.svelte.js";
import { generate } from "../utils/api.js";
import { expandFanout, orderByModel, fanoutSize, type FanoutPlan } from "../orchestrator/fanout.ts";
import type { ResolvedSpec } from "../spec/spec.ts";

/** A run item that exhausted its retry budget (surfaced to the operator). */
export interface RunFailure {
  /** Position in the ordered run (1-based). */
  index: number;
  /** The item's intent label, for the report. */
  intent: string | null;
  /** Last error message. */
  error: string;
}

class OrchestratorStore {
  /** True while a fan-out run is submitting. */
  running = $state(false);
  /** Total items in the active run. */
  total = $state(0);
  /** Items submitted so far (success or given-up). */
  done = $state(0);
  /** Items that exhausted their retry budget. */
  failures = $state<RunFailure[]>([]);
  /** Retries per item before it is recorded as failed (story 39). */
  retryBudget = $state(1);

  private cancelRequested = false;

  /** How many Specs the plan will emit — for the launch button label. */
  previewSize(plan: FanoutPlan): number {
    return fanoutSize(plan);
  }

  /** Request cancellation; the loop stops after the in-flight submission. */
  cancel(): void {
    this.cancelRequested = true;
  }

  /**
   * Run a fan-out plan from a base Spec. Sequential by design — ComfyUI processes
   * its queue in submit order, so `orderByModel` only pays off if we submit in
   * that order. Returns when every item has been submitted or given up; the images
   * themselves complete asynchronously over the WebSocket onto their board cards.
   */
  async run(base: ResolvedSpec, plan: FanoutPlan): Promise<void> {
    if (this.running) return;

    const specs = orderByModel(expandFanout(base, plan));
    if (specs.length === 0) return;

    // Roster/sweep runs are reviewed in bulk, not per image (story 37).
    if (plan.roster?.length) gate.setPolicy("per_batch");

    const restore = structuredClone(generation.toSpec());
    this.running = true;
    this.cancelRequested = false;
    this.total = specs.length;
    this.done = 0;
    this.failures = [];

    try {
      for (let i = 0; i < specs.length; i++) {
        if (this.cancelRequested) break;
        await this.submitWithRetry(specs[i]!, i + 1);
        this.done = i + 1;
      }
    } finally {
      // Hand the operator's Spec back to the control panel.
      generation.applySpec(restore);
      this.running = false;
    }
  }

  /** Submit one item, retrying within budget; record a failure if it never lands. */
  private async submitWithRetry(spec: ResolvedSpec, index: number): Promise<void> {
    let lastError = "";
    for (let attempt = 0; attempt <= this.retryBudget; attempt++) {
      if (this.cancelRequested) return;
      try {
        await this.submitOne(spec);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    this.failures = [...this.failures, { index, intent: spec.intent, error: lastError }];
  }

  /** One submission through the shared generate path (mirrors trackGeneration). */
  private async submitOne(spec: ResolvedSpec): Promise<void> {
    generation.applySpec(spec);
    const params = generation.toParams();
    const res = await generate(params);
    params.seed = res.seed;
    progress.enqueue(res.prompt_id, params.upscale_enabled, params.mode, params);
    if (res.queue_position != null && res.queue_total != null) {
      progress.updateQueuePosition(res.prompt_id, res.queue_position, res.queue_total);
    }
    // Fresh (non-refine) provenance; intent labels the board card.
    results.stageFresh(spec.intent);
    results.recordSubmission(res.prompt_id, generation.toSpec(), res.seed, spec.intent);
  }
}

export const orchestrator = new OrchestratorStore();
