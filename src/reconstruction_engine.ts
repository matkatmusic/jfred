// Per-line reconstruction engine (clean-room rebuild of "Engine B"): the model
// and the public reconstruction API that turns a transcript into each touched
// file's history. Extraction (records -> events) lives in reconstruction_extract.ts,
// replay (events -> revisions) in reconstruction_replay.ts, lineage (following a
// file across renames) in reconstruction_lineage.ts; rendering in
// reconstruction_render.ts; the runnable entry in reconstruction_cli.ts.
// Design: plans/reconstruction-engine-design.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import {
    collectSurvivingUuids,
    findConversationBranches,
    selectBranchRecords,
    selectLiveBranch,
    type ConversationBranch,
} from "./reconstruction_branch.ts";
import { reconstructFileOver } from "./reconstruction_branches.ts";
import { reconstructFilesOver } from "./reconstruction_renderable.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { ScriptExecutionEvent } from "./reconstruction_script_execution.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// --- The per-line model ------------------------------------------------------

// A single sighting of a line's content at a point in time.
export type LineValue = { line: string; timestamp: Date };

// A line within a revision: its content history at this position, plus a
// back-pointer to the index it held in the previous revision (DOES_NOT_EXIST_YET = born here).
export type LineEntry = { oldLineNum: number; values: LineValue[] };

// The source and destination of a rename (the two paths an mv connects).
export type RenameInfo = { from: Path; to: Path };

// The source and destination of a copy (the two paths a cp connects). Same shape
// as RenameInfo but a distinct concept: a copy duplicates, a rename moves.
export type CopyInfo = { from: Path; to: Path };

// A whole-file snapshot at a timestamp. kind records which evidence kind produced
// it; changeId identifies the source operation (derived from its tool_use id).
// rename is set only on a rename revision (its from/to paths); copy is set only
// on a copy (genesis) revision.
export type FileRevision = {
    kind: EventKind;
    changeId: Uuid;
    timestamp: Date;
    lines: LineEntry[];
    rename?: RenameInfo;
    copy?: CopyInfo;
    // Present when this revision could not be reconstructed: the replay of its event threw and
    // its lines are the previous revision's carried forward, not real content.
    unrecoverable?: { reason: string };
};

// One file's reconstructed history.
export type FileHistory = { target: Path; revisions: FileRevision[] };

// --- Events: one per piece of evidence ---------------------------------------

