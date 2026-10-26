// Task 329: the shift-click range gesture; the second clicked node closes a wash over every nav-selected file.

import { getRequiredElementById } from "./app-dom.ts";
import { displayDetailView } from "./layer1-diff-view.ts";
import { setDrawerTools } from "./layer1-drawer-diff.ts";
import { createDetailViewsForFiles, listWashFiles } from "./layer1-drawer-multi.ts";
import { paintDiffWash, readDrawnView, readNavTargets, readNodeInstant } from "./layer1-diff-wash.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";

export function applyDiffSelectionRange(anchor: { node: HTMLElement; path: string }, node: HTMLElement, path: string): void {
  if (anchor.node === node) {
    return;
  }
  const view = readDrawnView();
  if (view === undefined) {
    return;
  }
  const anchorInstant = readNodeInstant(view, anchor.path, anchor.node);
  const nodeInstant = readNodeInstant(view, path, node);
  const isAnchorInstantMissing = anchorInstant === undefined;
  const isNodeInstantMissing = nodeInstant === undefined;
  const isEitherInstantMissing = isAnchorInstantMissing || isNodeInstantMissing;
  if (isEitherInstantMissing) {
    return;
  }
  // Direction comes from the instant, never click order: earlier is base, later is target.
  const [baseNode, baseInstant, targetInstant] = Date.parse(anchorInstant) <= Date.parse(nodeInstant)
    ? [anchor.node, anchorInstant, nodeInstant]
    : [node, nodeInstant, anchorInstant];
  const targetNode = baseNode === anchor.node ? node : anchor.node;
  for (const lit of document.querySelectorAll(".found, .diff-base, .diff-target")) {
    lit.classList.remove("found", "diff-base", "diff-target");
  }
  baseNode.classList.add("diff-base");
  targetNode.classList.add("diff-target");
  paintDiffWash(baseInstant, targetInstant, view.ruler);
  const files = listWashFiles(view, { baseInstant, targetInstant }, [...readNavTargets(), anchor.path, path]);
  const header = getRequiredElementById("dpath");
  header.textContent = files.length === 1
    ? `${files[0]!.split("/").pop()} — range diff`
    : `${files.length} files — range diff`;
  header.title = files.join("\n");
  getRequiredElementById("dmeta").textContent =
    `base ${formatInstantLabel(baseInstant)} → target ${formatInstantLabel(targetInstant)}`;
  setDrawerTools("none");
  getRequiredElementById("dprev").hidden = true;
  getRequiredElementById("dnext").hidden = true;
  displayDetailView(createDetailViewsForFiles(view, files, { baseInstant, targetInstant }));
}
