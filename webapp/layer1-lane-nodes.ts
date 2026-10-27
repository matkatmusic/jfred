// The per-node and per-branch-lane DOM pieces of a Layer 1 pair bubble, split out of layer1-widgets.ts.

import { createElement } from "./app-dom.ts";
import { describeScriptLanguage } from "./layer1-script-language.ts";
import { WireRewindKind, type WireBranch } from "./layer1-wire-branches.ts";
import { WireEditKind, type WireEdit } from "./layer1-wire-edits.ts";
import { WireScriptExecutorKind, type WireScriptRun } from "./layer1-wire-script-runs.ts";
import type { WireSnapshot } from "./layer1-wire.ts";

// Height of the dashed elbow curve; the branch rail sits between the two elbows.
const BRANCH_ELBOW_PX = 16;

// Task 379 mockup: dot tooltip tail per rewind kind.
const BRANCH_NODE_NOTE = {
  [WireRewindKind.code]: "abandoned tip (code reverted, dead end)",
  [WireRewindKind.conversation]: "conversation rewound, code kept",
} as const satisfies Record<WireRewindKind, string>;

// The only value JS contributes to layout; every placement rule lives in layer1-styles.css.
export function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
  node.style.setProperty("--axis-px", String(axisPx));
  return node;
}

// The dot carries the title too: layer1-drawer.ts reads a commit's hash off the clicked dot.
export function appendAxisNode(lane: HTMLElement, axisPx: number, instant: string, nodeClass: string, text: string, titleText?: string): void {
  lane.append(
    setAxisPx(createElement("i", { class: `node ${nodeClass}`, title: titleText, "data-instant": instant }), axisPx),
    setAxisPx(createElement("span", { class: "nlabel", text, title: titleText, "data-instant": instant }), axisPx),
  );
}

// Task 315: identity on `data-` attrs (task 280), on both elements; `n-snap` on both is task 314's hide handle.
export function appendSnapshotNode(lane: HTMLElement, axisPx: number, snapshot: WireSnapshot): void {
  const identity = {
    "data-instant": snapshot.instant,
    "data-version": String(snapshot.version),
    "data-session-id": snapshot.sessionId,
    "data-session-file": snapshot.sessionFile,
    "data-line": snapshot.line === undefined ? undefined : String(snapshot.line),
  };
  lane.append(
    setAxisPx(createElement("i", { class: "node n-snap", ...identity }), axisPx),
    setAxisPx(createElement("span", { class: "nlabel n-snap", text: `@v${snapshot.version} 📸${snapshot.isBackupMissing ? "🚫" : ""}`, ...identity }), axisPx),
  );
}

// Task 343: the dot class hides the node; confidence is a ring class, never a fill swap.
export function appendEditNode(lane: HTMLElement, axisPx: number, edit: WireEdit, isMoved: boolean): void {
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
    setAxisPx(createElement("i", { class: `node ${kindClass} conf-${edit.confidence}`, ...identity }), axisPx),
    setAxisPx(createElement("span", { class: `nlabel ${kindClass}`, text: isRead ? "[R]✓" : "[e]", ...identity }), axisPx),
  );
}

// Task 356: dot and label share the identity attrs; a bash run is never provable, so its ring is dashed.
export function appendScriptRunNode(lane: HTMLElement, axisPx: number, run: WireScriptRun): void {
  const isBash = run.executorKind === WireScriptExecutorKind.bash;
  const identity = {
    title: run.label ?? describeScriptLanguage(run.language),
    "data-tool-use-id": run.toolUseId,
    "data-executor-kind": run.executorKind,
    "data-instant": run.instant,
    "data-session-id": run.sessionId,
    "data-session-file": run.sessionFile,
    "data-line": run.line === undefined ? undefined : String(run.line),
  };
  const iconText = describeScriptLanguage(run.language);
  lane.append(
    setAxisPx(createElement("i", { class: `node n-script${isBash ? " never-provable" : ""}`, ...identity }), axisPx),
    setAxisPx(createElement("span", { class: "nlabel n-script", text: run.label ?? iconText, ...identity }), axisPx),
  );
}

// Task 379 mockup, replaced by the layout's own fork and rejoin offsets.
// function findTrunkAxisPx(trunkNodes: WireInstant[], instant: string): number {
//     const trunkNode = trunkNodes.find((candidate) => candidate.instant === instant);
//     if (trunkNode === undefined) {
//         throw new Error(`branch instant ${instant} matches no trunk node`);
//     }
//     return trunkNode.axisPx;
// }

function findLastBranchNodePx(branch: WireBranch, startPx: number): number {
  const nodePxList: number[] = [];
  for (const node of branch.nodes) {
    nodePxList.push(node.axisPx - startPx);
  }
  return Math.max(...nodePxList);
}

// Task 357: branch dots use bnode/blabel so the drawer ignores them; keptToEnd rejoins at the rail end.
export function appendBranchLane(lane: HTMLElement, branch: WireBranch, laneIndex: number, railEndPx: number, startPx: number): void {
  const forkPx = branch.forkAt.axisPx - startPx;
  const rejoinPx = branch.rejoinAt === undefined ? (branch.keptToEnd === true ? railEndPx - startPx : undefined) : branch.rejoinAt.axisPx - startPx;
  const railFromPx = forkPx + BRANCH_ELBOW_PX;
  const railToPx = rejoinPx === undefined ? findLastBranchNodePx(branch, startPx) : rejoinPx - BRANCH_ELBOW_PX;
  const branchLane = createElement("div", { class: "blane" });
  branchLane.style.setProperty("--lane-index", String(laneIndex));
  const rail = setAxisPx(createElement("div", { class: "brail" }), railFromPx);
  rail.style.setProperty("--span-px", String(railToPx - railFromPx));
  branchLane.append(setAxisPx(createElement("div", { class: "split-elbow" }), forkPx), rail);
  if (rejoinPx !== undefined) {
    branchLane.append(setAxisPx(createElement("div", { class: "merge-elbow" }), rejoinPx));
  }
  for (const node of branch.nodes) {
    const identity = { title: `${node.label}: ${BRANCH_NODE_NOTE[branch.rewindKind]}`, "data-instant": node.instant, "data-change-id": node.changeId, "data-kind": node.label };
    branchLane.append(
      setAxisPx(createElement("i", { class: "bnode", ...identity }), node.axisPx - startPx),
      setAxisPx(createElement("span", { class: "blabel", text: node.label, ...identity }), node.axisPx - startPx),
    );
  }
  lane.append(branchLane);
}
