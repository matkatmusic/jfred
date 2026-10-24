// Layer 1's two widget shapes (pair bubble, orphan bucket), split out of layer1-page.ts once it hit the 250-line cap.

import { el } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { buildNodesWithSameTimestampMarkers } from "./layer1-nodes-with-same-timestamp.ts";
import { WireEditKind, WireRewindKind, WireScriptExecutorKind, findRejoinWithOwnSlot, listTrunkLadderInstants, type WireBranch, type WireEdit, type WireOrphan, type WirePair, type WireScriptRun, type WireSnapshot } from "./layer1-wire.ts";
import { describeScriptLanguage } from "./layer1-script-language.ts";

// Height of the dashed elbow's curve; a branch rail starts below the fork elbow and stops above the rejoin elbow.
const BRANCH_ELBOW_PX = 16;

// Task 379 mockup: dot tooltip tail per rewind kind.
const BRANCH_NODE_NOTE = {
    [WireRewindKind.code]: "abandoned tip (code reverted, dead end)",
    [WireRewindKind.conversation]: "conversation rewound, code kept",
} as const satisfies Record<WireRewindKind, string>;

// User-locked 2026-07-25: a full 40-char hash is wider than a widget, so only the label is shortened.
const SHORT_HASH_LENGTH = 8;

export const CREATED_NODE_TITLE = "created-at is not the latest on-disk state — nothing to show";

// The only value JS contributes to layout; every placement rule lives in layer1-styles.css.
export function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

// The dot carries the title too: layer1-drawer.ts reads a commit's hash off the clicked dot.
function appendAxisNode(lane: HTMLElement, axisPx: number, instant: string, nodeClass: string, text: string, titleText?: string): void {
    lane.append(
        setAxisPx(el("i", { class: `node ${nodeClass}`, title: titleText, "data-instant": instant }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text, title: titleText, "data-instant": instant }), axisPx),
    );
}

// Task 315: identity on `data-` attrs (task 280), on both elements; `n-snap` on both is task 314's hide handle.
function appendSnapshotNode(lane: HTMLElement, axisPx: number, snapshot: WireSnapshot): void {
    const identity = {
        "data-instant": snapshot.instant,
        "data-version": String(snapshot.version),
        "data-session-id": snapshot.sessionId,
        "data-session-file": snapshot.sessionFile,
        "data-line": snapshot.line === undefined ? undefined : String(snapshot.line),
    };
    lane.append(
        setAxisPx(el("i", { class: "node n-snap", ...identity }), axisPx),
        setAxisPx(el("span", { class: "nlabel n-snap", text: `@v${snapshot.version} 📸`, ...identity }), axisPx),
    );
}

// Task 343: the dot class hides the node; confidence is a ring class, never a fill swap.
function appendEditNode(lane: HTMLElement, axisPx: number, edit: WireEdit, isMoved: boolean): void {
    const isRead = edit.kind === WireEditKind.read;
    // Task 357: a trunk edit that a branch lane also holds hides while the branch kind is shown.
    const kindClass = `${isRead ? "n-read" : "n-edit"}${isMoved ? " n-moved" : ""}`;
    const identity = {
        title: edit.confidence,
        "data-change-id": edit.changeId,
        "data-kind": edit.kind,
        "data-confidence": edit.confidence,
        "data-instant": edit.instant,
        "data-session-id": edit.sessionId,
        "data-session-file": edit.sessionFile,
        "data-line": edit.line === undefined ? undefined : String(edit.line),
    };
    lane.append(
        setAxisPx(el("i", { class: `node ${kindClass} conf-${edit.confidence}`, ...identity }), axisPx),
        setAxisPx(el("span", { class: `nlabel ${kindClass}`, text: isRead ? "[R]✓" : "[e]", ...identity }), axisPx),
    );
}

// Task 356: dot and label share the identity attrs; a bash run is never provable, so its ring is dashed.
function appendScriptRunNode(lane: HTMLElement, axisPx: number, run: WireScriptRun): void {
    const isBash = run.executorKind === WireScriptExecutorKind.bash;
    const identity = {
        title: run.label ?? describeScriptLanguage(run.language),
        "data-tool-use-id": run.toolUseId,
        "data-executor-kind": run.executorKind,
        "data-instant": run.instant,
        "data-session-id": run.sessionId,
        "data-session-file": run.sessionFile,
    };
    const iconText = describeScriptLanguage(run.language);
    lane.append(
        setAxisPx(el("i", { class: `node n-script${isBash ? " never-provable" : ""}`, ...identity }), axisPx),
        setAxisPx(el("span", { class: "nlabel n-script", text: run.label ?? iconText, ...identity }), axisPx),
    );
}

// Task 379 mockup, replaced by the layout's own fork and rejoin offsets (task 357): it threw when a fork matched no trunk node.
// function findTrunkAxisPx(trunkNodes: WireInstant[], instant: string): number {
//     const trunkNode = trunkNodes.find((candidate) => candidate.instant === instant);
//     if (trunkNode === undefined) {
//         throw new Error(`branch instant ${instant} matches no trunk node`);
//     }
//     return trunkNode.axisPx;
// }

