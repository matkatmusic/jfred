// Layered page skeleton behavior (task 205, spec S7): collapsing drawer, drawer lists with
// per-file placeholder widgets, file-nav click scrolling to its widget, and the Changes pane
// hidden until a segment is selected. Task 206 adds the layered-graph fetch on load.

import { getRequiredElementById } from "./app-dom.ts";

// Collapse or restore the left drawer.
export function toggleLayeredDrawer(): void {
    getRequiredElementById("layered-drawer").classList.toggle("collapsed");
}

// Show the Changes pane only while a segment is selected (S7: hidden until then).
export function revealChangesPane(hasSelection: boolean): void {
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

// One placeholder canvas widget for a file (replaced by the real per-file widget in task 207).
function buildFileWidget(fileName: string, widgetIndex: number): HTMLElement {
    const widget = document.createElement("section");
    widget.className = "layered-file-widget";
    widget.id = `layered-file-widget-${widgetIndex}`;
    widget.textContent = fileName;
    return widget;
}

// Rebuild the session list, the file nav, and the canvas's placeholder widgets. A file-nav
// item's click scrolls its widget into view (S7: clicking a file scrolls to its widget).
export function renderLayeredDrawer(sessionNames: string[], fileNames: string[]): void {
    const sessionList = getRequiredElementById("layered-session-list");
    sessionList.replaceChildren(...sessionNames.map((name) => buildDrawerItem(name, undefined)));
    const canvas = getRequiredElementById("layered-canvas");
    const widgets = fileNames.map((name, widgetIndex) => buildFileWidget(name, widgetIndex));
    canvas.replaceChildren(...widgets);
    const fileNav = getRequiredElementById("layered-file-nav");
    const navItems = fileNames.map((name, widgetIndex) =>
        buildDrawerItem(name, () => widgets[widgetIndex]?.scrollIntoView({ behavior: "smooth", block: "center" })));
    fileNav.replaceChildren(...navItems);
}

// The wire form of the layered graph (task 206): what JSON.parse yields — Path/Uuid arrive as
// plain strings, so this is NOT the engine's ReconstructionGraph.
interface WireLayeredGraph {
    entities: Array<{
        filename: string;
        sessionTimelines: Array<{ sessionFile: string }>;
    }>;
}

// The distinct sessionFile basenames across the graph, in first-seen order.
function listSessionBasenames(graph: WireLayeredGraph): string[] {
    const seen = new Set<string>();
    for (const entity of graph.entities) {
        for (const sessionTimeline of entity.sessionTimelines) {
            seen.add(sessionTimeline.sessionFile.split("/").pop() ?? sessionTimeline.sessionFile);
        }
    }
    return [...seen];
}

// Task 206: fetch the layered graph for the page's project (named via ?project=) and fill the
// drawer. No project param → the empty skeleton stays; a failed fetch likewise.
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
    renderLayeredDrawer(listSessionBasenames(graph), graph.entities.map((entity) => entity.filename));
}

// Wire the header toggle button, render the empty drawer, and start the graph fetch.
export function bootLayeredApp(): void {
    getRequiredElementById("layered-drawer-toggle").addEventListener("click", toggleLayeredDrawer);
    renderLayeredDrawer([], []);
    void loadLayeredGraphIntoDrawer();
}

bootLayeredApp();
