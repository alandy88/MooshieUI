import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { posix as pathPosix } from "node:path";

export type IterationUsageLike = {
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly outputTokens: number;
};

export type UsageTotals = {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  iterations: number;
};

export type PhaseEntry = {
  name: string;
  totals: UsageTotals;
};

const PRICE_PER_MTOK = {
  sonnet: { input: 3, cacheCreate: 3.75, cacheRead: 0.3, output: 15 },
} as const;

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    iterations: 0,
  };
}

function addInto(target: UsageTotals, source: IterationUsageLike): void {
  target.inputTokens += source.inputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.outputTokens += source.outputTokens;
  target.iterations += 1;
}

export function sumIterationUsages(
  iterations: ReadonlyArray<{ usage?: IterationUsageLike }>,
): UsageTotals {
  const totals = emptyTotals();
  for (const it of iterations) {
    if (it.usage) addInto(totals, it.usage);
  }
  return totals;
}

export function estimateSonnetCostUsd(totals: UsageTotals): number {
  const p = PRICE_PER_MTOK.sonnet;
  return (
    (totals.inputTokens * p.input +
      totals.cacheCreationInputTokens * p.cacheCreate +
      totals.cacheReadInputTokens * p.cacheRead +
      totals.outputTokens * p.output) /
    1_000_000
  );
}

export function formatTotals(totals: UsageTotals): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return [
    `input=${fmt(totals.inputTokens)}`,
    `cache_create=${fmt(totals.cacheCreationInputTokens)}`,
    `cache_read=${fmt(totals.cacheReadInputTokens)}`,
    `output=${fmt(totals.outputTokens)}`,
    `iters=${totals.iterations}`,
    `~$${estimateSonnetCostUsd(totals).toFixed(2)}`,
  ].join(" ");
}

export type UsageTracker = {
  record(phase: string, iterations: ReadonlyArray<{ usage?: IterationUsageLike }>): void;
  finalize(): Promise<void>;
  totals(): UsageTotals;
};

export function createUsageTracker(logsDir: string): UsageTracker {
  const phases: PhaseEntry[] = [];
  const grand = emptyTotals();
  const usageLogPath = pathPosix.join(logsDir, "usage.log");
  const usageJsonPath = pathPosix.join(logsDir, "usage.json");
  let initialized = false;

  const init = async () => {
    if (initialized) return;
    initialized = true;
    await mkdir(logsDir, { recursive: true });
  };

  return {
    record(phase, iterations) {
      const totals = sumIterationUsages(iterations);
      if (totals.iterations === 0) return;
      phases.push({ name: phase, totals });
      addInto(grand, {
        inputTokens: totals.inputTokens,
        cacheCreationInputTokens: totals.cacheCreationInputTokens,
        cacheReadInputTokens: totals.cacheReadInputTokens,
        outputTokens: totals.outputTokens,
      });
      const line = `[usage] phase=${phase} ${formatTotals(totals)}\n`;
      console.log(line.trimEnd());
      void init().then(() => appendFile(usageLogPath, line, "utf8"));
    },
    async finalize() {
      await init();
      if (phases.length === 0) {
        const warning =
          `[usage] no per-phase usage captured (Sandbox.run() session-capture appears unavailable; totals undercount agent costs)\n`;
        console.log(warning.trimEnd());
        await appendFile(usageLogPath, warning, "utf8");
      }
      const summary = `[usage] TOTAL ${formatTotals(grand)}\n`;
      console.log(summary.trimEnd());
      await appendFile(usageLogPath, summary, "utf8");
      await writeFile(
        usageJsonPath,
        JSON.stringify({ total: grand, phases }, null, 2) + "\n",
        "utf8",
      );
    },
    totals() {
      return { ...grand };
    },
  };
}