// Task 357: bnode/blabel, never node/nlabel, so the drawer and the trunk node checks ignore branch dots; keptToEnd merges into the rail end.
function appendBranchLane(lane: HTMLElement, branch: WireBranch, laneIndex: number, railEndPx: number, startPx: number): void {
    const forkPx = branch.forkAt.axisPx - startPx;
    const rejoinPx = branch.rejoinAt === undefined ? (branch.keptToEnd === true ? railEndPx - startPx : undefined) : branch.rejoinAt.axisPx - startPx;
    const railFromPx = forkPx + BRANCH_ELBOW_PX;
    const railToPx = rejoinPx === undefined ? Math.max(...branch.nodes.map((node) => node.axisPx - startPx)) : rejoinPx - BRANCH_ELBOW_PX;
    const branchLane = el("div", { class: "blane" });
    branchLane.style.setProperty("--lane-index", String(laneIndex));
    const rail = setAxisPx(el("div", { class: "brail" }), railFromPx);
    rail.style.setProperty("--span-px", String(railToPx - railFromPx));
    branchLane.append(setAxisPx(el("div", { class: "split-elbow" }), forkPx), rail);
    if (rejoinPx !== undefined) {
        branchLane.append(setAxisPx(el("div", { class: "merge-elbow" }), rejoinPx));
    }
    for (const node of branch.nodes) {
        const identity = { title: `${node.label}: ${BRANCH_NODE_NOTE[branch.rewindKind]}`, "data-instant": node.instant };
        branchLane.append(
            setAxisPx(el("i", { class: "bnode", ...identity }), node.axisPx - startPx),
            setAxisPx(el("span", { class: "blabel", text: node.label, ...identity }), node.axisPx - startPx),
        );
    }
    lane.append(branchLane);
}

function buildPairWidget(pair: WirePair): HTMLElement {
    // Snapshots, edits and script runs go last, as the server orders the ladder, so same-timestamp runs and the span stay right.
    const snapshots = pair.snapshots ?? [];
    const edits = pair.edits ?? [];
    const scriptRuns = pair.scriptRuns ?? [];
    // Spans earliest to latest of any kind: a pre-commit mtime gave a negative offset over the header.
    const trunk = [...(pair.created === undefined ? [] : [pair.created]), ...pair.commits, pair.onDisk, ...snapshots, ...edits, ...scriptRuns];
    // Task 357: a lane's fork, nodes and own-slot rejoin take ladder rows too, so the span and the tie markers see them.
    const branches = pair.branches ?? [];
    const trunkInstants = listTrunkLadderInstants(pair);
    const laneNodes = branches.flatMap((branch, index) => {
        const ownSlotRejoin = findRejoinWithOwnSlot(trunkInstants, branch);
        return [branch.forkAt, ...branch.nodes, ...(ownSlotRejoin === undefined ? [] : [ownSlotRejoin])].map((node) => ({ ...node, laneIndex: index + 1 }));
    });
    const ladder = [...trunk, ...laneNodes];
    const nodePx = ladder.map((node) => node.axisPx);
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    // Task 259's markers go in before the nodes; with no z-index, DOM order keeps the rectangle behind the dots.
    lane.append(el("div", { class: "lrail" }), ...buildNodesWithSameTimestampMarkers(ladder, startPx));
    if (pair.created !== undefined) {
        appendAxisNode(lane, pair.created.axisPx - startPx, pair.created.instant, "n-disk n-created", "created at", CREATED_NODE_TITLE);
    }
    for (const commit of pair.commits) {
        appendAxisNode(lane, commit.axisPx - startPx, commit.instant, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
    }
    appendAxisNode(lane, pair.onDisk.axisPx - startPx, pair.onDisk.instant, "n-disk", "on disk");
    for (const snapshot of snapshots) {
        appendSnapshotNode(lane, snapshot.axisPx - startPx, snapshot);
    }
    const laneChangeIds = new Set(branches.flatMap((branch) => branch.nodes.map((node) => node.changeId)));
    for (const edit of edits) {
        appendEditNode(lane, edit.axisPx - startPx, edit, laneChangeIds.has(edit.changeId));
    }
    for (const run of scriptRuns) {
        appendScriptRunNode(lane, run.axisPx - startPx, run);
    }
    const railEndPx = Math.max(...nodePx);
    branches.forEach((branch, index) => appendBranchLane(lane, branch, index + 1, railEndPx, startPx));
    const filebox = setAxisPx(el("div", { class: "filebox" }, [
        // Task 280: full path lives on `data-path` — the find box and File Nav jump read it as identity.
        el("div", { class: "fname", text: pair.path.split("/").pop() ?? pair.path, "data-path": pair.path }),
        el("div", { class: "sub", text: `${pair.commits.length} commits · on disk` }),
        lane,
    ]), startPx);
    filebox.style.setProperty("--lane-count", String(branches.length));
    return filebox;
}

// `title`/`rows` come from one caller so direction is never inferred from contents; rows arrive sorted ascending, rows[0] is earliest.
export function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
    const earliest = rows[0];
    if (earliest === undefined) {
        return undefined;
    }
    // Task 266: rows carry the same `--axis-px` a `.node` does, so ruler clicks find bucket rows too.
    const list = el("ul", {}, rows.map((row) => setAxisPx(el("li", {}, [
        el("span", { text: row.path }),
        el("em", { text: formatInstantLabel(row.instant) }),
    ]), row.axisPx - earliest.axisPx)));
    return setAxisPx(el("div", { class: "filebox bucket" }, [
        el("div", { class: "fname", text: title }),
        el("div", { class: "sub", text: `${rows.length} files` }),
        list,
    ]), earliest.axisPx);
}

// The pair widgets, or the S18 empty-state message when the two roots share no path at all.
export function buildStagePairs(pairs: WirePair[]): HTMLElement[] {
    if (pairs.length === 0) {
        return [el("div", { class: "nopairs", text: "No git ↔ on-disk pairs." })];
    }
    return pairs.map(buildPairWidget);
}
