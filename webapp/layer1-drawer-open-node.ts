// Task 257.5/305/323: opening the single-node drawer, and the anchor the next shift-click or arrow starts from.

import { getRequiredElementById } from "./app-dom.ts";
import { markLandedElement, moveToUncoveredCentre } from "./layer1-find-file.ts";
import { renderLayer1Minimap } from "./layer1-minimap.ts";
import { DiffPaneMode } from "./layer1-diff-pane.ts";
import { buildDiffView, displayDetailView } from "./layer1-diff-view.ts";
import { isImagePath, renderImageInto } from "./layer1-drawer-image.ts";
import { clearDiffPair, describeNodeStep, isBranchNode, setDrawerTools } from "./layer1-drawer-diff.ts";
import { appendRawJsonRevealForLine, getNodeDrawerDetail } from "./layer1-drawer-node-detail.ts";
import { readNodeIdentity, storeOpenedNode } from "./layer1-node-link.ts";
import { describeEditSteps } from "./layer1-revision-sources.ts";
import { flashSession } from "./layer1-session-flash.ts";

// Task 305: the last plainly-clicked node — the diff pair's anchor.
let anchor: { node: HTMLElement; path: string } | undefined;

export function readAnchor(): { node: HTMLElement; path: string } | undefined {
  return anchor;
}

export function clearAnchor(): void {
  anchor = undefined;
}

// Task 323: the file's timeline IS the lane's DOM order; n-created has no bytes so cycling skips it.
function findAdjacentNode(offset: 1 | -1): HTMLElement | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  const nodes = [...anchor.node.parentElement?.querySelectorAll(".node:not(.n-created)") ?? []] as HTMLElement[];
  return nodes[nodes.indexOf(anchor.node) + offset];
}

// The drawer shrinks the pane, so re-centre against the POST-reflow layout (also why .drawer has no width transition).
function moveViewToAnchoredNode(): void {
  if (anchor === undefined) {
    return;
  }
  moveToUncoveredCentre(anchor.node);
  renderLayer1Minimap();
}

export async function openNodeDrawer(node: HTMLElement, path: string): Promise<void> {
  // A plain click resets to a one-node selection (task 305) and anchors the next shift-click.
  clearDiffPair();
  anchor = { node, path };
  storeOpenedNode(readNodeIdentity(node));
  // Task 323: STOP at the timeline's ends — a missing neighbour disables that arrow, no wrap.
  for (const [id, offset] of [["dprev", -1], ["dnext", 1]] as const) {
    const arrow = getRequiredElementById(id) as HTMLButtonElement;
    arrow.hidden = false;
    arrow.disabled = findAdjacentNode(offset) === undefined;
  }
  const detail = getNodeDrawerDetail(node, path);
  const header = getRequiredElementById("dpath");
  header.textContent = detail.head;
  header.title = path;
  getRequiredElementById("dmeta").textContent = detail.meta;
  // Clicking a node IS selecting it (user, 2026-07-26): the same highlight language a ruler-tick landing speaks.
  markLandedElement(node);
  getRequiredElementById("drawer").classList.add("open");
  requestAnimationFrame(moveViewToAnchoredNode);
  const isImage = isImagePath(path);
  setDrawerTools(isImage ? "img" : "none");
  // Task 299: an image renders as a picture straight off the binary route — no text fetch at all.
  if (isImage) {
    getRequiredElementById("dmulti").hidden = true;
    detail.params.set("binary", "1");
    renderImageInto(getRequiredElementById("dbody"), `/api/layer1-file?${detail.params}`);
    return;
  }
  // An Edit/Write node shows its two replayed sides; any other node shows the whole file.
  const isEditNodeClass = node.classList.contains("n-edit");
  const isBranch = isBranchNode(node);
  const isEditOrBranch = isEditNodeClass || isBranch;
  const steps = isEditOrBranch
    ? describeEditSteps(path, node.dataset.changeId ?? "", isBranch)
    : [describeNodeStep(node, path)];
  displayDetailView([buildDiffView(path, steps, {
    revisionControlsShown: steps.length > 1,
    mode: DiffPaneMode.inline,
    fullContents: steps.length === 1,
    baseIndex: 0,
    targetIndex: steps.length - 1,
  })]);
  // The reveal needs only the node's own session file and line, so a failed backup read cannot remove it.
  const { sessionFile, line } = node.dataset;
  const hasSessionFile = sessionFile !== undefined;
  const hasLine = line !== undefined;
  const hasRevealTarget = hasSessionFile && hasLine;
  if (hasRevealTarget) {
    appendRawJsonRevealForLine(sessionFile, Number(line));
  }
  // Task 317: a snapshot's header still carries the title in effect at its line; flash its JSONL.
  if (detail.flashFile !== undefined) {
    const response = await fetch(`/api/layer1-file?${detail.params}`);
    if (response.ok) {
      const payload = await response.json() as { title?: string };
      header.textContent = payload.title === undefined ? detail.head : `${detail.head} - ${payload.title}`;
    }
    flashSession(detail.flashFile);
  }
}

// Task 323: cycling never leaves the lane, so the anchored path carries over.
export function openNeighbour(offset: 1 | -1): void {
  const neighbour = findAdjacentNode(offset);
  const currentAnchor = anchor;
  const hasNeighbour = neighbour !== undefined;
  const hasAnchor = currentAnchor !== undefined;
  const canOpen = hasNeighbour && hasAnchor;
  if (canOpen) {
    void openNodeDrawer(neighbour, currentAnchor.path);
  }
}
