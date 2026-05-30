/**
 * Pure prompt-assembly helpers extracted from `generation.svelte.ts` so the
 * Spec→params assembler can run headless (no Svelte runes). These are verbatim
 * moves — behaviour must be byte-identical to the originals, which the byte-diff
 * test guards.
 */

/**
 * Translate NAI-style weight brackets to ComfyUI (tag:weight) syntax.
 * - {text} → (text:1.05)   — each layer multiplies by 1.05
 * - [text] → (text:0.9524)  — each layer divides by 1.05
 * - 1.1::text:: → (text:1.1) — A1111-style weight prefix
 * Processes innermost brackets first, so nesting works: {{tag}} → ((tag:1.05):1.05)
 */
export function translateNaiWeightSyntax(prompt: string): string {
  // Process A1111-style weight::text:: syntax first
  prompt = prompt.replace(/(\d+\.?\d*)::([^:]+)::/g, (_m, weight, text) => {
    return `(${text.trim()}:${parseFloat(weight).toFixed(2)})`;
  });

  // Process innermost {text} → (text:1.05) repeatedly
  let prev: string;
  do {
    prev = prompt;
    prompt = prompt.replace(/\{([^{}]+)\}/g, (_m, inner) => `(${inner}:1.05)`);
  } while (prompt !== prev);

  // Process innermost [text] → (text:0.95) repeatedly
  // Skip escaped brackets \[ and \]
  do {
    prev = prompt;
    prompt = prompt.replace(/(?<!\\)\[([^\[\]]+)\]/g, (_m, inner) => `(${inner}:0.95)`);
  } while (prompt !== prev);

  return prompt;
}

function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => !!part);
}

/**
 * Merge `extra` tags into `base`, deduping case-insensitively against tags
 * already present. Preserves `base` order; appends new `extra` tags in order.
 */
export function mergeTagPrompts(base: string, extra: string): string {
  if (!extra) return base;
  const existing = splitTags(base);
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  const merged = [...existing];

  for (const tag of splitTags(extra)) {
    const normalized = tag.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(tag);
    }
  }

  return merged.join(", ");
}
