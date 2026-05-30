<script lang="ts">
  import { agent } from "../../stores/agent.svelte.js";

  let input = $state("");
  let threadEl = $state<HTMLElement | null>(null);

  function submit() {
    const text = input.trim();
    if (!text || agent.status === "streaming") return;
    input = "";
    void agent.send(text);
  }

  function onKeydown(e: KeyboardEvent) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Auto-scroll to the latest content as it streams in.
  $effect(() => {
    // Touch the reactive deps so the effect re-runs while tokens arrive.
    void agent.messages.length;
    void agent.messages.at(-1)?.content;
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  });
</script>

<div class="flex h-full flex-col bg-neutral-950 text-neutral-100">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-neutral-800 px-3 py-2 shrink-0">
    <span class="text-sm font-semibold">Agent</span>
    <button
      onclick={() => agent.reset()}
      disabled={agent.status === "streaming" || agent.messages.length === 0}
      class="text-xs px-2 py-1 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
      title="Start a new session"
    >
      New session
    </button>
  </div>

  <!-- Thread -->
  <div bind:this={threadEl} class="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
    {#if agent.messages.length === 0}
      <div class="m-auto max-w-[18rem] text-center text-xs text-neutral-500 leading-relaxed">
        Describe what you want to generate — a subject, a mood, a scene. The agent
        will draft a Spec and fill the controls. You press Generate.
      </div>
    {/if}

    {#each agent.messages as msg (msg.id)}
      {#if msg.role === "note"}
        <div class="self-center max-w-full text-center text-[11px] text-neutral-500 px-2 py-1">
          {msg.content}
        </div>
      {:else if msg.role === "user"}
        <div class="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      {:else}
        <div class="self-start max-w-[90%] rounded-2xl rounded-bl-sm bg-neutral-800 px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {#if msg.content}{msg.content}{/if}{#if msg.streaming}<span class="inline-block w-1.5 h-3.5 ml-0.5 -mb-0.5 bg-neutral-400 animate-pulse"></span>{/if}
        </div>
      {/if}
    {/each}
  </div>

  <!-- Spec-applied banner -->
  {#if agent.specApplied}
    <div class="mx-3 mb-2 shrink-0 rounded-lg border border-emerald-700/50 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-300">
      Spec applied to the controls — review and press Generate.
    </div>
  {/if}

  <!-- Composer -->
  <div class="border-t border-neutral-800 p-2 shrink-0">
    <div class="flex items-end gap-2">
      <textarea
        bind:value={input}
        onkeydown={onKeydown}
        rows="2"
        placeholder="Describe the image…"
        class="flex-1 resize-none rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-indigo-600"
      ></textarea>
      <button
        onclick={submit}
        disabled={!input.trim() || agent.status === "streaming"}
        class="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
      >
        {agent.status === "streaming" ? "…" : "Send"}
      </button>
    </div>
  </div>
</div>
