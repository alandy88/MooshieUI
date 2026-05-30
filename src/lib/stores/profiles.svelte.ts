/**
 * Pipeline Profile store.
 *
 * A **Pipeline Profile** is the named bundle of reusable pipeline defaults a
 * request Spec is expanded against, plus the Workflow it selects from the
 * registry (frontend design §"Spec representations"). It plays the role the
 * orchestration spec's workflow-registry plays for the headless siblings: the
 * defaults carrier. A Profile's `defaults` is a ResolvedSpec with the transient
 * per-job fields stripped (cast / seed / intent / parent), so nothing one job
 * decided leaks into the reusable Profile.
 *
 * Persistence reuses the established `ipcStore` pattern (the same Tauri
 * `plugin-store` / localStorage seam the generation store's `generation-settings`
 * key uses) — no new mechanism.
 */

import { ipcStore } from "../utils/ipc.js";
import type { ResolvedSpec } from "../spec/spec.ts";
import { mergeIntoResolved, profileDefaultsFromResolved } from "../spec/merge.ts";
import { getWorkflow } from "../workflows/registry.ts";

const PROFILES_KEY = "pipeline-profiles";

export interface PipelineProfile {
  /** Stable id (also the `profile` ref a RequestSpec carries). */
  id: string;
  /** Display name. */
  name: string;
  /** Workflow this Profile selects from the registry. */
  workflowId: string;
  /** Reusable pipeline defaults — a ResolvedSpec with transient fields stripped. */
  defaults: ResolvedSpec;
}

class PipelineProfileStore {
  profiles = $state<PipelineProfile[]>([]);
  private ready = false;

  /** Hydrate Profiles from persistent storage. Call once on startup. */
  async load(): Promise<void> {
    this.ready = true;
    try {
      const saved = await ipcStore.get<PipelineProfile[]>(PROFILES_KEY);
      if (Array.isArray(saved)) {
        this.profiles = saved.filter((p) => !!p?.id && !!p?.defaults);
      }
    } catch (e) {
      console.error("profiles: load failed", e);
    }
  }

  private async persist(): Promise<void> {
    if (!this.ready) return;
    try {
      await ipcStore.set(PROFILES_KEY, this.profiles);
    } catch (e) {
      console.error("profiles: persist failed", e);
    }
  }

  /** Look up a Profile by id. */
  get(id: string): PipelineProfile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  /** Insert or replace a Profile (matched by id), then persist. */
  async upsert(profile: PipelineProfile): Promise<void> {
    if (!getWorkflow(profile.workflowId)) {
      console.warn(`profiles: unknown workflowId "${profile.workflowId}" on profile "${profile.id}"`);
    }
    const i = this.profiles.findIndex((p) => p.id === profile.id);
    this.profiles = i >= 0
      ? this.profiles.map((p, j) => (j === i ? profile : p))
      : [...this.profiles, profile];
    await this.persist();
  }

  /** Remove a Profile by id, then persist. */
  async remove(id: string): Promise<void> {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    await this.persist();
  }

  /**
   * Seed a fresh ResolvedSpec from a Profile (the runtime spec the Control Panel
   * binds to). Equivalent to expanding an empty request against the Profile, so
   * transient per-job fields start neutral. Returns `undefined` for unknown ids.
   */
  seedSpec(id: string): ResolvedSpec | undefined {
    const profile = this.get(id);
    if (!profile) return undefined;
    return mergeIntoResolved(profile.defaults, { profile: id });
  }

  /**
   * Save a resolved Spec's reusable subset as a Profile (upsert). Transient
   * per-job fields are excluded via `profileDefaultsFromResolved`, so the Profile
   * carries only what is reusable across jobs.
   */
  async saveSpecAsProfile(
    id: string,
    name: string,
    workflowId: string,
    resolved: ResolvedSpec,
  ): Promise<PipelineProfile> {
    const profile: PipelineProfile = {
      id,
      name,
      workflowId,
      defaults: profileDefaultsFromResolved(resolved),
    };
    await this.upsert(profile);
    return profile;
  }
}

export const pipelineProfiles = new PipelineProfileStore();
