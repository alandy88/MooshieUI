/**
 * Agent prompt assembly + structured-output extraction (pure, UI-free).
 *
 * Phase 3 of the agentic image app: intent → request Spec. The agent replies
 * conversationally and, when it has enough to generate, appends exactly one
 * fenced ```json block carrying a **request Spec** (the thin, agent-authored
 * shape from `spec/merge.ts`). We stream the prose to the chat panel; once the
 * turn completes, `extractRequestSpec` pulls the block out so it can be
 * validated, merged against a Pipeline Profile, and applied to the form.
 *
 * This deliberately avoids tool-calling: a fenced block streams naturally and
 * does not depend on a local model's function-calling fidelity (frontend design
 * §"Local-model guardrails"). Validation of the emitted Spec is the hard gate
 * (`spec/validate.ts`), not the prompt.
 */

/** Minimal Profile descriptor the agent needs to choose one. */
export interface ProfileChoice {
  id: string;
  name: string;
  workflowId: string;
}

/** A Result already on the board, for the refine context (Phase 4). */
export interface BoardEntry {
  /** Board display number — what the operator and agent reference (`#3`). */
  number: number;
  /** Short intent/label, if known. */
  intent: string | null;
  /** Effective seed the Result was produced with. */
  seed: number;
}

/** The current board state passed into a refine turn's system prompt. */
export interface BoardContext {
  entries: BoardEntry[];
  /** The board number the operator has selected, if any (refine default). */
  activeNumber: number | null;
}

/**
 * Build the system prompt for an intent→Spec turn. `profiles` is the catalog the
 * agent must pick from; the first entry is treated as the default. When `board`
 * carries Results, the prompt also explains how to *refine* one (emit a delta
 * that references a board number via `parent`).
 */
export function buildSystemPrompt(profiles: ProfileChoice[], board?: BoardContext): string {
  const profileLines = profiles.length
    ? profiles.map((p) => `  - "${p.id}" — ${p.name} (workflow: ${p.workflowId})`).join("\n")
    : '  - "default" — Default';
  const defaultId = profiles[0]?.id ?? "default";

  const refineSection = buildRefineSection(board);

  return `You are the generation agent for an anime image-generation studio (ComfyUI backend, Danbooru-tag prompting). Your job is to turn the operator's natural-language intent into a concrete generation request.

How to respond:
- Reply in natural language: briefly confirm what you understood and what you're setting.
- When you have enough to generate, append EXACTLY ONE fenced code block tagged \`json\` containing a request Spec (schema below). Put nothing after the block.
- If the intent is genuinely ambiguous (missing subject, contradictory direction), DO NOT emit a json block — ask one concise clarifying question and stop. The next message will carry the answer.
- Never invent characters, LoRAs, or model names. Express the subject as Danbooru-style comma-separated tags in \`subject.positive\` (e.g. "1girl, solo, long hair, school uniform, ...").

Available Pipeline Profiles (pick one by id; default to "${defaultId}" unless intent clearly fits another):
${profileLines}

Request Spec fields (all optional except \`profile\`; omit anything you are not deliberately setting — omitted fields inherit the Profile's defaults):
{
  "profile": "<one of the ids above>",          // REQUIRED
  "task": "generate" | "edit",                   // default "generate"
  "intent": "<one short line restating the goal>",
  "subject": {
    "positive": "<danbooru tags, comma-separated>",
    "negative": "<tags to avoid, comma-separated>"
  },
  "sampling": { "seed": <int, -1 for random>, "steps": <int>, "cfg": <number> },
  "dimensions": { "width": <int>, "height": <int>, "batch": <int> }
}

Guidance:
- Portraits: prefer a tall frame (e.g. 832×1216). Landscapes/scenes: a wide frame (e.g. 1216×832). Otherwise leave dimensions out.
- Use seed -1 (or omit) unless the operator asked to fix or reuse a seed.
- Keep negatives light; the Profile already carries quality/negative defaults.${refineSection}`;
}

/**
 * The refine block, appended only when the board has Results. It teaches the
 * agent to emit a *delta* against a prior Result: set `parent` to the board
 * number, and include ONLY the fields that change. Omitted fields inherit the
 * referenced Result (not the Profile), so "like #3 but warmer" keeps #3's
 * composition and seed; "再来4张" sets `sampling.seed` to -1 and `dimensions.batch`.
 */
function buildRefineSection(board?: BoardContext): string {
  if (!board || board.entries.length === 0) return "";
  const lines = board.entries
    .map((e) => {
      const active = e.number === board.activeNumber ? " (selected)" : "";
      const label = e.intent ? ` — ${e.intent}` : "";
      return `  - #${e.number}${active}: seed ${e.seed}${label}`;
    })
    .join("\n");
  const activeHint = board.activeNumber
    ? ` If the operator doesn't name one, assume #${board.activeNumber} (the selected Result).`
    : "";

  return `

Results already on the board (refine these by reference):
${lines}

To REFINE a Result instead of starting fresh, set \`parent\` to its board number (e.g. "parent": "#3") and include ONLY the fields you are changing. Omitted fields inherit that Result — its composition, model, and seed — not the Profile defaults.${activeHint}
- "like #3 but warmer" ⇒ { "parent": "#3", "subject": { "positive": "<#3's tags + warm lighting tags>" } }
- "再来4张" / "4 more like this" ⇒ { "parent": "#<n>", "sampling": { "seed": -1 }, "dimensions": { "batch": 4 } }
- Keep the same seed (only omit \`sampling.seed\`) when the operator wants the SAME image tweaked; roll a fresh seed (-1) when they want variations.`;
}

/** Result of extracting structured output from an agent reply. */
export interface ExtractResult {
  /** Parsed request-Spec object (untrusted — validate before use), or null. */
  spec: unknown | null;
  /** True when a json block was present but failed to parse. */
  parseError: boolean;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/gi;

/**
 * Pull the request Spec out of an agent reply. Returns the LAST fenced json
 * block (the agent may reason in prose, then emit the final block). `spec` is
 * null when no block is present (e.g. a clarifying question); `parseError` is
 * true when a block was found but isn't valid JSON.
 */
export function extractRequestSpec(text: string): ExtractResult {
  let last: string | null = null;
  for (const m of text.matchAll(FENCE_RE)) {
    const inner = m[1]?.trim();
    if (inner) last = inner;
  }
  if (last === null) return { spec: null, parseError: false };
  try {
    return { spec: JSON.parse(last), parseError: false };
  } catch {
    return { spec: null, parseError: true };
  }
}
