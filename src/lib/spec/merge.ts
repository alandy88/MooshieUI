/**
 * Request → Resolved Spec merge.
 *
 * Two Spec shapes (frontend design §"Spec representations: request vs resolved"):
 *
 *   - RequestSpec (thin) — what the Agent emits / what is transmitted: subject /
 *     cast / sampling + a Pipeline Profile reference + *sparse* overrides. Small
 *     enough for a 27–31B local model to emit reliably.
 *   - ResolvedSpec (fat) — what the Control Panel binds to and what executes: the
 *     request merged onto the selected Profile's defaults, including the 44-field
 *     `pipeline` block. This is the spike's shape and the runtime source of truth.
 *
 * `mergeIntoResolved` is the whole expansion (grounding ② + assembly ③, in app
 * code): Profile defaults where the request is silent; the request wins where it
 * speaks. Transient per-job fields (cast / seed / intent / parent) come from the
 * request, never from the Profile — and `profileDefaultsFromResolved` strips them
 * so they never leak into a *saved* Profile.
 *
 * Sequencing: until the Agent lands (Phase 3) request ≡ resolved at runtime (no
 * overrides, no merge); this is built + tested now, load-bearing later.
 */

import type { ResolvedSpec, CastMember } from "./spec.ts";

/** Recursive `Partial` for the sparse-override shape an Agent emits. */
export type DeepPartial<T> = T extends unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * The thin Spec the Agent emits. Carries a Pipeline Profile reference plus the
 * orchestration-clean fields and a sparse `pipeline` override into the fat
 * escape-hatch block. Every field except `profile` is optional — silent fields
 * fall back to the Profile's defaults on merge.
 */
export interface RequestSpec {
  /** Pipeline Profile this request draws its defaults from. */
  profile: string;
  /** generate | edit. */
  task?: ResolvedSpec["task"];
  /** Workflow id; null ⇒ infer from task. */
  workflow?: ResolvedSpec["workflow"];
  /** Free-text intent the user asked for (provenance/judge). Transient. */
  intent?: string | null;
  /** Result this request iterates/edits. Transient. */
  parent?: string | null;
  /** WHO is in the frame. Transient per-job. */
  cast?: CastMember[];
  subject?: Partial<ResolvedSpec["subject"]>;
  model?: DeepPartial<ResolvedSpec["model"]>;
  sampling?: Partial<ResolvedSpec["sampling"]>;
  dimensions?: Partial<ResolvedSpec["dimensions"]>;
  input?: Partial<ResolvedSpec["input"]>;
  /** Sparse overrides into the fat pipeline escape-hatch block. */
  pipeline?: DeepPartial<ResolvedSpec["pipeline"]>;
}

/**
 * Per-job fields that must never be baked into a reusable Profile and are always
 * sourced from the request, not the Profile defaults: `cast`, `intent`, `parent`,
 * and the effective `sampling.seed`.
 */
export const TRANSIENT_FIELDS = ["cast", "intent", "parent", "seed"] as const;

/** Seed sentinel meaning "roll a fresh random seed" — the store's default. */
const RANDOM_SEED = -1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-merge `patch` onto `base`: nested plain objects merge recursively;
 * arrays, primitives, and `null` replace; `undefined` patch values are treated
 * as "silent" (the base value is kept). Returns new objects (does not mutate).
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv === undefined) continue;
    const bv = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(bv) && isPlainObject(pv) ? deepMerge(bv, pv) : pv;
  }
  return out as T;
}

/**
 * Expand a thin RequestSpec against a Profile's defaults into the fat
 * ResolvedSpec the Control Panel binds to and `specToParams` consumes.
 *
 * Profile defaults provide the base; the request overlays where it speaks. The
 * transient per-job fields (`cast` / `intent` / `parent`) come from the request
 * and default to neutral values when the request is silent.
 */
export function mergeIntoResolved(
  profileDefaults: ResolvedSpec,
  request: RequestSpec,
): ResolvedSpec {
  const resolved = deepMerge(profileDefaults, {
    task: request.task,
    workflow: request.workflow,
    subject: request.subject,
    model: request.model,
    sampling: request.sampling,
    dimensions: request.dimensions,
    input: request.input,
    pipeline: request.pipeline,
  });

  // Transient per-job fields are owned by the request, not the Profile.
  resolved.cast = request.cast ? request.cast.map((c) => ({ ...c })) : [];
  resolved.intent = request.intent ?? null;
  resolved.parent = request.parent ?? null;

  return resolved;
}

/**
 * Apply a refine **delta** onto a parent Result's resolved Spec (Phase 4: the
 * refine loop). Where a Profile merge expands a sparse request against reusable
 * *Profile* defaults, a refine expands it against the *parent Result's own
 * resolved Spec* — so "like #3 but warmer" inherits everything about #3 and
 * changes only what the delta speaks to. The two share the same deep-merge rule;
 * only the base differs (Profile defaults vs a concrete prior Result).
 *
 * Seed/cast inherit from the parent when the delta is silent (so "fix the hand"
 * keeps the same composition); a delta that sets `sampling.seed` to -1 rolls
 * fresh seeds ("再来4张"). Pin the parent Result's *effective* seed into
 * `parentResolved.sampling.seed` before calling if you want bit-stable inherits —
 * the Result carries the effective seed separately from its resolved Spec.
 *
 * `parent` is set from the delta (the Result being refined); `intent` is the new
 * refine instruction (or null). Returns a new object; does not mutate the parent.
 */
export function applyRefineDelta(
  parentResolved: ResolvedSpec,
  delta: RequestSpec,
): ResolvedSpec {
  const refined = deepMerge(parentResolved, {
    task: delta.task,
    workflow: delta.workflow,
    subject: delta.subject,
    model: delta.model,
    sampling: delta.sampling,
    dimensions: delta.dimensions,
    input: delta.input,
    pipeline: delta.pipeline,
  });

  // cast inherits the parent's frame unless the delta replaces it wholesale.
  refined.cast = delta.cast
    ? delta.cast.map((c) => ({ ...c }))
    : parentResolved.cast.map((c) => ({ ...c }));
  refined.intent = delta.intent ?? null;
  refined.parent = delta.parent ?? parentResolved.parent ?? null;

  return refined;
}

/**
 * Strip the transient per-job fields from a ResolvedSpec to produce the reusable
 * defaults a saved Profile carries. The inverse half of the contract: nothing a
 * single job decided (`cast` / `seed` / `intent` / `parent`) leaks into the Profile.
 */
export function profileDefaultsFromResolved(resolved: ResolvedSpec): ResolvedSpec {
  const defaults = structuredClone(resolved);
  defaults.cast = [];
  defaults.intent = null;
  defaults.parent = null;
  defaults.sampling = { ...defaults.sampling, seed: RANDOM_SEED };
  return defaults;
}
