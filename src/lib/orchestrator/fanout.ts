/**
 * Fan-out — sweeps & rosters (Phase 6, ADR 0002).
 *
 * **Cast vs fan-out (orchestration F1).** *Cast* is WHO is in each frame (a
 * per-character prompt override, LoRA, and spatial region). *Fan-out* is what
 * VARIES across the emitted images — seed, character, outfit. They are distinct
 * concepts: a roster fans out over characters and emits **one resolved Spec per
 * item** (PRD stories 34–36). This module is the pure, deterministic core of the
 * orchestrator: it expands a base Spec + a `FanoutPlan` into the list of Specs to
 * run, and orders that list to minimise ComfyUI model reloads (story 38). The run
 * driver (the store) carries them out; the *model never drives this* — fan-out is
 * deterministic app code, which is what keeps a 27–31B local model viable.
 *
 * Pure and rune-free by construction (like `spec/merge.ts`), so it tests headless.
 */

import type { ResolvedSpec, CastMember } from "../spec/spec.ts";
import { mergeTagPrompts } from "../spec/promptAssembly.ts";

/** Seed sentinel meaning "roll a fresh random seed" — the store's default. */
const RANDOM_SEED = -1;

/**
 * One **grounded** roster item — a character ready to render.
 *
 * The store is the single-cast slice and drops `cast[]` on projection (frontend
 * design §"superset, not 1:1"); a character only reaches the image once its
 * registry id has been *grounded* into Danbooru tags + a LoRA file. That
 * grounding is the agent's job — by the time a roster reaches this deterministic
 * orchestrator, each member carries its grounded `tags` (and optional LoRA), and
 * `expandFanout` projects that slice down into the projectable subject/model
 * fields. `character` is kept as the provenance handle on the emitted `cast[]`.
 */
export interface RosterMember {
  /** char-hash-id (registry handle) — provenance, carried onto `cast[]`. */
  character: string;
  /** Grounded Danbooru tags for the character, merged into `subject.positive`. */
  tags?: string | null;
  /** Per-character LoRA (story 16); appended to the LoRA stack. */
  lora?: { name: string; weight: number } | null;
  /** Spatial region; defaults to "auto". */
  region?: CastMember["region"];
}

/**
 * What varies across the emitted images. Each axis multiplies: the expansion is
 * the cross-product of `roster` × `outfits` × `seedsPerItem`, so a 50-character
 * roster at 4 seeds each emits 200 Specs (the 50×4 roster run, story 35). An
 * empty/omitted axis contributes a single passthrough value, so a bare
 * `{ seedsPerItem: 8 }` is a plain seed sweep (story 34).
 */
export interface FanoutPlan {
  /** Characters to fan out over — one Spec per character (stories 35–36). */
  roster?: RosterMember[];
  /** Outfit tag fragments, merged into `subject.positive`; one Spec each. */
  outfits?: string[];
  /** Images per (character × outfit) cell — the seed axis. Default 1 (story 34). */
  seedsPerItem?: number;
}

/** The number of Specs a plan expands to, without building them (for the UI). */
export function fanoutSize(plan: FanoutPlan): number {
  const roster = plan.roster?.length || 1;
  const outfits = plan.outfits?.length || 1;
  const seeds = Math.max(1, plan.seedsPerItem ?? 1);
  return roster * outfits * seeds;
}

/**
 * Resolve the seed for the `i`-th image of a cell. A single image keeps the
 * base seed verbatim (so a one-off roster stays reproducible against `base`);
 * a multi-seed cell sweeps deterministically from a pinned base (`base + i`) or
 * rolls a fresh random seed per image when the base is the -1 sentinel.
 */
function seedForIndex(baseSeed: number, i: number, seedsPerItem: number): number {
  if (seedsPerItem <= 1) return baseSeed;
  if (baseSeed < 0) return RANDOM_SEED;
  return baseSeed + i;
}

