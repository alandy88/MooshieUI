export type GitRunner = (
  args: string[],
) => Promise<{ stdout: string; exitCode: number }>;

export async function countCommitsAhead(
  branch: string,
  base: string,
  run: GitRunner,
): Promise<number> {
  const args = ["rev-list", `${base}..${branch}`, "--count"];
  let result: { stdout: string; exitCode: number };
  try {
    result = await run(args);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[branch-commits] git ${args.join(" ")} threw: ${detail}\n`,
    );
    return 0;
  }

  if (result.exitCode !== 0) {
    process.stderr.write(
      `[branch-commits] git ${args.join(" ")} exited ${result.exitCode}; treating as 0\n`,
    );
    return 0;
  }

  const trimmed = result.stdout.trim();
  if (!/^\d+$/.test(trimmed)) {
    process.stderr.write(
      `[branch-commits] git ${args.join(" ")} returned non-numeric stdout ${JSON.stringify(trimmed)}; treating as 0\n`,
    );
    return 0;
  }

  return Number.parseInt(trimmed, 10);
}
