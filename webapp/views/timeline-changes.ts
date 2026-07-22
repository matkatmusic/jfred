// File-change derivation for the revision timeline (split from timeline.ts, task 92): resolving
// step changeIds through the revision index into displayable chips, plus patch splitting and the
// per-node chip stamping pass.

import { routeToFileHistory } from "../app-routes.ts";
import { checkChangeIdIsBackupBlobName, findRevisionForChangeId } from "./file-history-model.ts";
import {
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

// The commit hash inside gitBase:<hash>:<target> — the second colon-separated field (hashes
// never contain colons); "" for a malformed id, never a throw. (Moved from details-model.ts,
// task 121 — the gitBase vocabulary's canonical home.)
export function extractGitBaseCommitHash(changeId: string): string {
    return changeId.split(":")[1] ?? "";
}

// The baseline node's message text, naming the base commit the beacon changeId carries.
export function computeGitBaselineText(snapshot: WireStepSnapshot): string {
    return `Files seeded from git base commit ${extractGitBaseCommitHash(snapshot.changeIds[0]!)}`;
}

// Entry-time path per revision (task 127): walk backward from the final target, stepping each
// rename's `from` across it, so revisions before a rename display the name the file had at
// that time.
function computeEntryTimePaths(history: WireFileHistory): string[] {
    const entryTimePaths = new Array<string>(history.revisions.length);
    let currentPath = history.target;
    for (let index = history.revisions.length - 1; index >= 0; index -= 1) {
        entryTimePaths[index] = currentPath;
        const rename = history.revisions[index]!.rename;
        if (rename !== undefined) {
            currentPath = rename.from;
        }
    }
    return entryTimePaths;
}

// changeId -> { path, eventKind, renamedFrom, isRewound } across surviving AND rewound histories,
// so a step's changeIds resolve to displayable file chips and orphan detection in one lookup.
// Surviving histories are indexed first and win duplicates (a changeId present in both branches
// counts as surviving).
function recordHistoryRevisions(index: RevisionIndex, history: WireFileHistory, isRewound: boolean): void {
    const entryTimePaths = computeEntryTimePaths(history);
    history.revisions.forEach((revision, position) => {
        if (index.has(revision.changeId)) {
            return;
        }
        index.set(revision.changeId, {
            path: revision.rename !== undefined ? revision.rename.to : history.target,
            displayPath: entryTimePaths[position]!,
            eventKind: revision.kind,
            renamedFrom: revision.rename !== undefined ? revision.rename.from : undefined,
            isFirstRevision: position === 0,
            isRewound,
        });
    });
}

export function indexRevisionsByChangeId(document: WireTimelineDocument): RevisionIndex {
    const index: RevisionIndex = new Map();
    const addHistories = (histories: WireFileHistory[], isRewound: boolean): void => {
        for (const history of histories) {
            recordHistoryRevisions(index, history, isRewound);
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
            displayPath: revision.displayPath,
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
        changes.push({ path, displayPath: path, eventKind: EDIT_EVENT_KIND, renamedFrom: undefined, isFirstRevision: false, changeId: undefined, when: step.when });
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

// old (pre engine-stamped isOrphaned): checkStepIsOrphaned, the per-step snapshot proxy —
// retired; preserved in archive/timeline-changes-retired-orphan-proxies.ts (task 121).

// Split a multi-file range patch on its `diff --git ` headers into per-file blocks, each keyed by
// its patch-relative b/ path (the range-diff inspector shows one file's block at a time).
function startNextPatchBlock(line: string, current: { path: string; lines: string[] } | null, blocks: { path: string; lines: string[] }[]): { path: string; lines: string[] } {
    if (current !== null) {
        blocks.push(current);
    }
    return { path: line.slice(line.lastIndexOf(" b/") + 3), lines: [line] };
}

export function splitPatchByFile(patchText: string): { path: string; block: string }[] {
    const blocks: { path: string; lines: string[] }[] = [];
    let current: { path: string; lines: string[] } | null = null;
    for (const line of patchText.split("\n")) {
        if (line.startsWith("diff --git ")) {
            current = startNextPatchBlock(line, current, blocks);
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

// task 133: the merge dedupe key. Two snapshots on one turn may hold DISTINCT revisions of
// the same file (baseline-demo: an external user-edit then an agent Edit) — each keeps its
// chip; only a repeat of the SAME revision collapses. Fallback chips (no changeId) still
// collapse per path.
function computeMergedChipKey(change: FileChange): string {
    return `${change.path}|${change.changeId ?? ""}`;
}

// A turn's file chips: deriveFileChanges merged over its snapshots, deduped by path+changeId
// (task 133; deriveFileChanges keeps its own within-step path dedupe — rename-pair collapse
// lives there).
function mergeSnapshotFileChanges(snapshot: WireStepSnapshot, revisionIndex: RevisionIndex, seenChipKeys: Set<string>, changes: FileChange[]): void {
    for (const change of deriveFileChanges(snapshot, revisionIndex)) {
        if (seenChipKeys.has(computeMergedChipKey(change))) {
            continue;
        }
        seenChipKeys.add(computeMergedChipKey(change));
        changes.push(change);
    }
}

function deriveMergedFileChanges(snapshots: WireStepSnapshot[], revisionIndex: RevisionIndex): FileChange[] {
    const changes: FileChange[] = [];
    const seenChipKeys = new Set<string>();
    for (const snapshot of snapshots) {
        mergeSnapshotFileChanges(snapshot, revisionIndex, seenChipKeys, changes);
    }
    return changes;
}

// old (pre engine-stamped isOrphaned): checkTurnIsOrphaned, the snapshot-proxy orphan check —
// retired; preserved in archive/timeline-changes-retired-orphan-proxies.ts (task 121).

// fileChanges on every snapshot-owning node (user turns and session ends own empty snapshot
// lists, so they resolve to no chips). Tool-call nodes never own snapshots; plain commit rows
// own none either — but the merged baseline commit row does, and gets its chips (task 121).
export function deriveNodeFileChanges(nodes: TimelineNode[], revisionIndex: RevisionIndex): void {
    for (const node of nodes) {
        if (node.kind === TOOL_CALL_NODE_KIND) {
            continue;
        }
        if (node.snapshots === undefined) {
            continue;
        }
        node.fileChanges = deriveMergedFileChanges(node.snapshots, revisionIndex);
        // old: isOrphaned was a snapshot proxy (all snapshots on a rewound branch) — it could
        // never flag user/tool rows. The engine now stamps per-record branch membership on the
        // wire (message.isOrphaned / toolCall.isOrphaned), copied at node construction.
        // node.isOrphaned = checkTurnIsOrphaned(node.snapshots, revisionIndex);
    }
}
