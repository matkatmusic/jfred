// Task 257.5: the Detail View drawer; delegated on #stage since bubbles rebuild per render (wireLeaderVisibility's precedent).

import { getRequiredElementById } from "./app-dom.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { clearDiffPair } from "./layer1-drawer-diff.ts";
import { wireImageZoomTools } from "./layer1-drawer-image.ts";
import { clearAnchor, openNeighbour, openNodeDrawer, readAnchor } from "./layer1-drawer-open-node.ts";
import { applyDiffSelectionRange } from "./layer1-diff-selection-range.ts";
import { openScriptRunDrawer } from "./layer1-script-run-drawer.ts";

// The clicked node, or undefined; a label opens too, and its dot is its previous sibling (appendAxisNode's order).
function findClickedNode(target: HTMLElement): HTMLElement | undefined {
  const hit = target.closest(".node, .nlabel, .bnode, .blabel");
  const node = hit?.matches(".nlabel, .blabel") === true ? hit.previousElementSibling : hit;
  // A bucket row has no dot, so a `.nlabel` there (or anywhere) resolves to a non-node sibling.
  return node?.matches(".node, .bnode") === true ? node as HTMLElement : undefined;
}

// The full path lives on the owning bubble's `.fname` data-path (task 280); a bucket row has none.
function findNodePath(node: HTMLElement): string | undefined {
  const nameElement = node.closest(".filebox")?.querySelector(".fname") as HTMLElement | null;
  return nameElement?.dataset.path;
}

function applyStageClick(event: Event): void {
  const target = event.target as HTMLElement;
  // Task 356: a connector is not a `.node` — route it before findClickedNode swallows the click.
  const connector = target.closest<HTMLElement>(".script-connector");
  const isConnector = connector !== null;
  if (isConnector) {
    void openScriptRunDrawer(connector.dataset.toolUseId);
    return;
  }
  const node = findClickedNode(target);
  const isNodeMissing = node === undefined;
  if (isNodeMissing) {
    return;
  }
  // A created-at node is never the latest on-disk state, so it has no bytes to show.
  const isCreated = node.classList.contains("n-created");
  if (isCreated) {
    return;
  }
  // Task 356: a script node's identity is toolUseId, so it never needs findNodePath.
  const isScript = node.classList.contains("n-script");
  if (isScript) {
    void openScriptRunDrawer(node.dataset.toolUseId);
    return;
  }
  const path = findNodePath(node);
  const isPathMissing = path === undefined;
  if (isPathMissing) {
    return;
  }
  // Task 305: shift extends the anchored selection into a two-node diff pair.
  const currentAnchor = readAnchor();
  const isShift = (event as MouseEvent).shiftKey;
  const hasAnchor = currentAnchor !== undefined;
  const isDrawerOpen = getRequiredElementById("drawer").classList.contains("open");
  const isShiftWithAnchor = isShift && hasAnchor;
  const isRangeGesture = isShiftWithAnchor && isDrawerOpen;
  if (isRangeGesture) {
    applyDiffSelectionRange(currentAnchor, node, path);
    return;
  }
  void openNodeDrawer(node, path);
}

function openPreviousNeighbour(): void {
  openNeighbour(-1);
}

function openNextNeighbour(): void {
  openNeighbour(1);
}

function closeDrawer(): void {
  getRequiredElementById("drawer").classList.remove("open");
  getRequiredElementById("dmulti").hidden = true;
  clearDiffPair();
  clearAnchor();
  drawLayer1Minimap();
}

export function installNodeDrawer(): void {
  wireImageZoomTools();
  getRequiredElementById("stage").addEventListener("click", applyStageClick);
  getRequiredElementById("dprev").addEventListener("click", openPreviousNeighbour);
  getRequiredElementById("dnext").addEventListener("click", openNextNeighbour);
  getRequiredElementById("dclose").addEventListener("click", closeDrawer);
}
