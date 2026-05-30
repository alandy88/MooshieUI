/**
 * Gate store — the deterministic Human Gate + judge orchestration (Phase 5).
 *
 * ADR 0002 made concrete: this *app code* (not the model) drives judging and
 * delivery. When auto-judge is on, a freshly-minted Result is judged by one
 * bounded VLM call; the verdict + scores land on the Result, and the pure
 * `gateDecision` (policy + threshold) decides `deliver | await_approval | hold`.
 * The model never decides what ships and never loops — its unreliability can't
 * run away (frontend design §"Model for judgment only").
 *
 * Policy + threshold are operator preferences that survive a new Session; the
 * per-Result gate status and in-flight judging set are session-scoped.
 */

import { results } from "./results.svelte.js";
import { gallery } from "./gallery.svelte.js";
import { judgeImage } from "../utils/api.js";
import { buildJudgePrompt, parseJudgeReply } from "../agent/judge.js";
import {
  gateDecision,
  primaryScore,
  type GatePolicy,
  type GateAction,
} from "../orchestrator/gate.ts";
import type { Result } from "../spec/result.ts";

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

class GateStore {
  /** Supervision level (story 30). */
  policy = $state<GatePolicy>("per_iteration");
  /** Score at/above which an accepted Result auto-delivers unattended. */
  acceptThreshold = $state(0.7);
  /** Auto-judge each minted Result. Forced on under the unattended `none` policy. */
  autoJudge = $state(false);

  /** Result ids currently being judged (for spinners). */
  judging = $state<Record<string, boolean>>({});
  /** Decided gate action per Result id. */
  status = $state<Record<string, GateAction>>({});

  setPolicy(p: GatePolicy): void {
    this.policy = p;
    // Unattended runs must judge to be able to auto-accept.
    if (p === "none") this.autoJudge = true;
  }

  /** Whether a Result should be judged automatically right now. */
  get judgingEnabled(): boolean {
    return this.autoJudge || this.policy === "none";
  }

  statusOf(id: string): GateAction | null {
    return this.status[id] ?? null;
  }

  isJudging(id: string): boolean {
    return !!this.judging[id];
  }

  /**
   * Judge a Result (one VLM call) and apply the gate. Safe to call on every
   * minted Result: it no-ops without image bytes or while already judging, and
   * fails soft (leaves the Result unjudged) if the runtime isn't a VLM.
   */
  async judgeAndGate(result: Result): Promise<void> {
    if (this.judging[result.id]) return;
    const image = await this.imageBase64(result);
    if (!image) return;

    this.judging = { ...this.judging, [result.id]: true };
    try {
      const reply = await judgeImage(image, buildJudgePrompt(result));
      const verdict = parseJudgeReply(reply);
      if (!verdict) return;
      results.setVerdict(result.id, verdict.verdict, verdict.scores);
      const decision = gateDecision(
        { verdict: verdict.verdict, score: primaryScore(verdict.scores) },
        this.policy,
        this.acceptThreshold,
      );
      this.status = { ...this.status, [result.id]: decision.action };
    } catch (e) {
      console.error("Judge failed:", e);
    } finally {
      const next = { ...this.judging };
      delete next[result.id];
      this.judging = next;
    }
  }

  /** Operator approves a Result on the board → delivered (story 29). */
  approve(id: string): void {
    this.status = { ...this.status, [id]: "deliver" };
  }

  /** Operator holds a Result (e.g. before regenerating). */
  hold(id: string): void {
    this.status = { ...this.status, [id]: "hold" };
  }

  /** Resolve a Result's image to base64 PNG via the session blob the gallery holds. */
  private async imageBase64(result: Result): Promise<string | null> {
    const img =
      gallery.sessionImages.find((i) => i.filename === result.image.filename) ??
      gallery.sessionImages.find((i) => !!i.url && i.url === result.image.url);
    if (!img?.sessionBlob) return null;
    return blobToBase64(img.sessionBlob);
  }

  /** Reset session-scoped gate state (a new Session). Keeps operator prefs. */
  reset(): void {
    this.status = {};
    this.judging = {};
  }
}

export const gate = new GateStore();
