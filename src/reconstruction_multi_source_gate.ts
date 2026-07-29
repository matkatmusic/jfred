// §a content-agreement gate for multi-source joins.

import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { reconstructFile, type EditEvent, type FileEvent } from "./reconstruction_engine.ts";
import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { lastRevisionAtOrBefore, lastRevisionStrictlyBefore, linesTextOf } from "./reconstruction_revisions.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";
import { EventKind, FailureScope } from "./structures/vocabulary.ts";

// Engine drops final newline; evidence must match that form.
function stripSingleTrailingNewline(text: string): string {
    if (text.endsWith("\n")) {
        return text.slice(0, -1);
    }
    return text;
}

// The pre-image side of one hunk: its context and removed lines, without their +/-/space markers.
function extractHunkPreSideText(hunk: StructuredPatchHunk): string {
    const preSideLines: string[] = [];
    for (const line of hunk.lines) {
        if (line.startsWith("+")) {
            continue;
        }
        preSideLines.push(line.slice(1));
    }
    return preSideLines.join("\n");
}

// Evidence channels: Edit originalFile (strict equality) and hunk pre-side containment.
// ponytail: the design's third channel (file-history backup blob) is not read yet — a non-Edit first evidence refuses the join; add the blob channel when a fixture needs it.
export function checkJoinContentAgreement(
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
    const revisions = reconstructFile(earlierRecords, primaryPath, reader);
    const base = lastRevisionAtOrBefore(revisions, editEvidence.timestamp);
    if (base === undefined) {
        return false;
    }
    return editEvidenceAgreesWithState(editEvidence, linesTextOf(base).join("\n"));
}

// One edit's pre-state evidence versus a reconstructed state: originalFile compares exactly,
// else every hunk's pre-side must be contained.
function editEvidenceAgreesWithState(edit: EditEvent, stateText: string): boolean {
    if (edit.originalFile !== undefined) {
        return stripSingleTrailingNewline(edit.originalFile) === stateText;
    }
    return edit.hunks.every((hunk) => stateText.includes(extractHunkPreSideText(hunk)));
}

// §c4: surface pre-state mismatches on joined paths as health-sink conflict notes.
export function noteJoinedPathConflicts(
    mergedRecords: TranscriptRecord[],
    primaryPath: Path,
    sources: SourceEntry[],
): void {
    const reader = buildSidecarReader(mergedRecords, sources);
    const revisions = reconstructFile(mergedRecords, primaryPath, reader);
    for (const event of extractFileEvents(mergedRecords)) {
        if (event.kind !== EventKind.edit || event.target.toString() !== primaryPath.toString()) {
            continue;
        }
        const edit: EditEvent = event;
        const base = lastRevisionStrictlyBefore(revisions, edit.timestamp);
        if (base === undefined || editEvidenceAgreesWithState(edit, linesTextOf(base).join("\n"))) {
            continue;
        }
        noteReconstructionFailure({
            scope: FailureScope.fileStage,
            stage: "noteJoinedPathConflicts",
            target: primaryPath,
            reason: `cross-source conflict: ${edit.timestamp.toISOString()} edit pre-state disagrees with the merged timeline`,
        });
    }
}
