// Engine files at the mark instant for the Layer 1 jfred commit route (task 361, phase 3a).

import { buildReconstructionWithConsent } from "./viewer_api.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import type { BuiltReconstruction } from "./reconstruction_json.ts";
import { computeRepoStateAtTime } from "./reconstruction_steps.ts";
import { convertToProjectRelativePath } from "./layer1_snapshot_wire.ts";
import type { Path } from "./structures/domain.ts";

// onProgress is the route's writeNdjsonLine: the engine's stage events reach the page's loading bar.
export function buildJfredReconstruction(jsonlPaths: Path[], onProgress: ProgressSink): BuiltReconstruction {
  return buildReconstructionWithConsent(jsonlPaths, undefined, false, onProgress, true);
}

// Engine text per project-relative path at `when`; a file outside the project folder is not part of the repo.
export function listEngineFilesAt(dir: Path, histories: FileHistory[], when: Date): Map<string, string> {
  const files = new Map<string, string>();
  for (const [absolutePath, text] of computeRepoStateAtTime(histories, when)) {
    const relativePath = convertToProjectRelativePath(dir, absolutePath.toString());
    if (relativePath !== undefined) {
      files.set(relativePath, text);
    }
  }
  return files;
}

// A path only in `before` (a deletion) is not a change: jfred trees keep repo-only files.
function isAnyFileTextChanged(before: Map<string, string>, after: Map<string, string>): boolean {
  for (const [relativePath, afterText] of after) {
    const beforeText = before.get(relativePath);
    const isChanged = beforeText !== afterText;
    if (isChanged) {
      return true;
    }
  }
  return false;
}

// The first step after the mark where some file text differs from the mark; undefined when none.
// ponytail: recomputes the whole state per later step; stop early by changedPaths when a project has thousands of steps.
export function findNextChangingInstant(dir: Path, built: BuiltReconstruction, markInstant: Date, markFiles: Map<string, string>): Date | undefined {
  for (const step of built.document.steps) {
    const isAfterMark = step.when.getTime() > markInstant.getTime();
    if (isAfterMark) {
      const stepFiles = listEngineFilesAt(dir, built.stepFileHistories, step.when);
      const isStepChanged = isAnyFileTextChanged(markFiles, stepFiles);
      if (isStepChanged) {
        return step.when;
      }
    }
  }
  return undefined;
}
