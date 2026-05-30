/**
 * Agent chat store — Phase 3 (intent → request Spec).
 *
 * Owns the conversation thread and the one streamed round trip per turn. On
 * `send`, it assembles the system prompt (request-Spec shape + available
 * Profiles) plus the conversation, invokes the Rust `agent_chat` command, and
 * accumulates `agent:token` events into the in-flight assistant message. When
 * the turn completes it extracts the fenced request Spec, validates it, merges
 * it against the referenced Pipeline Profile, and applies the resolved Spec to
 * the generation form — the operator then presses Generate (the agent never
 * drives execution; ADR 0002).
 *
 * Streaming reuses the same dual emit path generation events use, so this works
 * in both Tauri (event listen) and browser (SSE) modes via `ipcListen`.
 */

import { ipcInvoke, ipcListen } from "../utils/ipc.js";
import { pipelineProfiles, DEFAULT_PROFILE_ID } from "./profiles.svelte.js";
import { generation } from "./generation.svelte.js";
import { results } from "./results.svelte.js";
import { gate } from "./gate.svelte.js";
import { buildSystemPrompt, extractRequestSpec, type ProfileChoice, type BoardContext } from "../agent/prompt.js";
import { validateRequestSpec } from "../spec/validate.ts";
import { mergeIntoResolved, applyRefineDelta, profileDefaultsFromResolved, type RequestSpec } from "../spec/merge.ts";

export type ChatRole = "user" | "assistant" | "note";

export interface ChatMessage {
  id: number;
  role: ChatRole;
  content: string;
  /** True while tokens are still streaming into this (assistant) message. */
  streaming: boolean;
}

export type AgentStatus = "idle" | "streaming" | "error";

class AgentStore {
  messages = $state<ChatMessage[]>([]);
  status = $state<AgentStatus>("idle");
  /** Set true the moment a turn applies a Spec to the form; cleared on next send. */
  specApplied = $state(false);

  private seq = 0;
  private currentRequestId: string | null = null;
  private listenersReady = false;

  /** Register the streaming event listeners once (call from app init). */
  async init(): Promise<void> {
    if (this.listenersReady) return;
    this.listenersReady = true;
    await Promise.all([
      ipcListen("agent:token", (e: any) => this.onToken(e.payload)),
      ipcListen("agent:done", (e: any) => this.onDone(e.payload)),
      ipcListen("agent:error", (e: any) => this.onError(e.payload)),
    ]);
  }

  private nextId(): number {
    return ++this.seq;
  }

  /** The assistant message currently receiving tokens, if any. */
  private get streamingMessage(): ChatMessage | undefined {
    return this.messages.find((m) => m.streaming);
  }

