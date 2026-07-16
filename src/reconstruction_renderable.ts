// All-files reconstruction and renderable-event filtering, split out of
// reconstruction_branches.ts to keep both files within the 250-line cap — split, never condense.
// `reconstructFilesOver` is the branch-agnostic all-files core; the accepted-user-edit set and the
// renderable filters let every view agree on which user edits actually changed a file.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { findConversationBranches, selectBranchRecords } from "./reconstruction_branch.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { discoverScriptCreatedPaths } from "./reconstruction_script_runs.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import {
    buildRenameChain,
    distinctFinalPaths,
    resolveFinalPath,
} from "./reconstruction_lineage.ts";
import { getLineageContentBefore, reconstructFileOver } from "./reconstruction_branches.ts";
import type { FileEvent, FileHistory } from "./reconstruction_engine.ts";

// The branch-agnostic core: reconstruct every file touched by EXACTLY the records given (no branch
// selection here) — each with its own history, keyed by the path it ends life at (a renamed file is
// one history, not two).
export function reconstructFilesOver(
    records: TranscriptRecord[],
    reader?: BackupReader,
): FileHistory[] {
    const events = extractFileEvents(records);
    const renameChain = buildRenameChain(events);
    const targets = distinctFinalPaths(events, renameChain);
    if (reader) {
        // Script-born files (an out.txt, a shutil.move destination) leave no Write/Edit event, so
        // they only become targets through the runs that created them.
        const known = new Set(targets.map((target) => target.toString()));
        for (const path of discoverScriptCreatedPaths(records, reader, getLineageContentBefore(records, reader))) {
            const finalPath = resolveFinalPath(path, renameChain);
            if (known.has(finalPath.toString())) continue;
            known.add(finalPath.toString());
            targets.push(finalPath);
        }
    }
    return targets.map((target, index) => {
        reportReconstructionProgress(`reconstructing ${target}`, index + 1, targets.length);
        return {
            target,
            revisions: reconstructFileOver(records, target, new Set<string>(), reader),
        };
    });
}

// The changeIds of every user edit that ACTUALLY changed a file, across all conversation branches. A
// user edit's revision survives replay only when its snapshot differs from the file's current content
// (reconstruction_replay.userEditChangesContent), so a redundant disk-echo snapshot — the IDE echoes an
// `edited_text_file` whenever a file is written or read — leaves no revision and is absent here. The
// graph views consult this to drop echo turns while keeping genuine user-edit turns, so every view
// agrees on which user edits are real changes. Branch-aware: a snapshot is judged against ITS OWN
// branch's content (s13's echo matches the read branch's restored content, not the cross-branch mix).
export function collectAcceptedUserEditIds(
    records: TranscriptRecord[],
    reader?: BackupReader,
): Set<string> {
    const accepted = new Set<string>();
    for (const branch of findConversationBranches(records)) {
        const branchRecords = selectBranchRecords(records, branch.tip);
        addBranchUserEditIds(reconstructFilesOver(branchRecords, reader), accepted);
    }
    return accepted;
}

// The changeIds of the surviving user-edit revisions in one branch's reconstructed histories.
function userEditIdsOf(history: FileHistory): string[] {
    const userEditRevisions = history.revisions.filter((revision) => revision.kind === EventKind.userEdit);
    const changeIds = userEditRevisions.map((revision) => revision.changeId.toString());
    return changeIds;
}

// Add every branch history's surviving user-edit changeId into the accumulating accepted set.
function addBranchUserEditIds(histories: FileHistory[], accepted: Set<string>): void {
    for (const id of histories.flatMap(userEditIdsOf)) {
        accepted.add(id);
    }
}

// Whether a file event should appear in a rendered view: every non-user-edit event always does; a
// user-edit event does only when it actually changed content (its changeId is in the accepted set).
export function isRenderableEvent(event: FileEvent, accepted: Set<string>): boolean {
    if (event.kind !== EventKind.userEdit) {
        return true;
    }
    return accepted.has(event.changeId.toString());
}

// The transcript's file events filtered to those a view should render: drops redundant disk-echo user
// edits (an `edited_text_file` snapshot that changed nothing). `accepted` comes from
// collectAcceptedUserEditIds; pass undefined to keep every event (an unfiltered letter pass).
export function extractRenderableEvents(
    records: TranscriptRecord[],
    accepted?: Set<string>,
): FileEvent[] {
    const events = extractFileEvents(records);
    if (accepted === undefined) {
        return events;
    }
    return events.filter((event) => isRenderableEvent(event, accepted));
}
