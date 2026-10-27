// One timeline row for one node (split from timeline-render-rows.ts).

import { createElement } from "../app-dom.ts";
import { computeRolePillClass, computeRolePillLabel } from "./timeline-labels-pills.ts";
import { computeRowSummaryText, computeSessionShortLabel, formatRowTimestamp } from "./timeline-labels.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import {
  appendCommitCells,
  appendExpandedBubble,
  appendExpansionTriangle,
  appendJsonRecordButton,
  computeRoleClass,
} from "./timeline-render-row-cells.ts";
import { buildGraphCell } from "./timeline-render-graph-cell.ts";
import { buildPickCell } from "./timeline-render-selectbar.ts";
import {
  checkNodeIsAbandonedBranchTip,
  checkRowCarriesJsonRecordButton,
  checkRowIsExpandable,
} from "./timeline-sessions.ts";
import { COMMIT_NODE_KIND } from "./timeline-types.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

export function buildTimelineRow(context: TimelineRenderContext, node: TimelineNode, index: number, sessionColor: string): HTMLElement {
  const previewPane = createElement("div", { class: "hidden" });
  context.previewPanes.set(index, previewPane);
  const row = createElement("div", { class: `tl-row${node.isOrphaned === true ? " orphan" : ""}` });
  row.append(buildGraphCell(node.kind, index, context.laneRuns, sessionColor));
  const main = createElement("div", { class: "tl-main" });
  const line = createElement("div", { class: "tl-line" });
  line.append(buildPickCell(context, node, index));
  const isExpandable = checkRowIsExpandable(node);
  if (node.kind === COMMIT_NODE_KIND) {
    appendCommitCells(context, line, row, node);
  }
  else if (isExpandable) {
    appendExpansionTriangle(context, line, row);
  }
  else {
    line.append(createElement("span", { class: "tl-tri", text: "" }));
  }
  const rolePillLabel = computeRolePillLabel(node);
  if (rolePillLabel !== undefined) {
    line.append(createElement("span", { class: `role-pill ${computeRolePillClass(rolePillLabel)}`, text: rolePillLabel }));
  }
  line.append(createElement("span", {
    class: `tl-text ${computeRoleClass(node.kind)}${node.isSystem === true ? " system" : ""}`,
    text: computeRowSummaryText(node),
  }));
  if (node.isError === true) {
    line.append(createElement("span", { class: "failed-badge", text: "FAILED" }));
  }
  const isAbandonedTip = checkNodeIsAbandonedBranchTip(context.nodes, index);
  if (isAbandonedTip) {
    line.append(createElement("span", { class: "abandoned-badge", text: "(abandoned)" }));
  }
  if (node.scriptRun !== undefined) {
    line.append(createElement("span", { class: "script-files-badge", text: `modified ${node.scriptRun.changedPaths.length} file(s)` }));
  }
  line.append(createElement("span", { class: "tl-ts", text: formatRowTimestamp(node.when) }));
  line.append(createElement("span", { class: "tl-pos", text: context.lineLabels.get(index) ?? "" }));
  line.append(createElement("span", { class: "tl-uuid", text: node.sessionId === undefined ? "" : computeSessionShortLabel(node.sessionId) }));
  const carriesJsonRecordButton = checkRowCarriesJsonRecordButton(node);
  if (carriesJsonRecordButton) {
    appendJsonRecordButton(context, line, index);
  }
  const selectRow = (): void => {
    void context.selectTimelineRow(index);
  };
  line.addEventListener("click", selectRow);
  main.append(line);
  if (isExpandable) {
    appendExpandedBubble(context, node, index, previewPane, main, row);
  }
  main.append(previewPane);
  row.append(main);
  context.nodeRows.set(index, row);
  return row;
}
