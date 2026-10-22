// Task 355: string-level hunk helpers for Edit replay; the one home for "does this hunk match" and "apply these hunks".

import type { StructuredPatchHunk } from "./structures/tool-results.ts";

// A hunk matches when every context and removed row equals the base line at its position.
export function checkHunkMatchesBase(base: string[], hunk: StructuredPatchHunk): boolean {
    let cursor = hunk.oldStart - 1;
    for (const row of hunk.lines) {
        const isOldSide = !row.startsWith("+");
        if (!isOldSide) {
            continue;
        }
        if (base[cursor] !== row.slice(1)) {
            return false;
        }
        cursor += 1;
    }
    return true;
}

// Best effort when the hunk disagrees with the base: positions decide, the base keeps its own text.
export function applyHunksToLines(base: string[], hunks: StructuredPatchHunk[]): string[] {
    const result: string[] = [];
    let cursor = 0;
    for (const hunk of hunks) {
        const hunkStart = hunk.oldStart - 1;
        result.push(...base.slice(cursor, hunkStart));
        cursor = hunkStart;
        for (const row of hunk.lines) {
            if (row.startsWith("+")) {
                result.push(row.slice(1));
                continue;
            }
            if (row.startsWith(" ")) {
                result.push(base[cursor]!);
            }
            cursor += 1;
        }
    }
    result.push(...base.slice(cursor));
    return result;
}
