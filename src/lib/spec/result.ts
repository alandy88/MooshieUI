/**
 * The Result contract — types only this phase (the board, PNG-embed, and judge
 * are Phases 4–5).
 *
 * A **Result** carries the resolved Spec it was produced from, the effective seed
 * (the actual integer used, never the `-1` "random" sentinel), the judge's scores
 * and verdict, and a handle to its image. It is embedded in the output PNG so any
 * image re-opens as a fully reproducible Result; refines reference a Result via
 * `parent` (frontend design §"Execution & streaming", PRD §"Result contract").
 */

import type { ResolvedSpec } from "./spec.ts";

/** The judge's decision for a Result (ADR 0002: judgment only, gate is app code). */
export type Verdict = "accepted" | "refine" | "reject";

/** Named scores from the check funnel / judge (e.g. aesthetic, identity, prompt-fit). */
export type ResultScores = Record<string, number>;

/** A handle to a produced image — enough to locate and re-open it. */
export interface ImageHandle {
  /** Output filename as ComfyUI / the gallery knows it. */
  filename: string;
  /** Output subfolder, if any. */
  subfolder?: string;
  /** Display/serving URL when available (browser mode, gallery). */
  url?: string | null;
}

/** One produced image plus everything needed to reproduce and judge it. */
export interface Result {
  /** Stable Result id (also the `<result-ref>` a refine/edit targets). */
  id: string;
  /** The exact resolved Spec that produced this image. */
  resolvedSpec: ResolvedSpec;
  /** The effective seed actually used (resolved from `-1` to a concrete integer). */
  seed: number;
  /** Judge / check-funnel scores; empty until judged. */
  scores: ResultScores;
  /** Judge verdict; `null` until judged. */
  verdict: Verdict | null;
  /** Handle to the produced image. */
  image: ImageHandle;
  /** The Result this one was refined/edited from, if any. */
  parent?: string | null;
}
