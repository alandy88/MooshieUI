<script lang="ts">
  import { userPresets } from "../../stores/presets.svelte.js";

  let nameInput = $state("");
  let jsonInput = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let warnings = $state<string[]>([]);

  /** Parse the pasted graph and import it as a user-preset Workflow. */
  async function doImport() {
    if (busy) return;
    error = null;
    warnings = [];
    let graph: unknown;
    try {
      graph = JSON.parse(jsonInput);
    } catch {
      error = "Not valid JSON — paste a ComfyUI API-format graph (Save → API Format).";
      return;
    }
    busy = true;
    try {
      const outcome = await userPresets.import(graph, nameInput);
      warnings = outcome.warnings;
      nameInput = "";
      jsonInput = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function doRun(id: string) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await userPresets.run(id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex flex-col gap-2 bg-neutral-950 text-neutral-100 p-3 text-xs">
  <div class="text-sm font-semibold">Workflow presets</div>
  <p class="text-[11px] text-neutral-500 leading-relaxed">
    Import a ComfyUI graph (Save → API Format) and tag injectable nodes with
    <code class="text-neutral-300">@slot:</code> titles (e.g.
    <code class="text-neutral-300">@slot:positive_prompt</code>,
    <code class="text-neutral-300">@slot:seed</code>). Run fills those nodes from the current Spec.
  </p>

  <!-- Import form -->
  <input
    bind:value={nameInput}
    placeholder="Preset name"
    class="rounded bg-neutral-900 border border-neutral-800 px-2 py-1 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-600"
  />
  <textarea
    bind:value={jsonInput}
    rows="4"
    placeholder={'{ "1": { "class_type": "...", "inputs": { ... }, "_meta": { "title": "@slot:seed" } } }'}
    class="resize-none rounded bg-neutral-900 border border-neutral-800 px-2 py-1 font-mono text-[10px] placeholder:text-neutral-600 focus:outline-none focus:border-indigo-600"
  ></textarea>
  <button
    onclick={doImport}
    disabled={busy || !nameInput.trim() || !jsonInput.trim()}
    class="self-start rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500"
  >Import</button>

  {#if error}
    <div class="rounded border border-red-800/60 bg-red-900/30 px-2 py-1 text-red-300">{error}</div>
  {/if}
  {#if warnings.length > 0}
    <ul class="rounded border border-amber-800/50 bg-amber-900/20 px-3 py-1.5 text-amber-300 list-disc list-inside">
      {#each warnings as w}<li>{w}</li>{/each}
    </ul>
  {/if}

  <!-- Imported presets -->
  {#if userPresets.presets.length > 0}
    <div class="mt-1 flex flex-col gap-1">
      {#each userPresets.presets as w (w.id)}
        <div class="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1">
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{w.label}</div>
            <div class="truncate text-[10px] text-neutral-500">{w.slots.map((s) => s.name).join(", ") || "no slots"}</div>
          </div>
          <button onclick={() => doRun(w.id)} disabled={busy} class="rounded bg-indigo-600 px-2 py-0.5 text-white hover:bg-indigo-500 disabled:opacity-50" title="Run with the current Spec">Run</button>
          <button onclick={() => userPresets.remove(w.id)} disabled={busy} class="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300 hover:bg-red-700 hover:text-white disabled:opacity-50" title="Remove preset">✕</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if userPresets.lastRunWarnings.length > 0}
    <ul class="rounded border border-amber-800/50 bg-amber-900/20 px-3 py-1.5 text-amber-300 list-disc list-inside">
      {#each userPresets.lastRunWarnings as w}<li>{w}</li>{/each}
    </ul>
  {/if}
</div>
