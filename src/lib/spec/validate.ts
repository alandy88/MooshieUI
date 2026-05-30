/**
 * Spec validation — zero-dep, hand-rolled (honours the PRD's zero-dependency
 * stance; ajv is the noted alternative if richer schemas are wanted later).
 *
 * Validates every Agent-emitted **request** Spec before it can run: invalid ⇒
 * fail loud. `validateRequestSpec` returns structured issues so the Agent layer
 * (Phase 3) can re-prompt; `assertValidRequestSpec` throws for call sites that
 * want a hard stop. Per the PRD this module is exercised through behaviour, not
 * isolated unit tests.
 *
 * Scope: the Agent-authored surface (profile, task, the orchestration-clean
 * fields, cast). The sparse `pipeline` overrides are only shape-checked (must be
 * objects) — they map onto a validated Profile's defaults, so over-validating the
 * 44-field escape-hatch here would be brittle for no safety gain.
 */

import type { RequestSpec } from "./merge.ts";

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. `sampling.steps`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const TASKS: ReadonlySet<string> = new Set(["generate", "edit"]);
const REGIONS: ReadonlySet<string> = new Set(["left", "right", "center", "auto"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate an untrusted value as a RequestSpec, collecting all issues. */
export function validateRequestSpec(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (!isObject(value)) {
    return { valid: false, issues: [{ path: "", message: "request Spec must be an object" }] };
  }

  // profile (required)
  if (typeof value.profile !== "string" || value.profile.trim() === "") {
    push("profile", "must be a non-empty Profile reference string");
  }

  // task (optional enum)
  if (value.task !== undefined && !TASKS.has(value.task as string)) {
    push("task", 'must be "generate" or "edit"');
  }

  // nullable string fields
  for (const key of ["workflow", "intent", "parent"] as const) {
    const v = value[key];
    if (v !== undefined && v !== null && typeof v !== "string") {
      push(key, "must be a string or null");
    }
  }

  // cast (optional array of CastMember)
  if (value.cast !== undefined) {
    if (!Array.isArray(value.cast)) {
      push("cast", "must be an array");
    } else {
      value.cast.forEach((member, i) => validateCastMember(member, `cast[${i}]`, push));
    }
  }

  // subject (optional, sparse)
  if (value.subject !== undefined) {
    if (!isObject(value.subject)) {
      push("subject", "must be an object");
    } else {
      const s = value.subject;
      for (const key of ["positive", "negative", "stylePreset"] as const) {
        if (s[key] !== undefined && typeof s[key] !== "string") push(`subject.${key}`, "must be a string");
      }
      if (s.stylePresetsEnabled !== undefined && typeof s.stylePresetsEnabled !== "boolean") {
        push("subject.stylePresetsEnabled", "must be a boolean");
      }
    }
  }

  // sampling (optional, sparse) — numeric knobs must be finite when present
  if (value.sampling !== undefined) {
    if (!isObject(value.sampling)) {
      push("sampling", "must be an object");
    } else {
      const s = value.sampling;
      for (const key of ["seed", "steps", "cfg", "denoise"] as const) {
        if (s[key] !== undefined && !isFiniteNumber(s[key])) push(`sampling.${key}`, "must be a finite number");
      }
      for (const key of ["sampler", "scheduler"] as const) {
        if (s[key] !== undefined && typeof s[key] !== "string") push(`sampling.${key}`, "must be a string");
      }
    }
  }

  // dimensions (optional, sparse) — positive integers when present
  if (value.dimensions !== undefined) {
    if (!isObject(value.dimensions)) {
      push("dimensions", "must be an object");
    } else {
      const d = value.dimensions;
      for (const key of ["width", "height", "batch"] as const) {
        if (d[key] !== undefined && (!isFiniteNumber(d[key]) || (d[key] as number) <= 0)) {
          push(`dimensions.${key}`, "must be a positive number");
        }
      }
    }
  }

  // sparse override blocks — shape-check only
  for (const key of ["model", "input", "pipeline"] as const) {
    if (value[key] !== undefined && !isObject(value[key])) {
      push(key, "must be an object");
    }
  }

  return { valid: issues.length === 0, issues };
}

function validateCastMember(
  member: unknown,
  path: string,
  push: (path: string, message: string) => void,
): void {
  if (!isObject(member)) {
    push(path, "must be an object");
    return;
  }
  if (typeof member.character !== "string" || member.character.trim() === "") {
    push(`${path}.character`, "must be a non-empty character id");
  }
  if (member.promptOverride !== undefined && member.promptOverride !== null && typeof member.promptOverride !== "string") {
    push(`${path}.promptOverride`, "must be a string or null");
  }
  if (member.region !== undefined && !REGIONS.has(member.region as string)) {
    push(`${path}.region`, 'must be one of "left" | "right" | "center" | "auto"');
  }
  if (member.weight !== undefined && !isFiniteNumber(member.weight)) {
    push(`${path}.weight`, "must be a finite number");
  }
}

/** Type guard: true when `value` is a structurally valid RequestSpec. */
export function isRequestSpec(value: unknown): value is RequestSpec {
  return validateRequestSpec(value).valid;
}

/** Thrown by `assertValidRequestSpec` — carries the collected issues. */
export class SpecValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    const summary = issues.map((i) => `${i.path || "<root>"}: ${i.message}`).join("; ");
    super(`invalid request Spec — ${summary}`);
    this.name = "SpecValidationError";
    this.issues = issues;
  }
}

/** Assert a value is a valid RequestSpec; throws `SpecValidationError` otherwise. */
export function assertValidRequestSpec(value: unknown): asserts value is RequestSpec {
  const { valid, issues } = validateRequestSpec(value);
  if (!valid) throw new SpecValidationError(issues);
}