export type WriteEvent = {
    kind: EventKind.write;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

export type DeleteEvent = {
    kind: EventKind.delete;
    changeId: Uuid;
    target: Path;
    timestamp: Date;
};

// An in-place Edit; its structuredPatch hunks drive the line splice. `originalFile` is the literal
// pre-edit file content the Edit result reports (when present — a later scenario may omit it); it is the
// exact pre-edit disk, used to recover an out-of-hunk-window append the reconstructed base missed (s40).
export type EditEvent = {
    kind: EventKind.edit;
    changeId: Uuid;
    target: Path;
    hunks: StructuredPatchHunk[];
    originalFile?: string;
    timestamp: Date;
};

// A rename (Bash mv): the file's history continues at `to`, carrying its lines.
export type RenameEvent = {
    kind: EventKind.rename;
    changeId: Uuid;
    from: Path;
    to: Path;
    timestamp: Date;
};

// A copy (Bash cp): a NEW file whose genesis content is the source's content as
// of the copy. seedLines holds those source line texts; it is empty from
// extraction and filled during reconstruction (the cp result carries no
// content). The source file lives on as its own history — a copy is not a move.
export type CopyEvent = {
    kind: EventKind.copy;
    changeId: Uuid;
    from: Path;
    to: Path;
    seedLines: string[];
    timestamp: Date;
};

// A bash `>>` append: prior lines survive, the new tail is genesis. content is the
// file's full post-append text, recovered from the file-history sidecar (the redirect
// leaves no content in the JSONL); it is empty from extraction and filled during
// reconstruction. See plans/s5/s5-reconstruction-plan.md.
export type AppendEvent = {
    kind: EventKind.append;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

// A bash `>` overwrite: a wholesale full-content revision (S4 overwrite, produced by a
// redirect). content is recovered from the sidecar like AppendEvent.
export type OverwriteEvent = {
    kind: EventKind.overwrite;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

// A user's out-of-band edit to a file on disk (NOT an agent tool call): captured as an
// `edited_text_file` attachment whose snippet carries the full post-edit content. Modeled as a
// full-content revision (like an overwrite) but kept a distinct kind for honest provenance in the
// render. content is the snippet's text with its `<n>\t` line-number prefixes stripped. See
// plans/s15/s15-reconstruction-plan.md.
export type UserEditEvent = {
    kind: EventKind.userEdit;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

export type FileEvent =
    | WriteEvent
    | DeleteEvent
    | EditEvent
    | RenameEvent
    | CopyEvent
    | AppendEvent
    | OverwriteEvent
    | UserEditEvent
    | ScriptExecutionEvent;

// --- Reconstruction: the public API ------------------------------------------

// Reconstruct one file's history on the surviving branch: pre-select the surviving conversation
// branch (a no-op when the transcript has no rewind), then reconstruct over those records via the
// branch-agnostic core in reconstruction_branches.ts. Generic over the target.
export function reconstructFile(
    records: TranscriptRecord[],
    target: Path,
    reader?: BackupReader,
): FileRevision[] {
    return reconstructFileOver(selectLiveBranch(records), target, new Set<string>(), reader);
}

// Reconstruct every file the transcript touches on the surviving branch (pre-select, then
// reconstruct over those records — a no-op when there is no rewind).
export function reconstructAll(
    records: TranscriptRecord[],
    reader?: BackupReader,
): FileHistory[] {
    reportReconstructionProgress(`reconstructing surviving files across ${records.length} records`);
    return reconstructFilesOver(selectLiveBranch(records), reader);
}

// findDeletedTarget moved to reconstruction_branch.ts (task 163: engine at the 250-line cap).

// --- Branch-aware reconstruction: surviving + retrievable rewound branches -----

// One rewound branch's file changes: the histories of files it changed after its rewind point,
// tagged with where it forked (rewindPoint) and its tip (its identity, like a branch name).
export type RewoundBranchHistory = {
    rewindPoint: Uuid;
    tip: Uuid;
    histories: FileHistory[];
};

// The full branch-aware reconstruction: the surviving files plus every rewound branch's changes.
// survivingTip names the surviving branch's tip (its identity, for the branch listing / headers);
// it is undefined only for an unmarked transcript with no last-prompt head.
export type BranchedReconstruction = {
    survivingTip: Uuid | undefined;
    surviving: FileHistory[];
    rewound: RewoundBranchHistory[];
};

// Reconstruct the surviving files plus every rewound (unmerged) branch's changes, so a rewound
// branch's file history stays retrievable like `git log` on a branch that was never merged.
export function reconstructBranches(
    records: TranscriptRecord[],
    reader?: BackupReader,
): BranchedReconstruction {
    // task 191: cover the silent stretch after the sidecar-reader stage (the tip-scan events
    // below are counted, so stage-level --progress would otherwise show nothing here).
    reportReconstructionProgress(`finding conversation branches across ${records.length} records`);
    const branches = findConversationBranches(records);
    const survivingBranch = branches.find((branch) => branch.isSurviving);
    const surviving = reconstructAll(records, reader);
    const rewoundBranches = branches.filter((branch) => !branch.isSurviving);
    const rewoundHistories = rewoundBranches.map((branch, branchIndex) => {
        // task 163: announce each rewound branch's position — the per-target counters inside
        // reconstructFilesOver carry no branch-level motion. The `reconstructing ` prefix keeps
        // the webapp classifier in phase 4.
        reportReconstructionProgress("reconstructing rewound branch", branchIndex + 1, rewoundBranches.length);
        return buildRewoundBranchHistory(records, branch, reader);
    });
    const rewound = rewoundHistories.filter((entry): entry is RewoundBranchHistory => entry !== undefined);
    return { survivingTip: survivingBranch?.tip, surviving, rewound };
}

// Reconstruct one rewound branch, scoped to the files it changed after its rewind point. Returns
// undefined when the branch's diverging portion changed no file (a trivial tangent like a Read/ls).
function buildRewoundBranchHistory(
    records: TranscriptRecord[],
    branch: ConversationBranch,
    reader?: BackupReader,
): RewoundBranchHistory | undefined {
    const branchRecords = selectBranchRecords(records, branch.tip);
    const survivingUuids = collectSurvivingUuids(records);
    const divergingRecords = branchRecords.filter(
        (record) => record.uuid !== undefined && !survivingUuids.has(record.uuid.toString()),
    );
    const divergingIds = new Set(
        extractFileEvents(divergingRecords).map((event) => event.changeId.toString()),
    );
    if (divergingIds.size === 0) {
        return undefined;
    }
    const histories = reconstructFilesOver(branchRecords, reader).filter((history) =>
        history.revisions.some((revision) => divergingIds.has(revision.changeId.toString())),
    );
    return { rewindPoint: branch.rewindPoint!, tip: branch.tip, histories };
}

