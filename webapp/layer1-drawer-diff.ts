// Task 305/329: shared revision-step helpers; the shift-click range gesture lives in layer1-drawer-multi.ts.

import { getRequiredElementById } from "./app-dom.ts";
import { type DiffStep } from "./layer1-diff-pane.ts";
import { clearDiffWash } from "./layer1-diff-wash.ts";
import { createCommitStep, createDiskStep, createEditSide, createSnapshotStep } from "./layer1-revision-sources.ts";
import { WireEditKind } from "./layer1-wire-edits.ts";

// Task 357: a branch lane dot; its sides come from the branch revision route.
export function isBranchNode(node: HTMLElement): boolean {
  return node.classList.contains("bnode");
}

// Task 343: an Edit/Write node (`n-edit`), a Read beacon (`n-read`) or a branch lane dot.
export function isEditNode(node: HTMLElement): boolean {
  return node.classList.contains("n-edit") || node.classList.contains("n-read") || isBranchNode(node);
}

// Task 343: first-fetch params, head and meta for an edit node's drawer; lane dots flash no session.
export function createEditDrawer(node: HTMLElement, path: string): { params: URLSearchParams; head: string; meta: string; flashFile?: string } {
  const kind = node.dataset.kind ?? "";
  const sessionFile = node.dataset.sessionFile ?? "";
  const flashFile = sessionFile.split("/").pop() ?? sessionFile;
  const isBranch = isBranchNode(node);
  return {
    params: createEditSide(path, node.dataset.changeId ?? "", "target", "", isBranch).buildParams(),
    head: `${path.split("/").pop() ?? path} ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
    meta: isBranch ? `branch revision · ${kind}` : `${node.dataset.confidence ?? ""} · ${kind} of ${flashFile}`,
    flashFile: isBranch ? undefined : flashFile,
  };
}

// A commit node carries its full hash on the dot's `title`; anything else diffs as the working tree.
export function getNodeCommitHash(node: HTMLElement): string | undefined {
  return node.classList.contains("n-commit") && node.title !== "" ? node.title : undefined;
}

// Any lane node as a revision source: commit blob, session snapshot, or the on-disk state.
export function createNodeStep(node: HTMLElement, path: string): DiffStep {
  const hash = getNodeCommitHash(node);
  if (hash !== undefined) {
    return createCommitStep(path, hash);
  }
  const isSnapshotNode = node.classList.contains("n-snap");
  if (isSnapshotNode) {
    return createSnapshotStep(path, {
      sessionFile: node.dataset.sessionFile ?? "",
      sessionId: node.dataset.sessionId ?? "",
      version: Number(node.dataset.version ?? 0),
    });
  }
  const isEdit = isEditNode(node);
  if (isEdit) {
    const isRead = node.dataset.kind === WireEditKind.read;
    return createEditSide(path, node.dataset.changeId ?? "", "target", isRead ? "as read" : "after", isBranchNode(node));
  }
  return createDiskStep(path);
}

// Task 329 retired the drawer's fixed pair rows; only the image strip remains header chrome.
export function setDrawerTools(tools: "img" | "none"): void {
  getRequiredElementById("imgtools").hidden = tools !== "img";
}

export function clearDiffPair(): void {
  clearDiffWash();
  for (const marked of document.querySelectorAll(".diff-base, .diff-target")) {
    marked.classList.remove("diff-base", "diff-target");
  }
}
