// Core reconstruction model: transcript records to per-file revision history.

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

// oldLineNum back-points to the previous revision; DOES_NOT_EXIST_YET = born here.
export type LineEntry = { oldLineNum: number; values: LineValue[] };

// The source and destination of a rename (the two paths an mv connects).
export type RenameInfo = { from: Path; to: Path };

// Like RenameInfo but a copy duplicates; a rename moves.
export type CopyInfo = { from: Path; to: Path };

// Whole-file snapshot; rename/copy fields set only on those revision kinds.
export type FileRevision = {
    kind: EventKind;
    changeId: Uuid;
    timestamp: Date;
    lines: LineEntry[];
    rename?: RenameInfo;
    copy?: CopyInfo;
    // Set when replay threw; lines are carried forward from the previous revision.
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

// originalFile is the pre-edit disk content, used to recover out-of-hunk-window appends (s40).
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

// seedLines: empty from extraction, filled during reconstruction from the source file.
export type CopyEvent = {
    kind: EventKind.copy;
    changeId: Uuid;
    from: Path;
    to: Path;
    seedLines: string[];
    timestamp: Date;
};

// content: full post-append text from sidecar; empty from extraction, filled during replay.
export type AppendEvent = {
    kind: EventKind.append;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

// Bash `>` redirect; content recovered from sidecar like AppendEvent.
export type OverwriteEvent = {
    kind: EventKind.overwrite;
    changeId: Uuid;
    target: Path;
    content: string;
    timestamp: Date;
};

// Out-of-band disk edit from `edited_text_file` attachment; distinct kind preserves provenance.
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

// Pre-selects the surviving branch, then delegates to reconstructFileOver.
export function reconstructFile(
    records: TranscriptRecord[],
    target: Path,
    reader?: BackupReader,
): FileRevision[] {
    return reconstructFileOver(selectLiveBranch(records), target, new Set<string>(), reader);
}

// Pre-selects the surviving branch, then reconstructs all files.
export function reconstructAll(
    records: TranscriptRecord[],
    reader?: BackupReader,
): FileHistory[] {
    reportReconstructionProgress(`reconstructing surviving files across ${records.length} records`);
    return reconstructFilesOver(selectLiveBranch(records), reader);
}

// findDeletedTarget moved to reconstruction_branch.ts (task 163: engine at the 250-line cap).

// --- Branch-aware reconstruction: surviving + retrievable rewound branches -----

// Files changed after a rewind point on a single rewound branch.
export type RewoundBranchHistory = {
    rewindPoint: Uuid;
    tip: Uuid;
    histories: FileHistory[];
};

// Branch-aware result: surviving files plus rewound branches.
export type BranchedReconstruction = {
    survivingTip: Uuid | undefined;
    surviving: FileHistory[];
    rewound: RewoundBranchHistory[];
};

// Surviving files plus every unmerged rewound branch's file changes.
export function reconstructBranches(
    records: TranscriptRecord[],
    reader?: BackupReader,
): BranchedReconstruction {
    // task 191: emit progress here so --progress doesn't go silent between sidecar and tip-scan.
    reportReconstructionProgress(`finding conversation branches across ${records.length} records`);
    const branches = findConversationBranches(records);
    const survivingBranch = branches.find((branch) => branch.isSurviving);
    const surviving = reconstructAll(records, reader);
    const rewoundBranches = branches.filter((branch) => !branch.isSurviving);
    const rewoundHistories = rewoundBranches.map((branch, branchIndex) => {
        // task 163: report branch-level progress; prefix must be "reconstructing " for webapp phase 4.
        reportReconstructionProgress("reconstructing rewound branch", branchIndex + 1, rewoundBranches.length);
        return buildRewoundBranchHistory(records, branch, reader);
    });
    const rewound = rewoundHistories.filter((entry): entry is RewoundBranchHistory => entry !== undefined);
    return { survivingTip: survivingBranch?.tip, surviving, rewound };
}

// Returns undefined when the branch's diverging portion changed no files.
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


