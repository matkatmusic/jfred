// Layered page behavior (tasks 205, 206, spec S7): collapsing drawer, drawer lists, file-nav scrolling, Changes pane, graph fetch.

import { getRequiredElementById } from "./app-dom.ts";
import { buildFileWidget } from "./layered-widget-dom.ts";
import {
  buildFileWidgetModels,
  findExtremeInstant,
  listSessionBasenames,
  type AxisOffsetsPx,
  type FileWidgetModel,
  type WireLayeredGraph,
} from "./layered-widget-model.ts";

// Collapse or restore the left drawer.
export function toggleLayeredDrawer(): void {
  getRequiredElementById("layered-drawer").classList.toggle("collapsed");
}

// Show the Changes pane only while a segment is selected (S7: hidden until then).
export function setChangesPaneVisible(hasSelection: boolean): void {
  getRequiredElementById("layered-changes").hidden = !hasSelection;
}

// One drawer list entry.
function buildDrawerItem(label: string, onClick: (() => void) | undefined): HTMLElement {
  const item = document.createElement("div");
  item.className = "layered-drawer-item";
  item.textContent = label;
  if (onClick !== undefined) {
    item.addEventListener("click", onClick);
  }
  return item;
}

// A click handler that scrolls the widget into view.
function buildScrollHandler(widget: HTMLElement): () => void {
  return () => widget.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Rebuild the session list, file nav, and per-file widgets; a nav click scrolls to its widget (S7).
export function renderLayeredDrawer(sessionNames: string[], files: FileWidgetModel[], offsets: AxisOffsetsPx = {}): void {
  const sessionItems: HTMLElement[] = [];
  for (const name of sessionNames) {
    sessionItems.push(buildDrawerItem(name, undefined));
  }
  getRequiredElementById("layered-session-list").replaceChildren(...sessionItems);
  const startInstants: Date[] = [];
  for (const model of files) {
    if (model.startInstant !== undefined) {
      startInstants.push(model.startInstant);
    }
  }
  const axisOrigin = findExtremeInstant(startInstants, false);
  const widgets: HTMLElement[] = [];
  const navItems: HTMLElement[] = [];
  for (const [widgetIndex, model] of files.entries()) {
    const widget = buildFileWidget(model, widgetIndex, axisOrigin, offsets);
    widgets.push(widget);
    navItems.push(buildDrawerItem(model.fileName, buildScrollHandler(widget)));
  }
  getRequiredElementById("layered-canvas").replaceChildren(...widgets);
  getRequiredElementById("layered-file-nav").replaceChildren(...navItems);
}

// Fetch the ?project= layered graph and fill the drawer; no project or a failed fetch keeps the skeleton.
export async function loadLayeredGraphIntoDrawer(
  projectName: string | null = new URLSearchParams(location.search).get("project"),
): Promise<void> {
  if (projectName === null) {
    return;
  }
  const response = await fetch(`/api/layered-graph?project=${encodeURIComponent(projectName)}`);
  if (!response.ok) {
    return;
  }
  const graph = await response.json() as WireLayeredGraph;
  renderLayeredDrawer(listSessionBasenames(graph), buildFileWidgetModels(graph), graph.axisOffsetsPx);
}

// Wire the header toggle button, render the empty drawer, and start the graph fetch.
export function launchLayeredApp(): void {
  getRequiredElementById("layered-drawer-toggle").addEventListener("click", toggleLayeredDrawer);
  renderLayeredDrawer([], []);
  void loadLayeredGraphIntoDrawer();
}

launchLayeredApp();
