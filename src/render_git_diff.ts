// Real-git unified diff of two line arrays, so hunk headers carry function context.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Default context width: git's own default of 3 lines around each change.
export const DEFAULT_DIFF_CONTEXT_LINES = 3;
// Context width larger than any real file, so git emits the whole file as one hunk.
export const FULL_FILE_CONTEXT_LINES = 1_000_000;

// Write one side for git, newline-terminated so git emits no "No newline" markers.
function writeSideFile(directory: string, name: string, lines: string[]): string {
  const path = join(directory, name);
  writeFileSync(path, lines.length === 0 ? "" : lines.join("\n") + "\n");
  return path;
}

// Git's unified hunks without preamble; "" when sides match. Throws on git failure.
export function getGitUnifiedDiff(
  beforeLines: string[],
  afterLines: string[],
  contextLines: number = DEFAULT_DIFF_CONTEXT_LINES,
): string {
  const directory = mkdtempSync(join(tmpdir(), "reveng-diff-"));
  try {
    const beforePath = writeSideFile(directory, "before", beforeLines);
    const afterPath = writeSideFile(directory, "after", afterLines);
    // ponytail: one spawn per request; memoize on content hashes if latency matters.
    const result = spawnSync(
      "git",
      ["diff", "--no-index", "--no-color", `--unified=${contextLines}`, "--", beforePath, afterPath],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const isNotIdentical = result.status !== 0;
    const isNotDifferent = result.status !== 1;
    const isGitFailure = isNotIdentical && isNotDifferent;
    if (isGitFailure) {
      throw new Error(`git diff --no-index failed (${result.status}): ${result.stderr}`);
    }
    const lines = result.stdout.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const isHunkHeader = lines[index]!.startsWith("@@ -");
      if (isHunkHeader) {
        const hunkText = lines.slice(index).join("\n");
        return hunkText.replace(/\n+$/, "");
      }
    }
    return "";
  }
  finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

