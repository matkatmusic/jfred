// File-change derivation for the revision timeline (split from timeline.ts, task 92): resolving
// step changeIds through the revision index into displayable chips, plus patch splitting and the
// per-node chip stamping pass.

import { routeToFileHistory } from "../app-routes.ts";
import { checkChangeIdIsBackupBlobName, findRevisionForChangeId } from "./file-history-model.ts";
import {
    COMMIT_NODE_KIND,
    EDIT_EVENT_KIND,
    TOOL_CALL_NODE_KIND,
    type FileChange,
    type RevisionIndex,
    type TimelineNode,
    type WireFileHistory,
    type WireStepSnapshot,
    type WireTimelineDocument,
} from "./timeline-types.ts";

// Wire-string mirror of BASE_COMMIT_CHANGE_ID_PREFIX (src/reconstruction_base_commit.ts) — a
// changeId with this prefix is a base-commit baseline beacon, evidenced by no session's record.
export const GIT_BASE_CHANGE_ID_PREFIX = "gitBase:";

// Wire-string mirror of SCRIPT_RUN_CHANGE_ID_PREFIX (src/reconstruction_script_execution.ts) —
// a `scriptRun:<tool_use id>:<target>` changeId marks a synthetic script-execution revision
// (task 67: the Details pane joins a run's changed files to these revisions).
export const SCRIPT_RUN_CHANGE_ID_PREFIX = "scriptRun:";

// True when every changeId on the step is a base-commit beacon (task 86): the step carries the
// repo's pre-session state, evidenced by no session's record.
export function checkSnapshotIsGitBaseline(snapshot: WireStepSnapshot): boolean {
    if (snapshot.changeIds.length === 0) {
        return false;
    }
    return snapshot.changeIds.every((changeId) => changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX));
}

// The baseline node's message text: the beacon changeId is gitBase:<hash>:<target>, so the
// commit hash is the second colon-separated field (hashes never contain colons).
export function computeGitBaselineText(snapshot: WireStepSnapshot): string {
    const commitHash = snapshot.changeIds[0]!.split(":")[1] ?? "";
    return `Files seeded from git base commit ${commitHash}`;
}

// changeId -> { path, eventKind, renamedFrom, isRewound } across surviving AND rewound histories,
// so a step's changeIds resolve to displayable file chips and orphan detection in one lookup.
// Surviving histories are indexed first and win duplicates (a changeId present in both branches
// counts as surviving).
export function indexRevisionsByChangeId(document: WireTimelineDocument): RevisionIndex {
    const index: RevisionIndex = new Map();
    const addHistories = (histories: WireFileHistory[], isRewound: boolean): void => {
        for (const history of histories) {
            history.revisions.forEach((revision, position) => {
                if (index.has(revision.changeId)) {
                    return;
                }
                index.set(revision.changeId, {
                    path: revision.rename !== undefined ? revision.rename.to : history.target,
                    eventKind: revision.kind,
                    renamedFrom: revision.rename !== undefined ? revision.rename.from : undefined,
                    isFirstRevision: position === 0,
                    isRewound,
                });
            });
        }
    };
    addHistories(document.filesTouched, false);
    addHistories(document.rewoundFilesTouched, true);
    return index;
}

// A step's displayable file chips: each changeId resolved through the revision index, deduped by
// path; changeIds that resolve nowhere fall back to the step's changedPaths hint (kind: edit).
export function deriveFileChanges(step: WireStepSnapshot, revisionIndex: RevisionIndex): FileChange[] {
    const changes: FileChange[] = [];
    const seenPaths = new Set();
    for (const changeId of step.changeIds) {
        const revision = revisionIndex.get(changeId);
        if (revision === undefined) {
            continue;
        }
        if (seenPaths.has(revision.path)) {
            continue;
        }
        seenPaths.add(revision.path);
        changes.push({
            path: revision.path,
            eventKind: revision.eventKind,
            renamedFrom: revision.renamedFrom,
            isFirstRevision: revision.isFirstRevision,
            changeId,
            when: step.when,
        });
    }
    for (const path of step.changedPaths) {
        if (seenPaths.has(path)) {
            continue;
        }
        seenPaths.add(path);
        changes.push({ path, eventKind: EDIT_EVENT_KIND, renamedFrom: undefined, isFirstRevision: false, changeId: undefined, when: step.when });
    }
    return changes;
}

