import assert from "node:assert/strict";
import test from "node:test";

import { countCommitsAhead, type GitRunner } from "./branch-commits.mts";

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const writes: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void): boolean => {
    const resolvedEncoding = typeof encoding === "string" ? encoding : "utf8";
    const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(resolvedEncoding);
    writes.push(value);
    if (typeof encoding === "function") {
      encoding();
      return true;
    }
    if (typeof cb === "function") {
      cb();
    }
    return true;
  }) as typeof process.stderr.write;

  try {
    const result = await fn();
    return { result, stderr: writes.join("") };
  } finally {
    process.stderr.write = originalWrite;
  }
}

function fakeRunner(stdout: string, exitCode: number): GitRunner {
  return async () => ({ stdout, exitCode });
}

test("returns numeric count when runner exits 0 with numeric stdout", async () => {
  const run = fakeRunner("3\n", 0);
  const count = await countCommitsAhead("feature", "origin/main", run);
  assert.equal(count, 3);
});

test("returns 0 when runner exits 0 with stdout '0'", async () => {
  const run = fakeRunner("0\n", 0);
  const count = await countCommitsAhead("feature", "origin/main", run);
  assert.equal(count, 0);
});

test("returns 0 and warns on stderr when runner exits non-zero", async () => {
  const run = fakeRunner("", 128);
  const { result, stderr } = await captureStderr(() =>
    countCommitsAhead("unknown-branch", "origin/main", run),
  );
  assert.equal(result, 0);
  assert.match(stderr, /\[branch-commits\]/);
  assert.match(stderr, /exited 128/);
});

test("returns 0 and warns on stderr when stdout is non-numeric", async () => {
  const run = fakeRunner("not a number\n", 0);
  const { result, stderr } = await captureStderr(() =>
    countCommitsAhead("feature", "origin/main", run),
  );
  assert.equal(result, 0);
  assert.match(stderr, /\[branch-commits\]/);
  assert.match(stderr, /non-numeric stdout/);
});

test("returns 0 and warns when stdout is empty", async () => {
  const run = fakeRunner("", 0);
  const { result, stderr } = await captureStderr(() =>
    countCommitsAhead("feature", "origin/main", run),
  );
  assert.equal(result, 0);
  assert.match(stderr, /non-numeric stdout/);
});

test("returns 0 and warns when runner throws", async () => {
  const run: GitRunner = async () => {
    throw new Error("ENOENT git");
  };
  const { result, stderr } = await captureStderr(() =>
    countCommitsAhead("feature", "origin/main", run),
  );
  assert.equal(result, 0);
  assert.match(stderr, /threw: ENOENT git/);
});

test("does not throw when branch equals base; runner returns '0'", async () => {
  const run = fakeRunner("0\n", 0);
  const count = await countCommitsAhead("origin/main", "origin/main", run);
  assert.equal(count, 0);
});

test("passes args to runner exactly: rev-list base..branch --count", async () => {
  let received: string[] | null = null;
  const run: GitRunner = async (args) => {
    received = args;
    return { stdout: "1\n", exitCode: 0 };
  };
  await countCommitsAhead("sandcastle/issue-85", "origin/main", run);
  assert.deepEqual(received, ["rev-list", "origin/main..sandcastle/issue-85", "--count"]);
});
