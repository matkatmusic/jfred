// §a content-agreement gate for multi-source joins.

import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { buildFileRevisions } from "./reconstruction_engine.ts";
import type { EditEvent, FileEvent } from "./reconstruction_events.ts";
import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { findLastRevisionAtOrBefore, findLastRevisionStrictlyBefore, getLinesText } from "./reconstruction_revisions.ts";
import { reportReconstructionFailure } from "./reconstruction_health.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { FailureScope } from "./structures/vocabulary_views.ts";

// Engine drops final newline; evidence must match that form.
function trimSingleTrailingNewline(text: string): string {
  const hasTrailingNewline = text.endsWith("\n");
  if (hasTrailingNewline) {
    return text.slice(0, -1);
  }
  return text;
}

// The pre-image side of one hunk: its context and removed lines, without their +/-/space markers.
function extractHunkPreSideText(hunk: StructuredPatchHunk): string {
  const preSideLines: string[] = [];
  for (const line of hunk.lines) {
    const isAddedLine = line.startsWith("+");
    if (isAddedLine) {
      continue;
    }
    preSideLines.push(line.slice(1));
  }
  return preSideLines.join("\n");
}

// Evidence channels: Edit originalFile (strict equality) and hunk pre-side containment.
// ponytail: the design's third channel (file-history backup blob) is not read yet — a non-Edit first evidence refuses the join; add the blob channel when a fixture needs it.
export function validateJoinContentAgreement(
  earlierRecords: TranscriptRecord[],
  primaryPath: Path,
  evidence: FileEvent,
  sources: SourceEntry[],
): boolean {
  if (evidence.kind !== EventKind.edit) {
    return false;
  }
  const editEvidence: EditEvent = evidence;
  const reader = buildSidecarReader(earlierRecords, sources);
  const revisions = buildFileRevisions(earlierRecords, primaryPath, reader);
  const base = findLastRevisionAtOrBefore(revisions, editEvidence.timestamp);
  if (base === undefined) {
    return false;
  }
  return isEditEvidenceMatchingState(editEvidence, getLinesText(base).join("\n"));
}

// One edit's pre-state evidence versus a reconstructed state: originalFile compares exactly, else every hunk's pre-side must be contained.
export function isEditEvidenceMatchingState(edit: EditEvent, stateText: string): boolean {
  if (edit.originalFile != null) {
    return trimSingleTrailingNewline(edit.originalFile) === stateText;
  }
  for (const hunk of edit.hunks) {
    const preSideText = extractHunkPreSideText(hunk);
    const isContained = stateText.includes(preSideText);
    if (!isContained) {
      return false;
    }
  }
  return true;
}

// §c4: surface pre-state mismatches on joined paths as health-sink conflict notes.
export function reportJoinedPathConflicts(
  mergedRecords: TranscriptRecord[],
  primaryPath: Path,
  sources: SourceEntry[],
): void {
  const reader = buildSidecarReader(mergedRecords, sources);
  const revisions = buildFileRevisions(mergedRecords, primaryPath, reader);
  for (const event of extractFileEvents(mergedRecords)) {
    const isNotEdit = event.kind !== EventKind.edit;
    if (isNotEdit) {
      continue;
    }
    const eventTarget = event.target.toString();
    const primaryTarget = primaryPath.toString();
    const isOtherPath = eventTarget !== primaryTarget;
    if (isOtherPath) {
      continue;
    }
    const edit: EditEvent = event;
    const base = findLastRevisionStrictlyBefore(revisions, edit.timestamp);
    const isMissingBase = base === undefined;
    if (isMissingBase) {
      continue;
    }
    const isAgreeing = isEditEvidenceMatchingState(edit, getLinesText(base).join("\n"));
    if (isAgreeing) {
      continue;
    }
    reportReconstructionFailure({
      scope: FailureScope.fileStage,
      stage: "noteJoinedPathConflicts",
      target: primaryPath,
      reason: `cross-source conflict: ${edit.timestamp.toISOString()} edit pre-state disagrees with the merged timeline`,
    });
  }
}
