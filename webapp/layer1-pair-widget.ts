// Layer 1's pair bubble (one file's git-vs-disk lane), split out of layer1-widgets.ts to stay under the line cap.

import { createElement } from "./app-dom.ts";
import { CreatedNotTrustedReason } from "./layer1-components/bubbles/layer1-created-reason.ts";
import { appendAxisNode, appendBranchLane, appendEditNode, appendScriptRunNode, appendSnapshotNode, setAxisPx } from "./layer1-components/bubbles/layer1-lane-nodes.ts";
import { appendToolNodes } from "./layer1-components/bubbles/layer1-tool-nodes.ts";
import { buildNodesWithSameTimestampMarkers, type NodeWithSameTimestamp } from "./layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts";
import type { WireBranch } from "./layer1-wire-branches.ts";
import type { WireEdit } from "./layer1-wire-edits.ts";
import { findRejoinWithOwnSlot, listTrunkLadderInstants } from "./layer1-wire-ladder.ts";
import type { WirePair } from "./layer1-wire.ts";

// User-locked 2026-07-25: a full 40-char hash is wider than a widget, so only the label is shortened.
const SHORT_HASH_LENGTH = 8;

export const CREATED_NODE_TITLE = "created-at is not the latest on-disk state — nothing to show";

const CREATED_NOT_TRUSTED_SENTENCE = {
  [CreatedNotTrustedReason.noBirthTime]: "No birth time is recorded for this file.",
  [CreatedNotTrustedReason.birthNotBeforeMtime]: "The birth time is not earlier than the last change time.",
  [CreatedNotTrustedReason.birthAfterFirstCommit]: "The birth time is later than the file's first commit.",
} as const satisfies Record<CreatedNotTrustedReason, string>;

// Task 357: a lane's fork, nodes and own-slot rejoin take ladder rows too.
function listLaneLadderNodes(branches: WireBranch[], trunkInstants: string[]): NodeWithSameTimestamp[] {
  const laneNodes: NodeWithSameTimestamp[] = [];
  for (const [index, branch] of branches.entries()) {
    const ownSlotRejoin = findRejoinWithOwnSlot(trunkInstants, branch);
    const branchNodes = [branch.forkAt, ...branch.nodes, ...(ownSlotRejoin === undefined ? [] : [ownSlotRejoin])];
    for (const node of branchNodes) {
      laneNodes.push({ ...node, laneIndex: index + 1 });
    }
  }
  return laneNodes;
}

// Snapshots, edits, script runs go last, matching server order; spans all kinds because pre-commit mtimes gave negative offsets.
function listPairLadder(pair: WirePair, branches: WireBranch[]): NodeWithSameTimestamp[] {
  const trunk = [...(pair.created === undefined ? [] : [pair.created]), ...pair.commits, pair.onDisk, ...(pair.snapshots ?? []), ...(pair.edits ?? []), ...(pair.scriptRuns ?? []), ...(pair.toolNodes ?? [])];
  return [...trunk, ...listLaneLadderNodes(branches, listTrunkLadderInstants(pair))];
}

function appendTrunkNodes(lane: HTMLElement, pair: WirePair, startPx: number): void {
  if (pair.created !== undefined) {
    appendAxisNode(lane, pair.created.axisPx - startPx, pair.created.instant, "n-disk n-created", "created at", CREATED_NODE_TITLE);
  }
  for (const commit of pair.commits) {
    appendAxisNode(lane, commit.axisPx - startPx, commit.instant, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
  }
  appendAxisNode(lane, pair.onDisk.axisPx - startPx, pair.onDisk.instant, "n-disk", "on disk");
  for (const snapshot of pair.snapshots ?? []) {
    appendSnapshotNode(lane, snapshot.axisPx - startPx, snapshot);
  }
}

function appendEditNodes(lane: HTMLElement, edits: WireEdit[], branches: WireBranch[], startPx: number): void {
  const laneChangeIds = new Set<string>();
  for (const branch of branches) {
    for (const node of branch.nodes) {
      laneChangeIds.add(node.changeId);
    }
  }
  for (const edit of edits) {
    appendEditNode(lane, edit.axisPx - startPx, edit, laneChangeIds.has(edit.changeId));
  }
}

function appendScriptRunAndToolNodes(lane: HTMLElement, pair: WirePair, startPx: number): void {
  for (const run of pair.scriptRuns ?? []) {
    appendScriptRunNode(lane, run.axisPx - startPx, run);
  }
  appendToolNodes(lane, pair.toolNodes ?? [], startPx);
}

function buildPairLane(pair: WirePair, ladder: NodeWithSameTimestamp[], startPx: number, railEndPx: number): HTMLElement {
  const branches = pair.branches ?? [];
  const lane = setAxisPx(createElement("div", { class: "lane" }), 0);
  lane.style.setProperty("--span-px", String(railEndPx - startPx));
  // Task 259's markers go in before the nodes; with no z-index, DOM order keeps the rectangle behind the dots.
  lane.append(createElement("div", { class: "lrail" }), ...buildNodesWithSameTimestampMarkers(ladder, startPx));
  appendTrunkNodes(lane, pair, startPx);
  appendEditNodes(lane, pair.edits ?? [], branches, startPx);
  appendScriptRunAndToolNodes(lane, pair, startPx);
  for (const [index, branch] of branches.entries()) {
    appendBranchLane(lane, branch, index + 1, railEndPx, startPx);
  }
  return lane;
}

function createPairFilebox(pair: WirePair, lane: HTMLElement, startPx: number): HTMLElement {
  const untrustedNotes = pair.createdNotTrusted === undefined ? [] : [
    createElement("div", { class: "created-untrusted", text: "creation time not trusted", title: CREATED_NOT_TRUSTED_SENTENCE[pair.createdNotTrusted] }),
  ];
  const filebox = setAxisPx(createElement("div", { class: "filebox" }, [
    ...untrustedNotes,
    // Task 280: full path lives on `data-path` — the find box and File Nav jump read it as identity.
    createElement("div", { class: "fname", text: pair.path.split("/").pop() ?? pair.path, "data-path": pair.path }),
    createElement("div", { class: "sub", text: `${pair.commits.length} commits · on disk` }),
    lane,
  ]), startPx);
  filebox.style.setProperty("--lane-count", String((pair.branches ?? []).length));
  return filebox;
}

export function buildPairWidget(pair: WirePair): HTMLElement {
  const branches = pair.branches ?? [];
  const ladder = listPairLadder(pair, branches);
  const nodePx: number[] = [];
  for (const node of ladder) {
    nodePx.push(node.axisPx);
  }
  const startPx = Math.min(...nodePx);
  const lane = buildPairLane(pair, ladder, startPx, Math.max(...nodePx));
  return createPairFilebox(pair, lane, startPx);
}
