// DOM builders for one layered file widget (task 207, spec S8): node dots, session lanes, corroboration lines.

import {
  extractBasename,
  findExtremeInstant,
  listLaneInstants,
  measureAxisOffsetPx,
  type AxisOffsetsPx,
  type FileWidgetModel,
  type WireSessionTimeline,
  type WireTimelineNode,
} from "./layered-widget-model.ts";

// One node dot, offset inside its lane by its distance from the widget's start instant.
function buildNodeDot(node: WireTimelineNode, widgetStart: Date | undefined, offsets: AxisOffsetsPx): HTMLElement {
  const dot = document.createElement("i");
  dot.className = `layered-node kind-${node.kind}`;
  dot.style.setProperty("--axis-px", String(measureAxisOffsetPx(new Date(node.instant), widgetStart, offsets)));
  dot.title = `${node.kind} @ ${node.instant}`;
  return dot;
}

// One session's lane; CSS draws its visible name from `data-session`.
function buildSessionLane(sessionTimeline: WireSessionTimeline, widgetStart: Date | undefined, offsets: AxisOffsetsPx): HTMLElement {
  const lane = document.createElement("div");
  lane.className = "layered-lane";
  lane.dataset.session = extractBasename(sessionTimeline.sessionFile);
  lane.title = sessionTimeline.sessionFile;
  const dots: HTMLElement[] = [];
  for (const node of sessionTimeline.timeline.nodes) {
    dots.push(buildNodeDot(node, widgetStart, offsets));
  }
  lane.replaceChildren(...dots);
  return lane;
}

// One dashed line at a corroborated instant, sharing the `--axis-px` contract of node dots.
function buildCorroborationLine(instant: Date, widgetStart: Date | undefined, offsets: AxisOffsetsPx): HTMLElement {
  const line = document.createElement("i");
  line.className = "layered-corroboration";
  line.style.setProperty("--axis-px", String(measureAxisOffsetPx(instant, widgetStart, offsets)));
  line.title = `corroborated @ ${instant.toISOString()}`;
  return line;
}

// One file's widget: emits only server ruler pixels; layered-styles.css owns all placement.
export function buildFileWidget(model: FileWidgetModel, widgetIndex: number, axisOrigin: Date | undefined, offsets: AxisOffsetsPx): HTMLElement {
  const widget = document.createElement("section");
  widget.className = "layered-file-widget";
  widget.id = `layered-file-widget-${widgetIndex}`;
  widget.style.setProperty("--axis-px", String(measureAxisOffsetPx(model.startInstant, axisOrigin, offsets)));
  const widgetEnd = findExtremeInstant(listLaneInstants(model.lanes), true);
  widget.style.setProperty("--axis-span-px", String(measureAxisOffsetPx(widgetEnd, model.startInstant, offsets)));
  const name = document.createElement("div");
  name.className = "layered-file-name";
  name.textContent = model.fileName;
  const lanes = document.createElement("div");
  lanes.className = "layered-lanes";
  // Lines come first so lane dots paint over them; they span all lanes.
  const laneChildren: HTMLElement[] = [];
  for (const instant of model.corroboratedInstants) {
    laneChildren.push(buildCorroborationLine(instant, model.startInstant, offsets));
  }
  for (const lane of model.lanes) {
    laneChildren.push(buildSessionLane(lane, model.startInstant, offsets));
  }
  lanes.replaceChildren(...laneChildren);
  widget.replaceChildren(name, lanes);
  return widget;
}