// The file route a chip's revision jumps to ("#/project/<p>/file/<path>/rev/<n>", which lands
// in THE Revision View since task 93),
// or undefined when the change carries no changeId, the changeId is not a backup blob name
// (task 94: only revisions actually backed by a File History Snapshot get the 📷 button —
// tool-evidenced `toolu_…` ids resolve to revisions too, but have no snapshot), or it resolves
// to no surviving revision number (re-stamped synthetic ids, blob names without an anchored
// revision) — those chips get no jump button rather than a dead link.
export function computeSnapshotJumpRoute(project: string, filesTouched: WireFileHistory[], change: { path: string; changeId?: string }): string | undefined {
    if (change.changeId === undefined) {
        return undefined;
    }
    if (!checkChangeIdIsBackupBlobName(change.changeId)) {
        return undefined;
    }
    const revisionLink = findRevisionForChangeId(filesTouched, change.changeId, undefined);
    if (revisionLink === undefined) {
        return undefined;
    }
    if (revisionLink.revisionNumber === undefined) {
        return undefined;
    }
    return `${routeToFileHistory(project, revisionLink.target)}/rev/${revisionLink.revisionNumber}`;
}

// old (pre engine-stamped isOrphaned): the per-step snapshot proxy — a step counted orphaned
// when its changeIds resolved only to rewound-branch revisions. Retired: the engine now stamps
// branch membership per record on the wire (message.isOrphaned / toolCall.isOrphaned).
// // A step is orphaned when at least one of its changeIds matches a rewound-branch revision and
// // none matches a surviving one — those are the dimmed, unpickable rows.
// export function checkStepIsOrphaned(step: WireStepSnapshot, revisionIndex: RevisionIndex): boolean {
//     let matchesRewound = false;
//     for (const changeId of step.changeIds) {
//         const revision = revisionIndex.get(changeId);
//         if (revision === undefined) {
//             continue;
//         }
//         if (!revision.isRewound) {
//             return false;
//         }
//         matchesRewound = true;
//     }
//     return matchesRewound;
// }

// Split a multi-file range patch on its `diff --git ` headers into per-file blocks, each keyed by
// its patch-relative b/ path (the range-diff inspector shows one file's block at a time).
export function splitPatchByFile(patchText: string): { path: string; block: string }[] {
    const blocks: { path: string; lines: string[] }[] = [];
    let current: { path: string; lines: string[] } | null = null;
    for (const line of patchText.split("\n")) {
        if (line.startsWith("diff --git ")) {
            if (current !== null) {
                blocks.push(current);
            }
            current = { path: line.slice(line.lastIndexOf(" b/") + 3), lines: [line] };
            continue;
        }
        if (current !== null) {
            current.lines.push(line);
        }
    }
    if (current !== null) {
        blocks.push(current);
    }
    return blocks.map((entry) => ({ path: entry.path, block: entry.lines.join("\n") }));
}

// A turn's file chips: deriveFileChanges merged over its snapshots, deduped by path (first kind
// wins, matching deriveFileChanges' own seenPaths convention).
function deriveMergedFileChanges(snapshots: WireStepSnapshot[], revisionIndex: RevisionIndex): FileChange[] {
    const changes: FileChange[] = [];
    const seenPaths = new Set();
    for (const snapshot of snapshots) {
        for (const change of deriveFileChanges(snapshot, revisionIndex)) {
            if (seenPaths.has(change.path)) {
                continue;
            }
            seenPaths.add(change.path);
            changes.push(change);
        }
    }
    return changes;
}

// old (pre engine-stamped isOrphaned): the snapshot-proxy orphan check — retired alongside
// checkStepIsOrphaned; node.isOrphaned now copies the engine's per-record wire stamp.
// // Orphaned when the turn owns snapshots and EVERY one sits on a rewound branch; a turn with any
// // surviving snapshot — or none at all — stays on the spine.
// function checkTurnIsOrphaned(snapshots: WireStepSnapshot[], revisionIndex: RevisionIndex): boolean {
//     if (snapshots.length === 0) {
//         return false;
//     }
//     return snapshots.every((snapshot) => checkStepIsOrphaned(snapshot, revisionIndex));
// }

// fileChanges + isOrphaned on every turn/session-end node (user turns and session ends own no
// snapshots, so they resolve to no chips and never orphaned); commit and tool-call nodes carry
// no snapshots at all and are skipped.
export function deriveNodeFileChanges(nodes: TimelineNode[], revisionIndex: RevisionIndex): void {
    for (const node of nodes) {
        if (node.kind === COMMIT_NODE_KIND) {
            continue;
        }
        if (node.kind === TOOL_CALL_NODE_KIND) {
            continue;
        }
        node.fileChanges = deriveMergedFileChanges(node.snapshots, revisionIndex);
        // old: isOrphaned was a snapshot proxy (all snapshots on a rewound branch) — it could
        // never flag user/tool rows. The engine now stamps per-record branch membership on the
        // wire (message.isOrphaned / toolCall.isOrphaned), copied at node construction.
        // node.isOrphaned = checkTurnIsOrphaned(node.snapshots, revisionIndex);
    }
}
