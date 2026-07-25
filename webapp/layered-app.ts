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

// The wire form of the layered graph (task 206): what JSON.parse yields — Path/Uuid arrive as
// plain strings and Instants as ISO text, so this is NOT the engine's ReconstructionGraph.
interface WireTimelineNode {
    kind: string;
    instant: string;
}

interface WireSessionTimeline {
    sessionFile: string;
    // Already ordered by the engine's sortNodesOntoAxis (layered_load.ts sorts every session
    // timeline as it is built), so the first node IS the session's earliest instant.
    timeline: { nodes: WireTimelineNode[] };
}

interface WireLayeredGraph {
    entities: Array<{ filename: string; sessionTimelines: WireSessionTimeline[] }>;
}

// The last path segment of a "/"-joined wire path.
function takeBasename(wirePath: string): string {
    return wirePath.split("/").pop() ?? wirePath;
}

// The distinct sessionFile basenames across the graph, in first-seen order.
function listSessionBasenames(graph: WireLayeredGraph): string[] {
    const seen = new Set<string>();
    for (const entity of graph.entities) {
        for (const sessionTimeline of entity.sessionTimelines) {
            seen.add(takeBasename(sessionTimeline.sessionFile));
        }
    }
    return [...seen];
}

// One file's canvas widget (spec S8): its per-session lanes plus the instant its history starts
// at — the offset onto the shared vertical axis. `startInstant` is undefined for a file with no
// dated evidence at all; such a widget pins to the axis origin.
export interface FileWidgetModel {
    fileName: string;
    lanes: WireSessionTimeline[];
    startInstant: Date | undefined;
}

// Every instant a file's lanes carry, hydrated from the wire's ISO text.
function listLaneInstants(lanes: WireSessionTimeline[]): Date[] {
    return lanes.flatMap((lane) => lane.timeline.nodes.map((node) => new Date(node.instant)));
}

// The one extreme-instant scan both ends need: `keepLater` false picks the earliest (a file's
// history start), true the latest (its end). Undefined when there are no instants at all.
function findExtremeInstant(instants: Date[], keepLater: boolean): Date | undefined {
    return instants.reduce<Date | undefined>((kept, instant) => {
        if (kept === undefined) {
            return instant;
        }
        return (instant > kept) === keepLater ? instant : kept;
    }, undefined);
}

// Milliseconds from `origin` to `instant` — the raw axis offset the CSS scales into pixels.
// Either end missing means "no known offset", which pins to the origin.
function measureAxisOffsetMs(instant: Date | undefined, origin: Date | undefined): number {
    if (instant === undefined || origin === undefined) {
        return 0;
    }
    return instant.getTime() - origin.getTime();
}

// The widget models for a fetched graph, ordered by history start (the S8 widget offset order);
// a file with no dated evidence sorts last.
export function buildFileWidgetModels(graph: WireLayeredGraph): FileWidgetModel[] {
    const models = graph.entities.map((entity) => ({
        fileName: entity.filename,
        lanes: entity.sessionTimelines,
        startInstant: findExtremeInstant(listLaneInstants(entity.sessionTimelines), false),
    }));
    const sortKeyOf = (model: FileWidgetModel): number =>
        model.startInstant?.getTime() ?? Number.POSITIVE_INFINITY;
    return models.sort((a, b) => sortKeyOf(a) - sortKeyOf(b));
}

// One node dot, offset inside its lane by its distance from the widget's start instant.
function buildNodeDot(node: WireTimelineNode, widgetStart: Date | undefined): HTMLElement {
    const dot = document.createElement("i");
    dot.className = `layered-node kind-${node.kind}`;
    dot.style.setProperty("--axis-ms", String(measureAxisOffsetMs(new Date(node.instant), widgetStart)));
    dot.title = `${node.kind} @ ${node.instant}`;
    return dot;
}

// One session's lane inside a file widget (S8: per-session lanes inside the widget). The lane's
// visible session name is drawn by CSS from `data-session`, so there is no label element.
function buildSessionLane(sessionTimeline: WireSessionTimeline, widgetStart: Date | undefined): HTMLElement {
    const lane = document.createElement("div");
    lane.className = "layered-lane";
    lane.dataset.session = takeBasename(sessionTimeline.sessionFile);
    lane.title = sessionTimeline.sessionFile;
    lane.replaceChildren(...sessionTimeline.timeline.nodes.map((node) => buildNodeDot(node, widgetStart)));
    return lane;
}

// One file's rounded canvas widget: offset to its history's start on the shared vertical axis,
// per-session lanes inside (spec S8). JS emits only raw axis milliseconds — `--axis-ms` for the
// widget's own offset and `--axis-span-ms` for its height; layered-styles.css owns the ms→px
// scale and every placement rule.
function buildFileWidget(model: FileWidgetModel, widgetIndex: number, axisOrigin: Date | undefined): HTMLElement {
    const widget = document.createElement("section");
    widget.className = "layered-file-widget";
    widget.id = `layered-file-widget-${widgetIndex}`;
    widget.style.setProperty("--axis-ms", String(measureAxisOffsetMs(model.startInstant, axisOrigin)));
    const widgetEnd = findExtremeInstant(listLaneInstants(model.lanes), true);
    widget.style.setProperty("--axis-span-ms", String(measureAxisOffsetMs(widgetEnd, model.startInstant)));
    const name = document.createElement("div");
    name.className = "layered-file-name";
    name.textContent = model.fileName;
    const lanes = document.createElement("div");
    lanes.className = "layered-lanes";
    lanes.replaceChildren(...model.lanes.map((lane) => buildSessionLane(lane, model.startInstant)));
    widget.replaceChildren(name, lanes);
    return widget;
}

// Rebuild the session list, the file nav, and the canvas's per-file widgets. A file-nav item's
// click scrolls its widget into view (S7: clicking a file scrolls to its widget).
export function renderLayeredDrawer(sessionNames: string[], files: FileWidgetModel[]): void {
    const sessionList = getRequiredElementById("layered-session-list");
    sessionList.replaceChildren(...sessionNames.map((name) => buildDrawerItem(name, undefined)));
    const axisOrigin = findExtremeInstant(files.flatMap(
        (model) => (model.startInstant === undefined ? [] : [model.startInstant]),
    ), false);
    const canvas = getRequiredElementById("layered-canvas");
    const widgets = files.map((model, widgetIndex) => buildFileWidget(model, widgetIndex, axisOrigin));
    canvas.replaceChildren(...widgets);
    const fileNav = getRequiredElementById("layered-file-nav");
    const navItems = files.map((model, widgetIndex) =>
        buildDrawerItem(model.fileName, () => widgets[widgetIndex]?.scrollIntoView({ behavior: "smooth", block: "center" })));
    fileNav.replaceChildren(...navItems);
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
    renderLayeredDrawer(listSessionBasenames(graph), buildFileWidgetModels(graph));
}

// Wire the header toggle button, render the empty drawer, and start the graph fetch.
export function bootLayeredApp(): void {
    getRequiredElementById("layered-drawer-toggle").addEventListener("click", toggleLayeredDrawer);
    renderLayeredDrawer([], []);
    void loadLayeredGraphIntoDrawer();
}

bootLayeredApp();
