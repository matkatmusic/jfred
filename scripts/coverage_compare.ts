// Pure text-diff and best-step selection for scenario coverage checks.

import type { RepoSnapshot } from "../src/reconstruction_steps.ts";
import {
  getSnapshotFileText,
  trimTrailingNewline,
} from "../src/reconstruction_step_snapshot.ts";

export function findFirstLineDifference(
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
function countReproducedFiles(snapshot: RepoSnapshot, groundTruth: ReadonlyMap<string, string>): number {
  let reproduced = 0;
  for (const [relativePath, content] of groundTruth) {
    const isReproduced = getSnapshotFileText(snapshot, relativePath) === trimTrailingNewline(content);
    if (isReproduced) {
      reproduced += 1;
    }
  }
  return reproduced;
}

// The first ground-truth file this snapshot does NOT reproduce, or undefined when it reproduces them all.
export function findFirstDifferingFile(
  snapshot: RepoSnapshot,
  groundTruth: ReadonlyMap<string, string>,
): string | undefined {
  for (const [relativePath, content] of groundTruth) {
    const isDifferent = getSnapshotFileText(snapshot, relativePath) !== trimTrailingNewline(content);
    if (isDifferent) {
      return relativePath;
    }
  }
  return undefined;
}

// Tie-breaker: differing-line count on the first non-matching file.
function countTieBreakLines(snapshot: RepoSnapshot, groundTruth: ReadonlyMap<string, string>): number {
  const file = findFirstDifferingFile(snapshot, groundTruth);
  if (file === undefined) {
    return 0;
  }
  const expected = trimTrailingNewline(groundTruth.get(file)!);
  return countDifferingLines(expected, getSnapshotFileText(snapshot, file) ?? "");
}

// Tie-breaks on fewest differing lines so attribution is independent of step count.
export function selectBestEngineStep(steps: RepoSnapshot[], groundTruth: ReadonlyMap<string, string>): number {
  let bestIndex = 0;
  let bestReproduced = -1;
  let bestTie = Number.POSITIVE_INFINITY;
  for (const [index, snapshot] of steps.entries()) {
    const reproduced = countReproducedFiles(snapshot, groundTruth);
    const tie = countTieBreakLines(snapshot, groundTruth);
    const isMoreReproduced = reproduced > bestReproduced;
    const isTiedAndCloser = reproduced === bestReproduced && tie < bestTie;
    const isBetter = isMoreReproduced || isTiedAndCloser;
    if (isBetter) {
      bestIndex = index;
      bestReproduced = reproduced;
      bestTie = tie;
    }
  }
  return bestIndex;
}
