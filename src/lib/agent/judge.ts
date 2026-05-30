/**
 * Judge prompt + verdict parsing (Phase 5 — pure, UI-free).
 *
 * ADR 0002: the Agent does *judgment only*. Given a produced image and its
 * Result's intent/prompt, the model returns a verdict (`accepted|refine|reject`)
 * and named scores; the deterministic Human Gate (`orchestrator/gate.ts`) — not
 * the model — decides delivery. v1 is a single VLM verdict (the detector /
 * preference-rank / identity-filter stages are deferred; PRD §Out of Scope).
 *
 * Like the intent→Spec path, the verdict streams back as a fenced ```json block
 * we parse client-side rather than relying on the local model's tool-calling.
 */

import type { Result, Verdict, ResultScores } from "../spec/result.ts";

const VERDICTS: ReadonlySet<string> = new Set<Verdict>(["accepted", "refine", "reject"]);

/** Build the judge prompt for a Result (its intent + prompt drive the rubric). */
export function buildJudgePrompt(result: Result): string {
  const spec = result.resolvedSpec;
  const intent = spec.intent?.trim() || "(no explicit intent — judge against the prompt)";
  return `You are judging a generated anime image against what was asked for.

Intent: ${intent}
Positive prompt: ${spec.subject.positive}
Negative prompt: ${spec.subject.negative || "(none)"}

Assess prompt adherence, anatomy (especially hands), and overall aesthetic quality.
Reply with EXACTLY ONE fenced \`\`\`json block and nothing else:
{
  "verdict": "accepted" | "refine" | "reject",
  "scores": { "overall": <0..1>, "prompt_fit": <0..1>, "anatomy": <0..1>, "aesthetic": <0..1> },
  "notes": "<one short line>"
}
- "accepted": ship it.  "refine": close, needs a small tweak.  "reject": clearly broken (bad anatomy, ignored prompt).
- "overall" should reflect your delivery confidence; the gate compares it to a threshold.`;
}

export interface JudgeVerdict {
  verdict: Verdict;
  scores: ResultScores;
  notes: string;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

/**
 * Parse the model's judge reply into a verdict. Accepts a fenced ```json block
 * (last one wins) or a bare JSON object. Returns null when no valid verdict is
 * present, so the caller can fail loud / leave the Result unjudged.
 */
export function parseJudgeReply(reply: string): JudgeVerdict | null {
  let raw: string | null = null;
  for (const m of reply.matchAll(FENCE_RE)) {
    const inner = m[1]?.trim();
    if (inner) raw = inner;
  }
  if (raw === null) raw = reply.trim();

  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.verdict !== "string" || !VERDICTS.has(o.verdict)) return null;
    const scores: ResultScores = {};
    if (o.scores && typeof o.scores === "object" && !Array.isArray(o.scores)) {
      for (const [k, v] of Object.entries(o.scores as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) scores[k] = v;
      }
    }
    return {
      verdict: o.verdict as Verdict,
      scores,
      notes: typeof o.notes === "string" ? o.notes : "",
    };
  } catch {
    return null;
  }
}
