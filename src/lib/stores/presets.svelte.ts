/**
 * User-preset Workflow store (Phase 7, ADR 0003).
 *
 * Owns the imported ComfyUI presets: it parses a pasted/loaded API graph into a
 * user-preset Workflow (`workflows/import.ts`), **registers it into the shared
 * Workflow registry** so it sits in one catalog beside the built-ins (story 43 —
 * the Agent and Profiles select from a single list, story 44), persists it, and
 * can run it by filling its `@slot:` nodes from the current Spec's resolved
 * slot-values (`workflows/inject.ts`) and submitting the whole graph (story 41).
 *
 * Persistence reuses the established `ipcStore` seam (same as the Profile store).
 * The registry is in-memory, so every imported preset is re-registered on hydrate.
 */

import { ipcStore } from "../utils/ipc.js";
import { generation } from "./generation.svelte.js";
import { progress } from "./progress.svelte.js";
import { results } from "./results.svelte.js";
import { submitWorkflow } from "../utils/api.js";
import { importPresetGraph } from "../workflows/import.ts";
import { injectSlots } from "../workflows/inject.ts";
import {
  registerWorkflow,
  unregisterWorkflow,
  workflowIdExists,
  type Workflow,
} from "../workflows/registry.ts";

const PRESETS_KEY = "user-workflow-presets";

/** Turn a free-text preset name into a stable, registry-safe id. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "preset";
}

export interface ImportOutcome {
  workflow: Workflow;
  warnings: string[];
}

class UserPresetStore {
  /** The imported user-preset Workflows (also mirrored into the registry). */
  presets = $state<Workflow[]>([]);
  /** Last run's injector warnings, surfaced on the import panel. */
  lastRunWarnings = $state<string[]>([]);
  private ready = false;

  /** Hydrate persisted presets and re-register them into the catalog. */
  async load(): Promise<void> {
    this.ready = true;
    try {
      const saved = await ipcStore.get<Workflow[]>(PRESETS_KEY);
      if (Array.isArray(saved)) {
        this.presets = saved.filter((w) => w?.origin === "user-preset" && !!w.preset);
        for (const w of this.presets) {
          try { registerWorkflow(w); } catch (e) { console.warn("presets: re-register failed", w.id, e); }
        }
      }
    } catch (e) {
      console.error("presets: load failed", e);
    }
  }

  private async persist(): Promise<void> {
    if (!this.ready) return;
    try {
      await ipcStore.set(PRESETS_KEY, this.presets);
    } catch (e) {
      console.error("presets: persist failed", e);
    }
  }

  /** A unique registry id derived from the name, suffixed if already taken. */
  private freshId(name: string): string {
    const base = slugify(name);
    if (!workflowIdExists(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!workflowIdExists(candidate)) return candidate;
    }
  }

  /**
   * Import a ComfyUI API graph (already JSON-parsed) under a display name. Throws
   * for a structurally invalid graph (loud failure at the boundary); otherwise
   * registers + persists the preset and returns it with any wiring warnings.
   */
  async import(rawGraph: unknown, name: string): Promise<ImportOutcome> {
    const id = this.freshId(name);
    const { workflow, warnings } = importPresetGraph(rawGraph, { id, label: name.trim() || id });
    registerWorkflow(workflow);
    this.presets = [...this.presets, workflow];
    await this.persist();
    return { workflow, warnings };
  }

  /** Remove an imported preset from the catalog and storage. */
  async remove(id: string): Promise<void> {
    unregisterWorkflow(id);
    this.presets = this.presets.filter((w) => w.id !== id);
    await this.persist();
  }

  /**
   * Run a preset: fill its `@slot:` nodes from the current Spec's resolved
   * slot-values and submit the whole graph. The seed is resolved here (so the
   * injected `@slot:seed` and the recorded Result agree), a board card is opened
   * via the same Result machinery as a built-in run, and injector warnings are
   * surfaced. Returns the prompt id, or null if the run could not be submitted.
   */
  async run(id: string): Promise<string | null> {
    const workflow = this.presets.find((w) => w.id === id);
    if (!workflow) return null;

    const values = generation.toSlotValues();
    const seed = values.seed < 0 ? Math.floor(Math.random() * 2 ** 31) : values.seed;
    const { graph, warnings } = injectSlots(workflow, { ...values, seed });
    this.lastRunWarnings = warnings;

    const res = await submitWorkflow(graph as Record<string, unknown>, seed);
    progress.enqueue(res.prompt_id, false, "txt2img", null);
    if (res.queue_position != null && res.queue_total != null) {
      progress.updateQueuePosition(res.prompt_id, res.queue_position, res.queue_total);
    }
    // Record the Spec whose values filled the preset as the Result's provenance.
    const intent = `preset: ${workflow.label}`;
    const spec = generation.toSpec();
    results.stageFresh(intent);
    results.recordSubmission(res.prompt_id, { ...spec, sampling: { ...spec.sampling, seed } }, seed, intent);
    return res.prompt_id;
  }
}

export const userPresets = new UserPresetStore();
