// Pure text-diff and best-step selection for scenario coverage checks.

import {
    snapshotFileText,
    stripTrailingNewline,
    type RepoSnapshot,
} from "../src/reconstruction_steps.ts";

export function firstLineDifference(
    expected: string,
    actual: string,
): { lineNo: number; expected: string; actual: string } | undefined {
    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");
    const count = Math.max(expectedLines.length, actualLines.length);
    for (let line = 0; line < count; line += 1) {
        if ((expectedLines[line] ?? "") !== (actualLines[line] ?? "")) {
            return { lineNo: line + 1, expected: expectedLines[line] ?? "", actual: actualLines[line] ?? "" };
        }
    }
    return undefined;
}

// How many line positions differ between two texts.
function countDifferingLines(expected: string, actual: string): number {
    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");
    const count = Math.max(expectedLines.length, actualLines.length);
    let differing = 0;
    for (let line = 0; line < count; line += 1) {
        if ((expectedLines[line] ?? "") !== (actualLines[line] ?? "")) {
            differing += 1;
        }
    }
    return differing;
}

// How many of the ground-truth files this snapshot reproduces byte-for-byte (trailing newline stripped).
function reproducedCount(snapshot: RepoSnapshot, groundTruth: ReadonlyMap<string, string>): number {
    return [...groundTruth].filter(
        ([relativePath, content]) => snapshotFileText(snapshot, relativePath) === stripTrailingNewline(content),
    ).length;
}

// The first ground-truth file this snapshot does NOT reproduce, or undefined when it reproduces them all.
export function firstDifferingFile(
    snapshot: RepoSnapshot,
    groundTruth: ReadonlyMap<string, string>,
): string | undefined {
    for (const [relativePath, content] of groundTruth) {
        if (snapshotFileText(snapshot, relativePath) !== stripTrailingNewline(content)) {
            return relativePath;
        }
    }
    return undefined;
}

// Tie-breaker: differing-line count on the first non-matching file.
function tieBreakLines(snapshot: RepoSnapshot, groundTruth: ReadonlyMap<string, string>): number {
    const file = firstDifferingFile(snapshot, groundTruth);
    if (file === undefined) {
        return 0;
    }
    const expected = stripTrailingNewline(groundTruth.get(file)!);
    return countDifferingLines(expected, snapshotFileText(snapshot, file) ?? "");
}

// Tie-breaks on fewest differing lines so attribution is independent of step count.
export function selectBestEngineStep(steps: RepoSnapshot[], groundTruth: ReadonlyMap<string, string>): number {
    let bestIndex = 0;
    let bestReproduced = -1;
    let bestTie = Number.POSITIVE_INFINITY;
    steps.forEach((snapshot, index) => {
        const reproduced = reproducedCount(snapshot, groundTruth);
        const tie = tieBreakLines(snapshot, groundTruth);
        if (reproduced > bestReproduced || (reproduced === bestReproduced && tie < bestTie)) {
            bestIndex = index;
            bestReproduced = reproduced;
            bestTie = tie;
        }
    });
    return bestIndex;
}

