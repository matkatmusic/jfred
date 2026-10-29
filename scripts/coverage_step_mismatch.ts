// Builds the mismatch detail for one step folder the engine could not reproduce.

import { stripTrailingNewline, snapshotFileText } from "../src/reconstruction_step_snapshot.ts";
import type { RepoSnapshot, StepChange } from "../src/reconstruction_steps.ts";
import type { Path } from "../src/structures/domain.ts";
import type { ProvenanceEntry } from "../src/reconstruction_provenance.ts";
import { firstLineDifference, firstDifferingFile, selectBestEngineStep } from "./coverage_compare.ts";

// Mismatch details for one step folder the engine could not reproduce.
export type StepMismatch = { stepNum: number; jsonlLine: string; diff: string; provenance: string };

// Whether a provenance entry's target is the repo-relative differing file (matched on a path boundary).
function isProvenanceTargetFile(target: Path, differingFile: string): boolean {
  const path = target.toString();
  return path === differingFile || path.endsWith(`/${differingFile}`);
}

// One provenance entry as a line: "<stage>: <detail> (changeId …)".
function formatProvenanceEntry(entry: ProvenanceEntry): string {
  const changeId = entry.changeId ? ` (changeId ${entry.changeId})` : "";
  return `${entry.stage}: ${entry.detail}${changeId}`;
}

// Provenance entries touching the differing file at or before this step.
export function renderStepProvenance(entries: ProvenanceEntry[], differingFile: string, stepTime: Date): string {
  const formattedEntries: string[] = [];
  for (const entry of entries) {
    const touchesFile = isProvenanceTargetFile(entry.target, differingFile);
    const when = entry.when;
    const isAtOrBeforeStep = when === undefined || when.getTime() <= stepTime.getTime();
    const isMatching = touchesFile && isAtOrBeforeStep;
    if (isMatching) {
      formattedEntries.push(formatProvenanceEntry(entry));
    }
  }
  return formattedEntries.join("\n");
}

// Resolve the best step's changeId to a JSONL line number, or a sentinel for seeded revisions.
function getJsonlLineFor(change: StepChange | undefined, uuidLineIndex: Map<string, number>): string {
  for (const changeId of change?.changeIds ?? []) {
    const line = uuidLineIndex.get(changeId.toString());
    if (line !== undefined) {
      return `line ${line}`;
    }
  }
  return "(seeded — no JSONL line)";
}

// A one-line description of where the best engine step diverges from the ground-truth file.
function formatDiffDescription(file: string, expected: string, actual: string): string {
  const lineDiff = firstLineDifference(expected, actual);
  if (lineDiff === undefined) {
    return `${file} (file absent or only-trailing difference)`;
  }
  return `${file} @line ${lineDiff.lineNo}: expected ${JSON.stringify(lineDiff.expected)} got ${JSON.stringify(lineDiff.actual)}`;
}

// Build a mismatch record for one failing step folder using the best-matching engine step.
export function buildStepMismatch(
  stepNum: number,
  groundTruth: ReadonlyMap<string, string>,
  steps: RepoSnapshot[],
  stepChanges: StepChange[],
  uuidLineIndex: Map<string, number>,
  provenance: ProvenanceEntry[],
): StepMismatch {
  if (steps.length === 0) {
    const file = [...groundTruth.keys()][0] ?? "(folder empty)";
    return {
      stepNum,
      jsonlLine: "(no engine steps)",
      diff: `${file}: engine produced 0 steps (scenario may need a baseline session excluded)`,
      provenance: "",
    };
  }
  const best = selectBestEngineStep(steps, groundTruth);
  const file = firstDifferingFile(steps[best]!, groundTruth) ?? [...groundTruth.keys()][0]!;
  const expected = stripTrailingNewline(groundTruth.get(file)!);
  const actual = snapshotFileText(steps[best]!, file) ?? "";
  const diff = formatDiffDescription(file, expected, actual);
  const stepProvenance = renderStepProvenance(provenance, file, stepChanges[best]!.when);
  return { stepNum, jsonlLine: getJsonlLineFor(stepChanges[best], uuidLineIndex), diff, provenance: stepProvenance };
}
