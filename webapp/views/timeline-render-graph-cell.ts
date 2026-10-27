// The fork gutter cell of a timeline row, split from timeline-render-row-cells.ts.

import { createElement } from "../app-dom.ts";
import { COMMIT_NODE_KIND, SESSION_END_NODE_KIND, type TimelineNode } from "./timeline-types.ts";

type LaneRun = { startIndex: number; endIndex: number };

// Commit and session-end dots render hollow because both read as terminators.
function isDotHollow(kind: TimelineNode["kind"]): boolean {
  if (kind === COMMIT_NODE_KIND) {
    return true;
  }
  return kind === SESSION_END_NODE_KIND;
}

// The fork gutter cell: lane-1 rail in the session color, plus a lane-2 rail inside lane runs.
export function buildGraphCell(kind: TimelineNode["kind"], index: number, laneRuns: LaneRun[], sessionColor: string): HTMLElement {
  const cell = createElement("div", { class: "tl-graph" });
  cell.append(createElement("span", { class: "g-rail g-l1", style: `background:${sessionColor}` }));
  let run: LaneRun | undefined;
  for (const candidate of laneRuns) {
    const isInsideRun = index >= candidate.startIndex && index <= candidate.endIndex;
    if (isInsideRun) {
      run = candidate;
      break;
    }
  }
  if (run !== undefined) {
    const lane2 = createElement("span", { class: "g-rail g-l2" });
    if (index === run.startIndex) {
      lane2.classList.add("g-start");
      cell.append(createElement("span", { class: "g-fork" }));
    }
    if (index === run.endIndex) {
      lane2.classList.add("g-end");
    }
    cell.append(lane2);
  }
  const dot = createElement("span", { class: `g-dot ${run === undefined ? "g-l1" : "g-l2"}` });
  const dotIsHollow = isDotHollow(kind);
  if (dotIsHollow) {
    dot.classList.add("g-hollow");
    dot.style.color = sessionColor;                    // .g-hollow's ring is currentColor
  }
  else if (run === undefined) {
    dot.style.background = sessionColor;               // lane-2 dots keep the CSS lane color
  }
  cell.append(dot);
  return cell;
}