  /** Send a user turn and stream the agent's reply. No-op while a turn is in flight. */
  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.status === "streaming") return;

    this.specApplied = false;
    this.messages.push({ id: this.nextId(), role: "user", content: trimmed, streaming: false });

    const profiles: ProfileChoice[] = pipelineProfiles.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      workflowId: p.workflowId,
    }));
    const board: BoardContext = {
      entries: results.results.map((r, i) => ({
        number: i + 1,
        intent: r.resolvedSpec.intent,
        seed: r.seed,
      })),
      activeNumber: results.activeResultId ? results.numberOf(results.activeResultId) : null,
    };
    const wire = [
      { role: "system", content: buildSystemPrompt(profiles, board) },
      ...this.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    const assistant: ChatMessage = {
      id: this.nextId(),
      role: "assistant",
      content: "",
      streaming: true,
    };
    this.messages.push(assistant);

    const requestId = `agent-${assistant.id}-${this.seq}`;
    this.currentRequestId = requestId;
    this.status = "streaming";

    try {
      await ipcInvoke("agent_chat", { messages: wire, requestId });
    } catch (e) {
      // A thrown invoke means the request never streamed (e.g. connection
      // refused). The agent:error event also fires, but guard in case it didn't.
      if (this.currentRequestId === requestId && this.status === "streaming") {
        this.finishWithError(String(e));
      }
    }
  }

  private onToken(payload: { request_id?: string; token?: string }): void {
    if (payload?.request_id !== this.currentRequestId) return;
    const msg = this.streamingMessage;
    if (msg && typeof payload.token === "string") {
      msg.content += payload.token;
    }
  }

  private onError(payload: { request_id?: string; error?: string }): void {
    if (payload?.request_id !== this.currentRequestId) return;
    this.finishWithError(payload.error ?? "agent error");
  }

  private finishWithError(error: string): void {
    const msg = this.streamingMessage;
    if (msg) {
      msg.streaming = false;
      if (!msg.content.trim()) {
        // Drop the empty placeholder; show the error as a note instead.
        this.messages = this.messages.filter((m) => m.id !== msg.id);
      }
    }
    this.addNote(`⚠ ${error}`);
    this.status = "error";
    this.currentRequestId = null;
  }

  private onDone(payload: { request_id?: string }): void {
    if (payload?.request_id !== this.currentRequestId) return;
    const msg = this.streamingMessage;
    if (msg) msg.streaming = false;
    this.currentRequestId = null;
    this.status = "idle";
    if (msg) this.applyEmittedSpec(msg.content);
  }

  /** Extract → validate → merge → apply the request Spec from a finished reply. */
  private applyEmittedSpec(reply: string): void {
    const { spec, parseError } = extractRequestSpec(reply);
    if (parseError) {
      this.addNote("Couldn't parse the Spec block as JSON — ask me to try again.");
      return;
    }
    if (spec === null) return; // clarifying question — nothing to apply

    const { valid, issues } = validateRequestSpec(spec);
    if (!valid) {
      const summary = issues.map((i) => `${i.path || "spec"}: ${i.message}`).join("; ");
      this.addNote(`Invalid Spec (${summary}) — ask me to fix it.`);
      return;
    }

    const request = spec as RequestSpec;

    // Refine branch: a `parent` ref expands the delta against that Result's own
    // resolved Spec (with its effective seed pinned), not a Profile (Phase 4).
    if (request.parent) {
      const parentId = this.resolveParentRef(request.parent);
      const parentResult = parentId ? results.get(parentId) : undefined;
      if (!parentResult) {
        this.addNote(`Couldn't find Result "${request.parent}" to refine.`);
        return;
      }
      const base = {
        ...structuredClone(parentResult.resolvedSpec),
        sampling: { ...parentResult.resolvedSpec.sampling, seed: parentResult.seed },
      };
      const resolved = applyRefineDelta(base, { ...request, parent: parentId });
      generation.applySpec(resolved);
      results.stageRefine(parentId!, request.intent ?? null);
      this.specApplied = true;
      this.addNote(`Refining #${results.numberOf(parentId!)} — review and press Generate.`);
      return;
    }

    const profile = pipelineProfiles.get(request.profile);
    if (!profile) {
      this.addNote(`Unknown profile "${request.profile}".`);
      return;
    }

    // The baseline `default` Profile merges onto the *current* control-panel
    // state so chat never clobbers the operator's manual edits; a named Profile
    // intentionally merges onto its saved defaults.
    const base =
      request.profile === DEFAULT_PROFILE_ID
        ? profileDefaultsFromResolved(generation.toSpec())
        : profile.defaults;
    const resolved = mergeIntoResolved(base, request);
    generation.applySpec(resolved);
    results.stageFresh(request.intent ?? null);
    this.specApplied = true;
    this.addNote("Spec applied to the controls — review and press Generate.");
  }

  /**
   * Resolve a `parent` reference the agent emitted to a board Result id. Accepts
   * a board number (`"#3"` or `"3"`) or a literal Result id; returns null when it
   * matches no current board Result.
   */
  private resolveParentRef(ref: string): string | null {
    const num = /^#?(\d+)$/.exec(ref.trim());
    if (num) return results.idForNumber(Number(num[1]));
    return results.get(ref) ? ref : null;
  }

  private addNote(content: string): void {
    this.messages.push({ id: this.nextId(), role: "note", content, streaming: false });
  }

  /** Reset the conversation AND the Result board (a new Session). */
  reset(): void {
    this.messages = [];
    this.status = "idle";
    this.specApplied = false;
    this.currentRequestId = null;
    results.reset();
    gate.reset();
  }
}

export const agent = new AgentStore();
