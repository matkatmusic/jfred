// Layer 1's two widget shapes (pair bubble, orphan bucket), split out of layer1-page.ts once it hit the 250-line cap.

import { createElement } from "./app-dom.ts";
import { CreatedNotTrustedReason } from "./layer1-created-reason.ts";
import { appendAxisNode, appendBranchLane, appendEditNode, appendScriptRunNode, appendSnapshotNode, setAxisPx } from "./layer1-lane-nodes.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { buildNodesWithSameTimestampMarkers, type NodeWithSameTimestamp } from "./layer1-nodes-with-same-timestamp.ts";
import type { WireBranch } from "./layer1-wire-branches.ts";
import { findRejoinWithOwnSlot, listTrunkLadderInstants } from "./layer1-wire-ladder.ts";
import type { WireOrphan, WirePair } from "./layer1-wire.ts";

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

function buildPairWidget(pair: WirePair): HTMLElement {
  // Snapshots, edits and script runs go last, matching the server's ladder order.
  const snapshots = pair.snapshots ?? [];
  const edits = pair.edits ?? [];
  const scriptRuns = pair.scriptRuns ?? [];
  // Spans earliest to latest of any kind: a pre-commit mtime gave a negative offset over the header.
  const trunk = [...(pair.created === undefined ? [] : [pair.created]), ...pair.commits, pair.onDisk, ...snapshots, ...edits, ...scriptRuns];
  const branches = pair.branches ?? [];
  const ladder = [...trunk, ...listLaneLadderNodes(branches, listTrunkLadderInstants(pair))];
  const nodePx: number[] = [];
  for (const node of ladder) {
    nodePx.push(node.axisPx);
  }
  const startPx = Math.min(...nodePx);
  const lane = setAxisPx(createElement("div", { class: "lane" }), 0);
  lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
  // Task 259's markers go in before the nodes; with no z-index, DOM order keeps the rectangle behind the dots.
  lane.append(createElement("div", { class: "lrail" }), ...buildNodesWithSameTimestampMarkers(ladder, startPx));
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
  const laneChangeIds = new Set<string>();
  for (const branch of branches) {
    for (const node of branch.nodes) {
      laneChangeIds.add(node.changeId);
    }
  }
  for (const edit of edits) {
    appendEditNode(lane, edit.axisPx - startPx, edit, laneChangeIds.has(edit.changeId));
  }
  for (const run of scriptRuns) {
    appendScriptRunNode(lane, run.axisPx - startPx, run);
  }
  const railEndPx = Math.max(...nodePx);
  for (const [index, branch] of branches.entries()) {
    appendBranchLane(lane, branch, index + 1, railEndPx, startPx);
  }
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
  const items: HTMLElement[] = [];
  for (const row of rows) {
    items.push(setAxisPx(createElement("li", {}, [
      createElement("span", { text: row.path }),
      createElement("em", { text: formatInstantLabel(row.instant) }),
    ]), row.axisPx - earliest.axisPx));
  }
  return setAxisPx(createElement("div", { class: "filebox bucket" }, [
    createElement("div", { class: "fname", text: title }),
    createElement("div", { class: "sub", text: `${rows.length} files` }),
    createElement("ul", {}, items),
  ]), earliest.axisPx);
}

// The pair widgets, or the S18 empty-state message when the two roots share no path at all.
export function buildStagePairs(pairs: WirePair[]): HTMLElement[] {
  if (pairs.length === 0) {
    return [createElement("div", { class: "nopairs", text: "No git ↔ on-disk pairs." })];
  }
  const widgets: HTMLElement[] = [];
  for (const pair of pairs) {
    widgets.push(buildPairWidget(pair));
  }
  return widgets;
}
