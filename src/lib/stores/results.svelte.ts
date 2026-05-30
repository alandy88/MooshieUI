/**
 * Result store — the Session's Result board (Phase 4).
 *
 * A **Result** carries the resolved Spec it was produced from, the effective seed,
 * the judge's scores/verdict (Phase 5), and a handle to its image (see
 * `spec/result.ts`). This store owns the board: the Results produced in the
 * current Session plus the *pending* cards for in-flight generations (so the live
 * WebSocket preview has a card to route onto before the image lands).
 *
 * Wiring (kept decoupled from the execution machinery):
 *   - `recordSubmission(promptId, resolvedSpec, seed, intent)` is called at submit
 *     time (the generate path) to capture the exact resolved Spec + effective seed
 *     and open a pending card.
 *   - `attachOutputs(promptId, images)` is called when the generation completes
 *     (the gallery finalize path) to mint a Result per output image and close the
 *     pending card.
 *
 * Live preview routing is the board component's job: it reads `progress`
 * (`activePromptId` + `previewImage`) and matches against a pending card's
 * `promptId` — the store stays free of the progress machinery.
 *
 * Board display numbers (`#1`, `#2`, … — what chat refines reference) are derived
 * from board position; ids are an opaque per-session sequence so a Result keeps a
 * stable identity even as the board changes.
 */

import type { Result, ImageHandle } from "../spec/result.ts";
import type { ResolvedSpec } from "../spec/spec.ts";
import type { OutputImage } from "../types/index.js";

/** An in-flight generation that has a card on the board but no image yet. */
export interface PendingResult {
  /** ComfyUI prompt id — the routing key for the live preview + outputs. */
  promptId: string;
  /** The resolved Spec captured at submit time (the eventual Result's spec). */
  resolvedSpec: ResolvedSpec;
  /** Effective seed (resolved from -1 to the concrete integer ComfyUI used). */
  seed: number;
  /** Free-text intent for the card label (provenance), if any. */
  intent: string | null;
}

class ResultStore {
  /** Completed Results in board order (oldest first; `#N` = position + 1). */
  results = $state<Result[]>([]);
  /** In-flight cards awaiting their image. */
  pending = $state<PendingResult[]>([]);
  /** The card the operator has selected (refines/edits default to it). */
  activeResultId = $state<string | null>(null);

  /** Opaque, monotonic per-session id source (stable across board mutations). */
  private seq = 0;

  /**
   * Provenance for the *next* generation, held above the store because the store
   * projection drops `parent`/`intent`/`cast` (they have no home in the per-image
   * slice — frontend design §"superset, not 1:1"). A refine (agent, or a board
   * action) stages it here; `recordSubmission` stamps it onto the Result and then
   * clears it, so a Result references the Result it was refined from (story #27).
   */
  private pendingContext: { parent: string | null; intent: string | null } | null = null;

  /** Stage refine provenance for the next generation (links to `parentId`). */
  stageRefine(parentId: string, intent: string | null): void {
    this.pendingContext = { parent: parentId, intent };
  }

  /** Clear staged provenance — the controls now hold a fresh (non-refine) Spec. */
  stageFresh(intent: string | null = null): void {
    this.pendingContext = intent ? { parent: null, intent } : null;
  }

  /** Capture a submitted generation and open a pending card for it. */
  recordSubmission(
    promptId: string,
    resolvedSpec: ResolvedSpec,
    seed: number,
    intent: string | null = null,
  ): void {
    // Stamp staged refine provenance (the store projection can't carry it).
    const ctx = this.pendingContext;
    const spec: ResolvedSpec = {
      ...structuredClone(resolvedSpec),
      parent: ctx?.parent ?? resolvedSpec.parent ?? null,
      intent: ctx?.intent ?? intent ?? resolvedSpec.intent ?? null,
    };
    // Replace any stale pending card for the same prompt id (re-submit edge).
    this.pending = [
      ...this.pending.filter((p) => p.promptId !== promptId),
      { promptId, resolvedSpec: spec, seed, intent: spec.intent },
    ];
    this.pendingContext = null; // provenance applies to this submission only
  }

  /**
   * Mint a Result per output image and close the matching pending card. No-op
   * (beyond closing any pending card) when the prompt wasn't recorded — legacy
   * generations that never went through `recordSubmission` don't get a Result.
   */
  attachOutputs(promptId: string, images: OutputImage[]): Result[] {
    const sub = this.pending.find((p) => p.promptId === promptId);
    this.pending = this.pending.filter((p) => p.promptId !== promptId);
    if (!sub || images.length === 0) return [];

    const minted = images.map((img, i) => this.mint(sub, img, i));
    this.results = [...this.results, ...minted];
    this.activeResultId = minted[minted.length - 1]!.id;
    return minted;
  }

  private mint(sub: PendingResult, img: OutputImage, batchIndex: number): Result {
    // ComfyUI increments the seed per batch item from the base effective seed.
    const seed = sub.seed + batchIndex;
    const image: ImageHandle = {
      filename: img.filename,
      subfolder: img.subfolder,
      url: img.url ?? null,
    };
    const resolvedSpec: ResolvedSpec = {
      ...structuredClone(sub.resolvedSpec),
      sampling: { ...sub.resolvedSpec.sampling, seed },
    };
    return {
      id: `result-${++this.seq}`,
      resolvedSpec,
      seed,
      scores: {},
      verdict: null,
      image,
      parent: sub.resolvedSpec.parent ?? null,
    };
  }

  /** Look up a completed Result by id. */
  get(id: string): Result | undefined {
    return this.results.find((r) => r.id === id);
  }

  /** Board display number (`#N`) for a Result id, or null if not on the board. */
  numberOf(id: string): number | null {
    const i = this.results.findIndex((r) => r.id === id);
    return i >= 0 ? i + 1 : null;
  }

  /** Resolve a chat reference like "#3" to a Result id, or null. */
  idForNumber(n: number): string | null {
    return this.results[n - 1]?.id ?? null;
  }

  /** The currently selected Result, if any. */
  get active(): Result | undefined {
    return this.activeResultId ? this.get(this.activeResultId) : undefined;
  }

  /**
   * The base resolved Spec for refining a Result: its own resolved Spec with the
   * *effective* seed pinned in (the Result carries the effective seed separately).
   * Pass this to `applyRefineDelta` so silent deltas inherit a bit-stable seed.
   */
  refineBase(id: string): ResolvedSpec | undefined {
    const r = this.get(id);
    if (!r) return undefined;
    return {
      ...structuredClone(r.resolvedSpec),
      sampling: { ...r.resolvedSpec.sampling, seed: r.seed },
    };
  }

  select(id: string | null): void {
    this.activeResultId = id;
  }

  remove(id: string): void {
    this.results = this.results.filter((r) => r.id !== id);
    if (this.activeResultId === id) this.activeResultId = null;
  }

  /** Adopt a Result re-opened from a saved image (PNG-embedded Result). */
  adopt(result: Omit<Result, "id">): Result {
    const adopted: Result = { ...structuredClone(result), id: `result-${++this.seq}` };
    this.results = [...this.results, adopted];
    this.activeResultId = adopted.id;
    return adopted;
  }

  /** Set a judge verdict + scores on a Result (Phase 5 hook). */
  setVerdict(id: string, verdict: Result["verdict"], scores: Result["scores"]): void {
    this.results = this.results.map((r) =>
      r.id === id ? { ...r, verdict, scores } : r,
    );
  }

  /** Reset the board (a new Session). */
  reset(): void {
    this.results = [];
    this.pending = [];
    this.activeResultId = null;
    this.seq = 0;
  }
}

export const results = new ResultStore();
