<script lang="ts">
  import { results } from "../../stores/results.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { gate } from "../../stores/gate.svelte.js";
  import { orchestrator } from "../../stores/orchestrator.svelte.js";
  import { applyRefineDelta } from "../../spec/merge.ts";
  import type { FanoutPlan } from "../../orchestrator/fanout.ts";
  import type { GatePolicy } from "../../orchestrator/gate.ts";
  import type { Result } from "../../spec/result.ts";

  interface Props {
    /** Fix-hand reuses the page's inpaint + mask-editor machinery (Konva + facefix). */
    onFixHand?: (result: Result) => void;
  }
  let { onFixHand }: Props = $props();

  const POLICIES: { id: GatePolicy; label: string }[] = [
    { id: "per_iteration", label: "each" },
    { id: "per_batch", label: "batch" },
    { id: "none", label: "auto" },
  ];

  /** Live preview routing: a pending card shows the WS preview while it's active. */
  function previewFor(promptId: string): string | null {
    return progress.activePromptId === promptId ? progress.previewImage : null;
  }

  function select(id: string) {
    results.select(results.activeResultId === id ? null : id);
  }

  /** Variations ("再来4张"): same composition, fresh seeds, a batch of 4. */
  function variations(result: Result) {
    const base = results.refineBase(result.id);
    if (!base) return;
    generation.applySpec(
      applyRefineDelta(base, {
        profile: "",
        parent: result.id,
        sampling: { seed: -1 },
        dimensions: { batch: 4 },
      }),
    );
    results.stageRefine(result.id, "variations");
    results.select(result.id);
  }

  /** Promote: pin this exact image's seed and turn on upscale for a full render. */
  function promote(result: Result) {
    const base = results.refineBase(result.id);
    if (!base) return;
    generation.applySpec(
      applyRefineDelta(base, {
        profile: "",
        parent: result.id,
        pipeline: { upscale: { enabled: true } },
      }),
    );
    results.stageRefine(result.id, "promote to full render");
    results.select(result.id);
  }

  /** Regenerate from a Result: re-run its Spec with a fresh seed; hold the old one. */
  function regen(result: Result) {
    const base = results.refineBase(result.id);
    if (!base) return;
    generation.applySpec(applyRefineDelta(base, { profile: "", parent: result.id, sampling: { seed: -1 } }));
    results.stageRefine(result.id, "regenerate");
    gate.hold(result.id);
    results.select(result.id);
  }

  // ── Fan-out (Phase 6): seed sweeps + outfit axis over the current Spec ────────
  let showFanout = $state(false);
  let sweepCount = $state(4);
  let outfitsText = $state("");

  /** Parse the outfit box (one fragment per line or comma) into a clean list. */
  function parsedOutfits(): string[] {
    return outfitsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function fanoutPlan(): FanoutPlan {
    const outfits = parsedOutfits();
    return { seedsPerItem: Math.max(1, sweepCount), outfits: outfits.length ? outfits : undefined };
  }

  /** Launch the fan-out run from the current control-panel Spec. */
  function runFanout() {
    if (orchestrator.running) return;
    void orchestrator.run(generation.toSpec(), fanoutPlan());
  }
</script>

<div class="flex h-full flex-col bg-neutral-950 text-neutral-100">
  <div class="flex items-center justify-between border-b border-neutral-800 px-3 py-2 shrink-0">
    <span class="text-sm font-semibold">Results</span>
    <span class="text-[11px] text-neutral-500">{results.results.length} on board</span>
  </div>

  <!-- Gate toolbar: supervision policy + auto-judge (ADR 0002 — autonomy = gate policy) -->
  <div class="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 shrink-0 text-[11px] text-neutral-400">
    <span title="Human Gate policy">Gate</span>
    <div class="flex overflow-hidden rounded border border-neutral-700">
      {#each POLICIES as p}
        <button
          type="button"
          onclick={() => gate.setPolicy(p.id)}
          class="px-2 py-0.5 transition-colors {gate.policy === p.id ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-800'}"
          title={p.id === 'none' ? 'Unattended: auto-accept above threshold' : p.id === 'per_batch' ? 'Approve the batch; clear accepts auto-deliver' : 'Approve each Result'}
        >{p.label}</button>
      {/each}
    </div>
    <label class="flex items-center gap-1 {gate.policy === 'none' ? 'opacity-50' : ''}" title="Judge each Result with the VLM">
      <input type="checkbox" bind:checked={gate.autoJudge} disabled={gate.policy === 'none'} class="accent-indigo-600" />
      judge
    </label>
    {#if gate.judgingEnabled}
      <label class="ml-auto flex items-center gap-1" title="Auto-accept score threshold">
        ≥
        <input
          type="number" min="0" max="1" step="0.05"
          bind:value={gate.acceptThreshold}
          class="w-12 rounded bg-neutral-900 border border-neutral-700 px-1 py-0.5 text-neutral-200"
        />
      </label>
    {/if}
  </div>

  <!-- Fan-out: deterministic seed/outfit sweeps over the current Spec (Phase 6) -->
  <div class="border-b border-neutral-800 px-3 py-1.5 shrink-0 text-[11px] text-neutral-400">
    <div class="flex items-center gap-2">
      <button type="button" onclick={() => (showFanout = !showFanout)} class="flex items-center gap-1 hover:text-neutral-200" title="Fan out the current Spec across seeds / outfits">
        <span class="transition-transform {showFanout ? 'rotate-90' : ''}">▸</span> Fan-out
      </button>
      {#if orchestrator.running}
        <span class="ml-auto flex items-center gap-1.5 text-indigo-300">
          <span class="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-600 border-t-indigo-400"></span>
          {orchestrator.done}/{orchestrator.total}
        </span>
        <button type="button" onclick={() => orchestrator.cancel()} class="rounded bg-red-800/80 px-2 py-0.5 text-white hover:bg-red-700">stop</button>
      {:else}
        <button
          type="button"
          onclick={runFanout}
          class="ml-auto rounded bg-indigo-600 px-2 py-0.5 text-white hover:bg-indigo-500"
          title="Submit one Spec per item through the shared generate path"
        >Run ×{orchestrator.previewSize(fanoutPlan())}</button>
      {/if}
    </div>

    {#if showFanout}
      <div class="mt-2 flex flex-col gap-2">
        <label class="flex items-center gap-2" title="Images per item — the seed axis (story 34)">
          seeds
          <input type="number" min="1" max="64" bind:value={sweepCount}
            class="w-14 rounded bg-neutral-900 border border-neutral-700 px-1 py-0.5 text-neutral-200" />
          <span class="text-neutral-600">× {parsedOutfits().length || 1} outfit(s)</span>
        </label>
        <label class="flex flex-col gap-1" title="One outfit per line or comma — each becomes a Spec with these tags merged into the prompt">
          outfits (optional)
          <textarea bind:value={outfitsText} rows="2" placeholder="school uniform&#10;red dress"
            class="resize-none rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-neutral-200 placeholder:text-neutral-600"></textarea>
        </label>
      </div>
    {/if}

    {#if orchestrator.failures.length > 0}
      <div class="mt-1.5 text-amber-400">
        {orchestrator.failures.length} item(s) failed (one bad item won't sink the batch)
      </div>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#if results.results.length === 0 && results.pending.length === 0}
      <div class="m-auto max-w-[16rem] text-center text-xs text-neutral-500 leading-relaxed pt-8">
        Generations land here as cards. Click one to select it, then refine in
        chat — "再来4张", "like this but warmer", "fix the hand".
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-2">
        {#each results.results as result, i (result.id)}
          {@const selected = results.activeResultId === result.id}
          {@const gateStatus = gate.statusOf(result.id)}
          {@const judging = gate.isJudging(result.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => select(result.id)}
            onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(result.id); } }}
            class="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border text-left transition-colors
              {selected ? 'border-indigo-500 ring-1 ring-indigo-500'
                : gateStatus === 'deliver' ? 'border-emerald-700'
                : gateStatus === 'await_approval' ? 'border-amber-600'
                : gateStatus === 'hold' ? 'border-neutral-600'
                : 'border-neutral-800 hover:border-neutral-600'}"
          >
            {#if result.image.url}
              <img src={result.image.url} alt={`Result #${i + 1}`} class="h-full w-full object-cover" />
            {:else}
              <div class="flex h-full w-full items-center justify-center bg-neutral-900 text-xs text-neutral-600">no image</div>
            {/if}

            <!-- top-left: board number -->
            <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
              #{i + 1}
            </span>
            <!-- top-right: verdict badge (Phase 5) -->
            {#if judging}
              <span class="absolute right-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px]">
                <span class="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-600 border-t-indigo-400"></span>
                judging
              </span>
            {:else if result.verdict}
              <span class="absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold
                {result.verdict === 'accepted' ? 'bg-emerald-600/80' : result.verdict === 'reject' ? 'bg-red-700/80' : 'bg-amber-600/80'}"
                title={gateStatus ? `gate: ${gateStatus.replace('_', ' ')}` : undefined}>
                {result.verdict}{#if gateStatus === 'deliver'} ✓{:else if gateStatus === 'await_approval'} ⏳{/if}
              </span>
            {/if}

            <!-- hover/selected action bar -->
            <div class="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-1
              opacity-0 transition-opacity group-hover:opacity-100 {selected ? 'opacity-100' : ''}">
              <button
                type="button"
                onclick={(e) => { e.stopPropagation(); variations(result); }}
                class="flex-1 rounded bg-neutral-800/90 px-1 py-1 text-[10px] hover:bg-indigo-600"
                title="4 variations (再来4张)"
              >×4</button>
              <button
                type="button"
                onclick={(e) => { e.stopPropagation(); onFixHand?.(result); }}
                class="flex-1 rounded bg-neutral-800/90 px-1 py-1 text-[10px] hover:bg-indigo-600"
                title="Fix by mask (inpaint + face fix)"
              >fix</button>
              <button
                type="button"
                onclick={(e) => { e.stopPropagation(); promote(result); }}
                class="flex-1 rounded bg-neutral-800/90 px-1 py-1 text-[10px] hover:bg-indigo-600"
                title="Promote to full render (pin seed + upscale)"
              >↑</button>
              {#if gateStatus === 'await_approval' || gateStatus === 'hold'}
                <button
                  type="button"
                  onclick={(e) => { e.stopPropagation(); gate.approve(result.id); }}
                  class="flex-1 rounded bg-emerald-700/90 px-1 py-1 text-[10px] hover:bg-emerald-600"
                  title="Approve — deliver this Result"
                >✓</button>
                <button
                  type="button"
                  onclick={(e) => { e.stopPropagation(); regen(result); }}
                  class="flex-1 rounded bg-neutral-800/90 px-1 py-1 text-[10px] hover:bg-indigo-600"
                  title="Regenerate from this Spec (fresh seed)"
                >↻</button>
              {/if}
            </div>
          </div>
        {/each}

        <!-- in-flight cards (live preview routes onto the active one) -->
        {#each results.pending as p (p.promptId)}
          {@const preview = previewFor(p.promptId)}
          <div class="relative aspect-square overflow-hidden rounded-lg border border-neutral-700">
            {#if preview}
              <img src={preview} alt="generating" class="h-full w-full object-cover" />
            {:else}
              <div class="flex h-full w-full items-center justify-center bg-neutral-900">
                <span class="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-indigo-500"></span>
              </div>
            {/if}
            <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-neutral-300">
              generating…
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
