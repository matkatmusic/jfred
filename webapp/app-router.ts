// Hash-route dispatch; header wiring lives in app-header.ts.

import { el } from "./app-dom.ts";
import { ensureProgressTerminal, expandProgressConsole, progressTerminal } from "./app-console.ts";
import { inflightLoadController } from "./app-fetch.ts";
import { checkRouteIsTimeline, parseRouteSegments, routeToTimeline } from "./app-routes.ts";
import { renderSubRouteDrawer, resetDetailsPane } from "./app-drawer.ts";
import { maybeOfferProjectPathsWizard } from "./app-paths-project.ts";
import { renderProjectsView } from "./views/projects.ts";
import { renderTimelineView } from "./views/timeline.ts";

// Tracks which project's output currently fills the progress console.
let lastLoadedProject: string | undefined;

// Reset after a folder switch so every project re-loads fresh.
export function resetLastLoadedProject(): void {
    lastLoadedProject = undefined;
}

// task 138: stale navigations must not mutate shared chrome after awaits.
let renderRouteGeneration = 0;

// True when a newer renderRoute run has started since `generation` was stamped.
function checkRouteRenderIsStale(generation: number): boolean {
    return generation !== renderRouteGeneration;
}

// Only true when navigating to a different project (item 22).
export function checkNavigationStartsNewProjectLoad(previousProject: string | undefined, nextProject: string | undefined): boolean {
    if (nextProject === undefined) {
        return false;
    }
    return nextProject !== previousProject;
}

// Extracted to keep anchor ternaries one indent shallower.
async function renderProjectRoute(view: HTMLElement, segments: string[], generation: number): Promise<void> {
    const project = segments[1]!;
    setToolbarTitle(project);   // item 66: was setBreadcrumb(project)
    // Timeline is always the base view; sub-routes render as a drawer over it.
    const anchorJsonl = segments[2] === "timeline" && segments[3] === "session" ? segments[4]
        : segments[2] === "jsonl" ? segments[3] : undefined;
    const anchorLine = segments[2] === "timeline" && segments[5] === "at" ? segments[6] : undefined;
    await renderTimelineView(view, project, anchorJsonl, anchorLine);
    // task 138: a newer navigation started while the timeline rendered — the drawer belongs to it.
    if (checkRouteRenderIsStale(generation)) return;
    await renderSubRouteDrawer(project, segments);
}

export async function renderRoute(): Promise<void> {
    const generation = ++renderRouteGeneration;   // task 138: this run is now the newest
    inflightLoadController?.abort();   // navigation tears down any in-flight load
    const view = document.getElementById("view")!;
    // task 138: each run owns a fresh pane, swapped in atomically. Two overlapping runs used to clear-then-append into the SAME element and both appends landed (duplicate projects list); now a superseded run's late appends land in its own detached pane and are never seen.
    const pane = el("div");
    view.replaceChildren(pane);
    view.onclick = null;
    // item 73: restore toggle-all hidden by consent dialog.
    (document.getElementById("toggle-all") as HTMLButtonElement).hidden = false;
    // task 114: filter bar is timeline-only; renderTimelineFilterBar unhides it.
    document.getElementById("timeline-filter-bar")!.hidden = true;
    // task 157: re-ask button is project chrome, unhidden when baseline exists.
    document.getElementById("reask-baseline-btn")!.hidden = true;
    // item 66: was — emptied the whole inspector pane on every route change:
    // const inspector = document.getElementById("inspector")!;
    // inspector.classList.add("hidden");
    // // A route change invalidates the inspected line; an empty closed pane renders no reopen rail.
    // inspector.replaceChildren();
    resetDetailsPane();
    const drawer = document.getElementById("drawer")!;
    const segments = parseRouteSegments();
    const nextProject = segments[0] === "project" ? segments[1] : undefined;
    if (checkNavigationStartsNewProjectLoad(lastLoadedProject, nextProject)) {
        // Clear stale console output before new project's load begins (item 22).
        ensureProgressTerminal();
        progressTerminal!.clear();
        // item 66: a fresh load re-opens a collapsed console so its progress is visible.
        expandProgressConsole();
        // task 159: a project loading with no reveng-paths entry gets wizard screens 2–5.
        void maybeOfferProjectPathsWizard(nextProject!);
    }
    if (nextProject !== undefined) {
        lastLoadedProject = nextProject;
    }
    // Bare project route rewrites to timeline via replaceState (no extra history entry).
    if (segments[0] === "project") {
        if (segments.length === 2) {
            history.replaceState(null, "", routeToTimeline(segments[1]!));
            segments.push("timeline");
        }
    }
    // item 66: the fork layout keys off #rightcol.project-route (absent on #/, the timeline
    // chrome + details pane hide so #view and the console fill the column):
    // document.querySelector(".layout")!.classList.toggle("timeline-route", checkRouteIsTimeline(segments));
    document.getElementById("rightcol")!.classList.toggle("project-route", checkRouteIsTimeline(segments));
    // task 140: timeline pane header is project chrome, hidden on #/.
    document.getElementById("timeline-pane-header")!.hidden = !checkRouteIsTimeline(segments);
    // item 66: the fork sidebar (webapp/views/sidebar.ts) is rendered by renderTimelineView
    // itself — the old per-route project drawer is retired:
    // const refreshDrawer = () => renderProjectDrawer(drawer, segments[1]!, {
    //     activeJsonl: segments[2] === "jsonl" ? segments[3]
    //         : segments[2] === "timeline" && segments[3] === "session" ? segments[4] : undefined,
    //     activeTarget: segments[2] === "file" ? segments[3] : undefined,
    // });
    try {
        if (segments[0] === "project") {
            drawer.classList.remove("hidden");
            // item 66: was — await refreshDrawer();
        } else {
            drawer.classList.add("hidden");
            drawer.replaceChildren();   // item 66: the projects-list route leaves the drawer empty
        }
        if (segments.length === 0) {
            setToolbarTitle(undefined);   // item 66: was setBreadcrumb("")
            await renderProjectsView(pane);
        } else if (segments[0] === "project") {
            await renderProjectRoute(pane, segments, generation);
        } else {
            pane.append(el("div", { class: "error-box", text: `unknown route: ${location.hash}` }));
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;   // cancelled — console already logged it
        pane.append(el("div", { class: "error-box", text: String(error) }));
    }
    // item 66: was — a post-render refreshDrawer() so the old drawer's "Files touched" section
    // appeared without another navigation; renderTimelineView now builds the fork sidebar from
    // the freshly cached document in the same pass:
    // if (segments[0] === "project") {
    //     await refreshDrawer();
    // }
}

// Breadcrumb now only carries config-switch errors (item 66).
export function setBreadcrumb(text: string): void {
    document.getElementById("breadcrumb")!.textContent = text;
}

// item 66: toolbar title shows project name on project routes, plain "JFRED" otherwise.
function setToolbarTitle(project: string | undefined): void {
    const title = document.getElementById("toolbar-title")!;
    title.replaceChildren(el("a", { href: "#/", text: "JFRED", title: "JSONL File Reverse Engineer Debugger" }));
    if (project !== undefined) {
        title.append(" — project: ", el("b", { text: project }));
    }
    setBreadcrumb("");
}

