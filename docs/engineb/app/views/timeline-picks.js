// Pick-selection logic for the revision timeline (split from timeline.ts, task 92): which rows
// are pickable, segment membership, pick legality, and the selection bar's range summary.
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "./timeline-types.js";
// Only an agent turn that owns surviving snapshots can be picked — user prompts, session ends,
// snapshot-less replies, and orphaned turns all sit in no segment.
export function checkNodeIsPickable(node) {
    if (node.kind !== AGENT_TURN_NODE_KIND) {
        return false;
    }
    if (node.isOrphaned) {
        return false;
    }
    return node.snapshots.length > 0;
}
// One pick-segment id per node: commit nodes end their segment (hard stops) and, like every
// unpickable node, belong to none (null). Picks are only legal inside a single segment.
export function computePickSegments(nodes) {
    const segments = [];
    let segment = 0;
    for (const node of nodes) {
        if (node.kind === COMMIT_NODE_KIND) {
            segments.push(null);
            segment += 1;
            continue;
        }
        if (checkNodeIsPickable(node)) {
            segments.push(segment);
            continue;
        }
        segments.push(null);
    }
    return segments;
}
// A pick is legal when empty, or when every picked node shares ONE segment and the picked set is
// exactly the pickable nodes between its min and max index (orphans inside the span are skipped,
// not gaps; a commit inside the span always splits the segment, so it can never be crossed).
export function checkPickIsLegal(nodes, pickedNodeIndexes) {
    if (pickedNodeIndexes.length === 0) {
        return true;
    }
    const segments = computePickSegments(nodes);
    const pickedSegments = new Set(pickedNodeIndexes.map((index) => segments[index]));
    if (pickedSegments.size > 1) {
        return false;
    }
    const [segment] = pickedSegments;
    if (segment === null) {
        return false;
    }
    if (segment === undefined) {
        return false;
    }
    const min = Math.min(...pickedNodeIndexes);
    const max = Math.max(...pickedNodeIndexes);
    const picked = new Set(pickedNodeIndexes);
    for (let index = min; index <= max; index += 1) {
        if (segments[index] !== segment) {
            continue;
        }
        if (!picked.has(index)) {
            return false;
        }
    }
    return true;
}
// The selection bar's summary: picked turn count, DISTINCT file paths across the picked nodes,
// and the 1-based SNAPSHOT index range for the /api/range-patch call (the server still speaks
// snapshot indexes; a turn spans every snapshot it owns).
export function computeRangeSummary(nodes, pickedNodeIndexes) {
    const pickedNodes = pickedNodeIndexes.map((index) => nodes[index]);
    const filePaths = [...new Set(pickedNodes.flatMap((node) => node.fileChanges.map((change) => change.path)))];
    const stepIndexes = pickedNodes.flatMap((node) => node.snapshots.map((snapshot) => snapshot.index));
    return {
        stepCount: pickedNodes.length,
        filePaths,
        fromStepIndex: Math.min(...stepIndexes),
        toStepIndex: Math.max(...stepIndexes),
    };
}
// A click that ends with a non-collapsed text selection is a selection drag, not a close
// request — the background-close handler must ignore it (item 10b). Browsers may return
// null from window.getSelection(); that never blocks.
export function checkSelectionBlocksBackgroundClose(selection) {
    if (selection === null) {
        return false;
    }
    return selection.isCollapsed === false;
}
