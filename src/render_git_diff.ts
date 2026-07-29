// Real-git unified diff between two in-memory line arrays (item 51): git's hunk headers carry function context ("@@ -a,b +c,d @@ def reorder(...)"), which the pure-TS renderer cannot produce. Used by renderDiffWithContext for the viewer's /api/diff surfaces only.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The default unified-diff context width (git's own default) — the ±N context lines around each change the webapp normally shows.
export const DEFAULT_DIFF_CONTEXT_LINES = 3;
// "Show full contents" (item 75): a context width larger than any real file, so git emits the whole file as one hunk (every unchanged line present as context).
export const FULL_FILE_CONTEXT_LINES = 1_000_000;

// Serialize one side for git: exact lines, always newline-terminated so git never emits "\ No newline at end of file" markers into the webapp's row renderers.
function writeSideFile(directory: string, name: string, lines: string[]): string {
    const path = join(directory, name);
    writeFileSync(path, lines.length === 0 ? "" : lines.join("\n") + "\n");
    return path;
}

// The unified hunks (headers + bodies, preamble stripped) git produces between before and after; "" when the sides are identical. Throws on a real git failure (exit >= 2).
export function runGitUnifiedDiff(
    beforeLines: string[],
    afterLines: string[],
    contextLines: number = DEFAULT_DIFF_CONTEXT_LINES,
): string {
    const directory = mkdtempSync(join(tmpdir(), "reveng-diff-"));
    try {
        const beforePath = writeSideFile(directory, "before", beforeLines);
        const afterPath = writeSideFile(directory, "after", afterLines);
        // ponytail: one spawn per revision per request; memoize on (before, after) content hashes if diff-route latency ever matters.
        const result = spawnSync(
            "git",
            ["diff", "--no-index", "--no-color", `--unified=${contextLines}`, "--", beforePath, afterPath],
            { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        );
        if (result.status !== 0 && result.status !== 1) {
            throw new Error(`git diff --no-index failed (${result.status}): ${result.stderr}`);
        }
        const lines = result.stdout.split("\n");
        const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ -"));
        if (firstHunkIndex < 0) {
            return "";
        }
        return lines.slice(firstHunkIndex).join("\n").replace(/\n+$/, "");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

