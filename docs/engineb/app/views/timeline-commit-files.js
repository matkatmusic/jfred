// A commit row's changed-file list and contributing-row highlight set (split from timeline.ts,
// task 92): the two-direction walk around a commit node, skipping baseline seeds and orphans.
import { GIT_BASE_CHANGE_ID_PREFIX } from "./timeline-changes.js";
import { COMMIT_NODE_KIND } from "./timeline-types.js";
// True when the chip is a base-commit baseline seed (tasks 86/87): baseline state is
// pre-session, never part of a commit's delta.
function checkChangeIsGitBaseline(change) {
    if (change.changeId === undefined) {
        return false;
    }
    return change.changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX);
}
// A commit's changed-file list (item 66, mockup logic): walk back from the commit to the
// previous commit EXCLUSIVE (or the timeline start), collecting every surviving row's file
// changes; each path is listed once, keeping the occurrence CLOSEST to the commit (its latest
// revision). Then walk FORWARD to the next commit EXCLUSIVE, absorbing only chips whose change
// instant is at-or-before the commit — pre-commit work whose owning reply bubble sorts after the
// commit row (task 87: the first commit otherwise shows "No files changed"). Baseline (gitBase)
// chips are never a commit's delta and are skipped in both directions.
// Feeds a forward-walk row's chips into the collector, skipping chips whose change instant is
// after the commit (task 87's at-or-before gate).
function collectChangesAtOrBeforeCommit(node, commitWhen, collectChange) {
    for (const change of node.fileChanges ?? []) {
        if (change.when > commitWhen) {
            continue;
        }
        collectChange(change);
    }
}
export function deriveCommitChangedFiles(nodes, commitIndex) {
    const commitWhen = nodes[commitIndex].when;
    const changes = [];
    const seenPaths = new Set();
    const collectChange = (change) => {
        if (checkChangeIsGitBaseline(change)) {
            return;
        }
        if (seenPaths.has(change.path)) {
            return;
        }
        seenPaths.add(change.path);
        changes.push(change);
    };
    for (let index = commitIndex - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.kind === COMMIT_NODE_KIND) {
            break;
        }
        if (node.isOrphaned === true) {
            continue;
        }
        for (const change of node.fileChanges ?? []) {
            collectChange(change);
        }
    }
    for (let index = commitIndex + 1; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.kind === COMMIT_NODE_KIND) {
            break;
        }
        if (node.isOrphaned === true) {
            continue;
        }
        collectChangesAtOrBeforeCommit(node, commitWhen, collectChange);
    }
    return changes;
}
// The rows a selected commit highlights (`.contrib`, item 66): the same two-direction walk as
// deriveCommitChangedFiles, including every surviving row whose qualifying file changes overlap
// the commit's changed paths. Indexes return ascending.
export function findContributingNodeIndexes(nodes, commitIndex) {
    const commitWhen = nodes[commitIndex].when;
    const changedPaths = new Set(deriveCommitChangedFiles(nodes, commitIndex).map((change) => change.path));
    // A chip contributes when it is not a baseline seed, happened at-or-before the commit (always
    // true for backward rows — owners sit at-or-after their snapshots), and touches a changed path.
    const checkChangeContributes = (change) => {
        if (checkChangeIsGitBaseline(change)) {
            return false;
        }
        if (change.when > commitWhen) {
            return false;
        }
        return changedPaths.has(change.path);
    };
    const indexes = [];
    for (let index = commitIndex - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.kind === COMMIT_NODE_KIND) {
            break;
        }
        if (node.isOrphaned === true) {
            continue;
        }
        if ((node.fileChanges ?? []).some(checkChangeContributes)) {
            indexes.push(index);
        }
    }
    indexes.reverse();
    for (let index = commitIndex + 1; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.kind === COMMIT_NODE_KIND) {
            break;
        }
        if (node.isOrphaned === true) {
            continue;
        }
        if ((node.fileChanges ?? []).some(checkChangeContributes)) {
            indexes.push(index);
        }
    }
    return indexes;
}
