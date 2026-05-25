import type { UsageTracker, IterationUsageLike } from "./usage-log.mts";

export const COMPLETE_PROMISE_SENTINEL = "<promise>COMPLETE</promise>";

type RunOptionsLike = {
  maxIterations?: number;
  name?: string;
  logging?: { type: "file"; path: string } | { type: "stdout" };
};

type RunResultLike = {
  iterations?: unknown[];
  completionSignal?: string;
  stdout?: string;
};

function normalizedMaxIterations(maxIterations: number | undefined): number {
  return Number.isInteger(maxIterations) && maxIterations! > 0 ? maxIterations! : 1;
}

function reachedIterationCap(
  options: RunOptionsLike,
  result: RunResultLike,
): boolean {
  if (!Array.isArray(result.iterations)) {
    return true;
  }

  const maxIterations = normalizedMaxIterations(options.maxIterations);
  return result.iterations.length >= maxIterations && !result.completionSignal;
}

function hasCompletionSentinel(result: RunResultLike): boolean {
  if (result.completionSignal?.includes(COMPLETE_PROMISE_SENTINEL)) {
    return true;
  }
  return (result.stdout ?? "").includes(COMPLETE_PROMISE_SENTINEL);
}

function extractRunId(options: RunOptionsLike): string {
  if (!options.logging || options.logging.type !== "file") {
    return "unknown";
  }

  const normalizedPath = options.logging.path.replace(/\\/g, "/");
  const marker = ".sandcastle/logs/";
  const markerIndex = normalizedPath.indexOf(marker);
  if (markerIndex < 0) {
    return "unknown";
  }

  const afterMarker = normalizedPath.slice(markerIndex + marker.length);
  const [runId] = afterMarker.split("/");
  return runId || "unknown";
}

function formatWarning(options: RunOptionsLike): string {
  const phase = options.name ?? "unknown";
  const maxIterations = normalizedMaxIterations(options.maxIterations);
  const runId = extractRunId(options);
  return `[cap-warning] phase=${phase} maxIterations=${maxIterations} run=${runId}`;
}

type WrapOpts = { usage?: UsageTracker };

export function withCapWarning<
  TOptions extends RunOptionsLike,
  TResult extends RunResultLike,
>(
  run: (options: TOptions) => Promise<TResult>,
  wrapOpts: WrapOpts = {},
): (options: TOptions) => Promise<TResult> {
  return async (options: TOptions): Promise<TResult> => {
    const result = await run(options);

    if (reachedIterationCap(options, result) && !hasCompletionSentinel(result)) {
      console.log(formatWarning(options));
    }

    if (wrapOpts.usage && Array.isArray(result.iterations)) {
      const iterations = result.iterations as Array<{ usage?: IterationUsageLike }>;
      wrapOpts.usage.record(options.name ?? "unknown", iterations);
    }

    return result;
  };
}