/** A roster member projected into the single-cast frame for one emitted Spec. */
function castFor(member: RosterMember): CastMember {
  return {
    character: member.character,
    promptOverride: member.tags ?? null,
    lora: member.lora ? { id: member.lora.name, weight: member.lora.weight } : null,
    region: member.region ?? "auto",
    weight: 1,
  };
}

/** Project a grounded roster member's tags + LoRA down into the projectable Spec. */
function applyRosterMember(spec: ResolvedSpec, member: RosterMember): void {
  spec.cast = [castFor(member)];
  if (member.tags) {
    spec.subject = { ...spec.subject, positive: mergeTagPrompts(spec.subject.positive, member.tags) };
  }
  if (member.lora) {
    spec.model = {
      ...spec.model,
      loras: [
        ...spec.model.loras,
        { name: member.lora.name, strengthModel: member.lora.weight, strengthClip: member.lora.weight, enabled: true },
      ],
    };
  }
}

/**
 * Expand a base resolved Spec across a `FanoutPlan` into one resolved Spec per
 * emitted image. The cross-product order is roster-major, then outfit, then seed,
 * so a roster run groups a character's images together before `orderByModel`
 * regroups by checkpoint. Each emitted Spec is an independent clone — mutating
 * one never touches another or the base.
 *
 * Per-image derivations:
 *  - **cast**: a grounded roster member becomes the single-cast frame (story 16)
 *    AND projects its tags/LoRA down into subject/model so it actually renders; a
 *    seed/outfit-only sweep keeps the base cast.
 *  - **outfit**: merged into `subject.positive` via the same deduping tag-merge
 *    the assembler uses, so duplicate tags don't pile up.
 *  - **seed**: see `seedForIndex`.
 *  - **batch**: forced to 1 — fan-out emits one Spec *per item*, so multiplicity
 *    lives in the plan (seedsPerItem), not in a hidden batch (story 36).
 *  - **intent**: labelled with the varying axes (character · outfit) for board
 *    provenance; falls back to the base intent for a plain seed sweep.
 */
export function expandFanout(base: ResolvedSpec, plan: FanoutPlan): ResolvedSpec[] {
  const rosterAxis: (RosterMember | null)[] = plan.roster?.length ? plan.roster : [null];
  const outfitAxis: (string | null)[] = plan.outfits?.length ? plan.outfits : [null];
  const seedsPerItem = Math.max(1, plan.seedsPerItem ?? 1);

  const out: ResolvedSpec[] = [];
  for (const member of rosterAxis) {
    for (const outfit of outfitAxis) {
      for (let i = 0; i < seedsPerItem; i++) {
        const spec = structuredClone(base);
        if (member) applyRosterMember(spec, member);
        if (outfit) {
          spec.subject = {
            ...spec.subject,
            positive: mergeTagPrompts(spec.subject.positive, outfit),
          };
        }
        spec.sampling = { ...spec.sampling, seed: seedForIndex(base.sampling.seed, i, seedsPerItem) };
        spec.dimensions = { ...spec.dimensions, batch: 1 };

        const label = [member?.character, outfit].filter(Boolean).join(" · ");
        spec.intent = label || base.intent;
        out.push(spec);
      }
    }
  }
  return out;
}

/** The checkpoint a Spec loads — the split-model diffusion model when enabled. */
export function modelKey(spec: ResolvedSpec): string {
  const split = spec.pipeline.splitModel;
  return (split.enabled && split.diffusionModel) || spec.model.checkpoint;
}

/**
 * Order Specs so identical-model runs are adjacent, minimising the expensive
 * ComfyUI checkpoint swaps a multi-Profile run would otherwise thrash through
 * (story 38). A **stable** sort: Specs sharing a model keep their relative
 * expansion order (the roster sequence), so only cross-model grouping moves. The
 * explicit index tiebreak makes the order deterministic regardless of the engine
 * sort's stability guarantees.
 */
export function orderByModel(specs: ResolvedSpec[]): ResolvedSpec[] {
  return specs
    .map((spec, index) => ({ spec, index, key: modelKey(spec) }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index)
    .map((d) => d.spec);
}
