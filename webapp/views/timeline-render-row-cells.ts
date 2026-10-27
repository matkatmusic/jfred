// Per-row cell builders for the revision timeline: role classes and append-one-cell helpers.

import { createElement } from "../app-dom.ts";
import {
  GIT_BASELINE_ROLE_PILL_LABEL,
  computeRolePillClass,
  computeSessionStartLabel,
} from "./timeline-labels-pills.ts";
import { LINE_NODE_KIND } from "./timeline-line-nodes.ts";
import { renderFileButtonRow } from "./timeline-render-chips.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND } from "./timeline-types.ts";
import type { CommitNode, TimelineNode, TurnNode } from "./timeline-node-types.ts";

// The mockup's role-* text/bubble class per node kind (agent turns are the assistant role).
export function computeRoleClass(kind: TimelineNode["kind"]): string {
  if (kind === USER_TURN_NODE_KIND) {
    return "role-user";
  }
  if (kind === AGENT_TURN_NODE_KIND) {
    return "role-assistant";
  }
  if (kind === TOOL_CALL_NODE_KIND) {
    return "role-tool";
  }
  if (kind === COMMIT_NODE_KIND) {
    return "role-commit";
  }
  // task 160: a raw-line row's text is its classification, so it gets its own color.
  if (kind === LINE_NODE_KIND) {
    return "role-line";
  }
  return "role-end";
}

// The tinted session-start marker row.
export function appendSessionStartMarker(context: TimelineRenderContext, rowFragment: DocumentFragment, sessionColor: string, startedSessionId: string): void {
  const marker = createElement("div", { class: "tl-session-start" });
  marker.style.color = sessionColor;
  marker.append(createElement("span", {
    class: "tl-session-start-label",
    text: computeSessionStartLabel(context.reconstructionDocument.sessionTitles, startedSessionId),
  }));
  rowFragment.append(marker);
}

// The commit row's cells: a plain commit, or the merged git-derived baseline row.
export function appendCommitCells(context: TimelineRenderContext, line: HTMLElement, row: HTMLElement, node: TimelineNode): void {
  if (node.isGitBaseline === true) {
    appendExpansionTriangle(context, line, row);
    line.append(createElement("span", { class: `role-pill ${computeRolePillClass(GIT_BASELINE_ROLE_PILL_LABEL)}`, text: GIT_BASELINE_ROLE_PILL_LABEL }));
  }
  else {
    line.append(createElement("span", { class: "tl-tri", text: "" }));   // spacer keeps columns aligned
    line.append(createElement("span", { class: "commit-label", text: "git commit" }));
  }
  if (node.resultHash !== undefined) {                       // no hash → no pill (a blank "—" reads broken)
    line.append(createElement("span", { class: "commit-pill", text: node.resultHash }));
  }
}

// The triangle that toggles a row's expanded state.
export function appendExpansionTriangle(context: TimelineRenderContext, line: HTMLElement, row: HTMLElement): void {
  const tri = createElement("span", { class: "tl-tri", text: "▸" });
  function toggleRowExpansion(event: Event): void {
    event.stopPropagation();                   // expansion must not change selection
    row.classList.toggle("expanded");
    context.updateToggleLabel();
  }
  tri.addEventListener("click", toggleRowExpansion);
  line.append(tri);
}

// The { } button that opens the row's JSONL record in the details pane.
export function appendJsonRecordButton(context: TimelineRenderContext, line: HTMLElement, index: number): void {
  line.append(createElement("button", {
    class: "tl-json",
    text: "{ }",
    title: "Show this row's JSONL record in the details pane",
    onclick: async (event: Event) => {
      event.stopPropagation();
      await context.selectTimelineRow(index);
      context.openNodeInspector(index);
    },
  }));
}

// A bubble shows file chips for agent turns and the merged git baseline commit row.
function isBubbleShowingFileChips(node: TimelineNode): node is TurnNode | CommitNode {
  if (node.kind === AGENT_TURN_NODE_KIND) {
    return true;
  }
  return node.isGitBaseline === true;
}

// The expanded row's bubble: full text plus agent-turn file chips.
export function appendExpandedBubble(context: TimelineRenderContext, node: TimelineNode, index: number, previewPane: HTMLElement, main: HTMLElement, row: HTMLElement): void {
  const bubble = createElement("div", { class: `tl-bubble ${computeRoleClass(node.kind)}` });
  bubble.append(node.kind === TOOL_CALL_NODE_KIND ? `${node.toolName}(${node.summary})` : node.text ?? "");
  const showsFileChips = isBubbleShowingFileChips(node);
  if (showsFileChips) {
    const chipRows: HTMLElement[] = [];
    for (const change of node.fileChanges!) {
      chipRows.push(renderFileButtonRow(context, node, index, change, previewPane));
    }
    bubble.append(createElement("div", { class: "timeline-chips" }, chipRows));
  }
  main.append(bubble);
  context.expandableRows.push(row);
}
