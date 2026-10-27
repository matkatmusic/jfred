// Pure diff and patch rendering for the viewer; HTTP wiring lives in viewer_server.ts.

import { relative, sep } from "node:path";
import type { ReconstructionDocument } from "./reconstruction_json.ts";
import type { StepSnapshot } from "./reconstruction_json_steps.ts";
import { computeFilesAtStep } from "./reconstruction_steps.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import { renderDiffWithContext, renderGitFileDiff } from "./reconstruction_render_unified.ts";
import type { Path } from "./structures/domain.ts";

// The document's reconstructed history for one file, or a loud error naming the path.
function findFileHistory(document: ReconstructionDocument, filePath: Path): FileHistory {
  for (const entry of document.filesTouched) {
    const isTarget = entry.target.equals(filePath);
    if (isTarget) {
      return entry;
    }
  }
  throw new Error(`no reconstructed history for ${filePath.toString()}`);
}

// Consecutive-revision diffs for one file, with hunks and context for line-number gutters.
export function renderRevisionDiff(document: ReconstructionDocument, filePath: Path, fullContext: boolean = false): string {
  return renderDiffWithContext(findFileHistory(document, filePath).revisions, fullContext);
}

// The file's first revision against the selected one (0-based).
export function renderDiffVsBase(document: ReconstructionDocument, filePath: Path, revisionIndex: number): string {
  const revisions = findFileHistory(document, filePath).revisions;
  const first = revisions[0];
  const selected = revisions[revisionIndex];
  const isFirstMissing = first === undefined;
  const isSelectedMissing = selected === undefined;
  const isOutOfRange = isFirstMissing || isSelectedMissing;
  if (isOutOfRange) {
    throw new Error(`revision ${revisionIndex} out of range 0..${revisions.length - 1}`);
  }
  return renderDiffWithContext([first, selected]);
}

// Counts how many leading directory segments two segment lists share.
function countSharedLeadingSegments(prefix: string[], segments: string[]): number {
  let shared = 0;
  const limit = Math.min(prefix.length, segments.length);
  while (shared < limit) {
    if (prefix[shared] !== segments[shared]) {
      break;
    }
    shared += 1;
  }
  return shared;
}

// The longest common directory prefix of every tracked file, used to relativize range-patch paths.
// ponytail: prefix heuristic — carry the records' cwd on the document if multi-root projects appear.
export function computePatchRoot(stepFileHistories: FileHistory[]): string {
  const trackedPaths = new Set<string>();
  for (const history of stepFileHistories) {
    trackedPaths.add(history.target.toString());
  }
  const directorySegmentLists: string[][] = [];
  for (const path of trackedPaths) {
    directorySegmentLists.push(path.split(sep).slice(0, -1));
  }
  if (directorySegmentLists.length === 0) {
    return sep;
  }
  let prefix = directorySegmentLists[0]!;
  for (const segments of directorySegmentLists.slice(1)) {
    prefix = prefix.slice(0, countSharedLeadingSegments(prefix, segments));
  }
  return prefix.join(sep) || sep;
}

// One positive-integer query param, or a loud throw the server maps to 400.
function parsePositiveIntegerParam(query: URLSearchParams, name: string): number {
  const raw = query.get(name);
  if (raw === null) {
    throw new Error(`missing query param: ${name}`);
  }
  const value = Number(raw);
  const isInteger = Number.isInteger(value);
  if (!isInteger) {
    throw new Error(`${name} must be an integer, got: ${raw}`);
  }
  if (value < 1) {
    throw new Error(`${name} must be >= 1, got: ${raw}`);
  }
  return value;
}

// Parses GET /api/range-patch: both step params are required 1-based positive integers.
export function parseRangePatchQuery(query: URLSearchParams): { fromStep: number; toStep: number } {
  return {
    fromStep: parsePositiveIntegerParam(query, "fromStep"),
    toStep: parsePositiveIntegerParam(query, "toStep"),
  };
}

// Parses GET /api/step-files: `step` is a required 1-based positive integer.
export function parseStepFilesQuery(query: URLSearchParams): { step: number } {
  return { step: parsePositiveIntegerParam(query, "step") };
}

// The { path: content } map of every file present at a 1-based step; throws when out of range.
export function computeStepFiles(stepFileHistories: FileHistory[], steps: StepSnapshot[], stepNumber: number): Record<string, string> {
  const isBelowRange = stepNumber < 1;
  const isAboveRange = stepNumber > steps.length;
  const isOutOfRange = isBelowRange || isAboveRange;
  if (isOutOfRange) {
    throw new Error(`step ${stepNumber} out of range 1..${steps.length}`);
  }
  return computeFilesAtStep(stepFileHistories, steps[stepNumber - 1]!.when);
}

// One git-apply-able diff of every file differing between the snapshot before `fromStep` and at `toStep`.
export function renderRangePatch(stepFileHistories: FileHistory[], steps: StepSnapshot[], fromStep: number, toStep: number): string {
  if (fromStep < 1) {
    throw new Error(`fromStep ${fromStep} out of range 1..${steps.length}`);
  }
  if (toStep > steps.length) {
    throw new Error(`toStep ${toStep} out of range 1..${steps.length}`);
  }
  if (fromStep > toStep) {
    throw new Error(`fromStep ${fromStep} exceeds toStep ${toStep}`);
  }
  // The snapshot before step 1 is empty.
  const before: Record<string, string> = fromStep >= 2 ? computeFilesAtStep(stepFileHistories, steps[fromStep - 2]!.when) : {};
  const after = computeFilesAtStep(stepFileHistories, steps[toStep - 1]!.when);
  const root = computePatchRoot(stepFileHistories);
  const allPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  let patch = "";
  for (const path of allPaths) {
    if (before[path] !== after[path]) {
      patch += renderGitFileDiff(relative(root, path), before[path], after[path]);
    }
  }
  return patch;
}
