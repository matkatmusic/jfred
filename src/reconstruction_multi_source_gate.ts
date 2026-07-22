// The §a content-agreement gate (spec S5a, design plans/166-multi-source-design.md): does the
// joining source's first content evidence for a file match the state the already-merged timeline
// reconstructs at that instant? Split from reconstruction_multi_source_join.ts (250-line cap).

import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { reconstructFile, type EditEvent, type FileEvent } from "./reconstruction_engine.ts";
import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { buildSidecarReader } from "./reconstruction_sidecar_reader.ts";
import { lastRevisionAtOrBefore, linesTextOf } from "./reconstruction_revisions.ts";
import { EventKind } from "./structures/vocabulary.ts";

// A single trailing newline stripped — the engine's line model drops a file's final newline
// (a trailing "\n" does not create an empty line entry), so evidence text must be compared
// in the same normal form.
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

// Evidence channels implemented: Edit originalFile (exact pre-edit disk → strict equality) and
// Edit hunk pre-side containment.
// ponytail: the design's third channel (file-history backup blob) is not read yet — a non-Edit
// first evidence refuses the join; add the blob channel when a fixture needs it.
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
    const reconstructedContent = linesTextOf(base).join("\n");
    if (editEvidence.originalFile !== undefined) {
        return stripSingleTrailingNewline(editEvidence.originalFile) === reconstructedContent;
    }
    return editEvidence.hunks.every((hunk) => reconstructedContent.includes(extractHunkPreSideText(hunk)));
}
