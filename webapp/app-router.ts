// Hash-route render dispatch. The header wiring (toolbar popovers + the runtime-switchable
// folders) lives in app-header.ts (task 115 split); it shares the lastLoadedProject
// console-ownership state through resetLastLoadedProject.

import { el } from "./app-dom.ts";
import { ensureProgressTerminal, expandProgressConsole, progressTerminal } from "./app-console.ts";
import { inflightLoadController } from "./app-fetch.ts";
import { checkRouteIsTimeline, parseRouteSegments, routeToTimeline } from "./app-routes.ts";
import { renderSubRouteDrawer, resetDetailsPane } from "./app-drawer.ts";
import { maybeOfferProjectPathsWizard } from "./app-paths-project.ts";
import { renderProjectsView } from "./views/projects.ts";
import { renderTimelineView } from "./views/timeline.ts";

// The project whose load output currently fills the progress console; undefined before any
// project load. Set by renderRoute, reset by the projects-folder switch.
let lastLoadedProject: string | undefined;

// Forget the loaded project after a projects-folder switch (app-header.ts) — every project is
// then a fresh load from the new folder, even under an identical name.
export function resetLastLoadedProject(): void {
    lastLoadedProject = undefined;
}

// task 138: monotonically increasing navigation stamp — a run whose stamp is no longer the
// newest must not touch shared chrome (the details drawer) after its awaits resolve.
let renderRouteGeneration = 0;

// True when a newer renderRoute run has started since `generation` was stamped.
function checkRouteRenderIsStale(generation: number): boolean {
    return generation !== renderRouteGeneration;
}

// True only when a navigation starts loading a project DIFFERENT from the one whose output
// fills the console. Same-project sub-route hops and non-project routes keep the console
// (TASKS item 22: clear on new project/session load, not on every navigation).
export function checkNavigationStartsNewProjectLoad(previousProject: string | undefined, nextProject: string | undefined): boolean {
    if (nextProject === undefined) {
        return false;
    }
    return nextProject !== previousProject;
}

// The project-route arm of renderRoute's dispatch, extracted so its anchor ternaries sit one
// indent level shallower (deep-nesting flag at the old depth).
async function renderProjectRoute(view: HTMLElement, segments: string[], generation: number): Promise<void> {
    const project = segments[1]!;
    setToolbarTitle(project);   // item 66: was setBreadcrumb(project)
    // The timeline is ALWAYS a loaded project's base view (user decision 2026-07-06):
    // jsonl and file sub-routes keep their URLs but render as a drawer over it.
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
    // task 138: each run owns a fresh pane, swapped in atomically. Two overlapping runs used to
    // clear-then-append into the SAME element and both appends landed (duplicate projects list);
    // now a superseded run's late appends land in its own detached pane and are never seen.
    const pane = el("div");
    view.replaceChildren(pane);
    view.onclick = null;
    // item 73: the consent dialog hides #toggle-all while its header owns Expand All; every
    // navigation restores the skeleton button before the next view wires or ignores it.
    (document.getElementById("toggle-all") as HTMLButtonElement).hidden = false;
    // task 114: the event-type filter bar is timeline-only; every navigation re-hides it and
    // renderTimelineFilterBar unhides it (reset back to "All") when a timeline renders.
    document.getElementById("timeline-filter-bar")!.hidden = true;
    // task 157: the header's Re-ask-baseline button is project chrome like the filter bar —
    // re-hidden here, unhidden by renderTimelineFilterBar when a baseline answer is stored.
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
        // A different project's load is starting: the retained output belongs to the previous
        // project, so clear before the first line of this load lands (TASKS item 22).
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
    // The project's default view is the revision timeline, not the summary landing pane. The
    // bare route is rewritten (replaceState: no history entry, no hashchange re-render) so the
    // consent dialog's re-render and reloads both land on the timeline route.
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
    // task 140: the Timeline pane header is timeline-route chrome, exactly like the
    // project-route class above — hidden on #/ (the projects view brings its own pane title).
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

// The breadcrumb span now only carries the config-switch error (item 66); the current
// project shows in the toolbar title instead.
export function setBreadcrumb(text: string): void {
    document.getElementById("breadcrumb")!.textContent = text;
}

// item 66: mockup toolbar title — "JFRED — project: <b>name</b>" on project routes, plain
// "JFRED" (still a home link) otherwise. Replaces the per-route breadcrumb, so any stale
// config-error text clears with it.
function setToolbarTitle(project: string | undefined): void {
    const title = document.getElementById("toolbar-title")!;
    title.replaceChildren(el("a", { href: "#/", text: "JFRED", title: "JSONL File Reverse Engineer Debugger" }));
    if (project !== undefined) {
        title.append(" — project: ", el("b", { text: project }));
    }
    setBreadcrumb("");
}
