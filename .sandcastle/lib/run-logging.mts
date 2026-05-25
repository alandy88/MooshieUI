import { createWriteStream, mkdirSync } from "node:fs";
import { posix as pathPosix } from "node:path";

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

type SwarmLogTarget =
  | { kind: "plan" }
  | { kind: "merge" }
  | { kind: "issue"; number: number; slug: string; agent: "implement" | "review" | "retro" | "pr" };

type SpikeLogTarget =
  | { kind: "phase"; name: string }
  | { kind: "attempt"; branch: string; name: string };

export function buildRunId(
  kind: "swarm" | "spike",
  opts?: { issueNumber?: number },
): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const issuePart =
    kind === "spike" && Number.isInteger(opts?.issueNumber)
      ? `-issue-${opts!.issueNumber}`
      : "";
  return `${kind}${issuePart}-${stamp}-${process.pid}`;
}

export function swarmLogPath(
  logsBase: string,
  iteration: number,
  target: SwarmLogTarget,
): string {
  const iterDir = pathPosix.join(logsBase, `iter-${iteration}`);
  if (target.kind === "plan") {
    return pathPosix.join(iterDir, "plan.log");
  }
  if (target.kind === "merge") {
    return pathPosix.join(iterDir, "merge.log");
  }
  const issueDir = pathPosix.join(
    iterDir,
    `issue-${target.number}-${sanitizePathSegment(target.slug)}`,
  );
  return pathPosix.join(
    issueDir,
    target.agent === "implement"
      ? "implement.log"
      : target.agent === "review"
        ? "review.log"
        : target.agent === "pr"
          ? "pr.log"
          : "retro.log",
  );
}

export function spikeLogPath(logsBase: string, target: SpikeLogTarget): string {
  if (target.kind === "phase") {
    return pathPosix.join(logsBase, `${sanitizePathSegment(target.name)}.log`);
  }

  const { attempt, slug } = parseSpikeBranch(target.branch);
  return pathPosix.join(
    logsBase,
    `attempt-${attempt}-${sanitizePathSegment(slug)}`,
    `${sanitizePathSegment(target.name)}.log`,
  );
}

export function installRunLog(logsDir: string): () => Promise<void> {
  mkdirSync(logsDir, { recursive: true });
  const stream = createWriteStream(pathPosix.join(logsDir, "main.log"), {
    flags: "a",
  });

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  const mirrorWrite = (
    originalWrite: typeof process.stdout.write,
    target: typeof process.stdout,
  ): typeof process.stdout.write => {
    return (
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      cb?: (error?: Error | null) => void,
    ): boolean => {
      const resolvedEncoding = typeof encoding === "string" ? encoding : "utf8";
      const fileChunk =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(resolvedEncoding);
      stream.write(fileChunk.replace(ANSI_SGR_RE, ""));

      if (typeof encoding === "function") {
        return originalWrite.call(target, chunk, encoding);
      }
      return originalWrite.call(target, chunk, encoding, cb);
    };
  };

  process.stdout.write = mirrorWrite(originalStdoutWrite, process.stdout);
  process.stderr.write = mirrorWrite(originalStderrWrite, process.stderr);

  let exiting = false;
  let disposed = false;
  const flushAndExit = (kind: "uncaughtException" | "unhandledRejection", error: unknown): void => {
    if (exiting) {
      return;
    }
    exiting = true;
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    stream.write(`\n[${kind}] ${detail}\n`);
    stream.end(() => {
      process.exit(1);
    });
  };

  const onUncaughtException = (error: unknown): void => {
    flushAndExit("uncaughtException", error);
  };

  const onUnhandledRejection = (reason: unknown): void => {
    flushAndExit("unhandledRejection", reason);
  };

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  return async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;

    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);

    if (exiting) {
      return;
    }
    exiting = true;

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  };
}

export function ensureLogParent(logPath: string): string {
  mkdirSync(pathPosix.dirname(logPath), { recursive: true });
  return logPath;
}

function parseSpikeBranch(branch: string): { attempt: number; slug: string } {
  const match = branch.match(/^spike\/(\d+)-(?:v(\d+)-)?(.+)$/);
  if (!match) {
    return { attempt: 1, slug: branch };
  }
  const attempt = match[2] ? Number(match[2]) : 1;
  return {
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
    slug: match[3],
  };
}

function sanitizePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}
