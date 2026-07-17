// Hash-route render dispatch plus the header wiring (toolbar popovers + the runtime-switchable
// folders). renderRoute and initializeHeader share the lastLoadedProject console-ownership state,
// so they live together.

import { el } from "./app-dom.ts";
import { ensureProgressTerminal, expandProgressConsole, progressTerminal } from "./app-console.ts";
import {
    documentCache,
    fetchJson,
    inflightLoadController,
    rawLinesCache,
    reconcileServerBootId,
} from "./app-fetch.ts";
import { checkRouteIsTimeline, parseRouteSegments, routeToProject, routeToTimeline } from "./app-routes.ts";
import { renderSubRouteDrawer, resetDetailsPane } from "./app-drawer.ts";
import { renderProjectsView } from "./views/projects.ts";
import { renderTimelineView } from "./views/timeline.ts";

// The project whose load output currently fills the progress console; undefined before any
// project load. Set by renderRoute, reset by the projects-folder switch.
let lastLoadedProject: string | undefined;

// True only when a navigation starts loading a project DIFFERENT from the one whose output
// fills the console. Same-project sub-route hops and non-project routes keep the console
// (TASKS item 22: clear on new project/session load, not on every navigation).
export function checkNavigationStartsNewProjectLoad(previousProject: string | undefined, nextProject: string | undefined): boolean {
    if (nextProject === undefined) {
        return false;
    }
    return nextProject !== previousProject;
}

export async function renderRoute(): Promise<void> {
    inflightLoadController?.abort();   // navigation tears down any in-flight load
    const view = document.getElementById("view")!;
    view.replaceChildren();
    view.onclick = null;
    // item 73: the consent dialog hides #toggle-all while its header owns Expand All; every
    // navigation restores the skeleton button before the next view wires or ignores it.
    (document.getElementById("toggle-all") as HTMLButtonElement).hidden = false;
    // task 114: the event-type filter bar is timeline-only; every navigation re-hides it and
    // renderTimelineFilterBar unhides it (reset back to "All") when a timeline renders.
    document.getElementById("timeline-filter-bar")!.hidden = true;
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
            await renderProjectsView(view);
        } else if (segments[0] === "project") {
            const project = segments[1]!;
            setToolbarTitle(project);   // item 66: was setBreadcrumb(project)
            // The timeline is ALWAYS a loaded project's base view (user decision 2026-07-06):
            // jsonl and file sub-routes keep their URLs but render as a drawer over it.
            const anchorJsonl = segments[2] === "timeline" && segments[3] === "session" ? segments[4]
                : segments[2] === "jsonl" ? segments[3] : undefined;
            const anchorLine = segments[2] === "timeline" && segments[5] === "at" ? segments[6] : undefined;
            await renderTimelineView(view, project, anchorJsonl, anchorLine);
            await renderSubRouteDrawer(project, segments);
        } else {
            view.append(el("div", { class: "error-box", text: `unknown route: ${location.hash}` }));
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;   // cancelled — console already logged it
        view.append(el("div", { class: "error-box", text: String(error) }));
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
function setBreadcrumb(text: string): void {
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

// ─── header: toolbar popovers (item 66) + the runtime-switchable folders (item 46) ──────

// The /api/config payload (wire shape: paths as plain strings). bootId stamps the server launch —
// see reconcileServerBootId (item 82: re-prompt for consent after a server relaunch).
type WireConfig = { projectsDir: string; fileHistoryDir: string; bootId: string };

// The /api/projects payload rows, as far as the Projects menu reads them.
type WireProjectListing = { name: string };

// Both toolbar popovers close together — opening one, picking a project, applying a folder
// change, or any document-level click funnels through here (the mockup's pattern).
function hideToolbarPopovers(): void {
    document.getElementById("projects-menu")!.hidden = true;
    document.getElementById("paths-popover")!.hidden = true;
}

// Fill the Projects dropdown with one navigating row per project in the active folder.
async function populateProjectsMenu(menu: HTMLElement): Promise<void> {
    const projects = await fetchJson<WireProjectListing[]>("/api/projects");
    menu.replaceChildren(...projects.map((project) => el("div", {
        class: "menu-item",
        text: project.name,
        onclick: () => {
            hideToolbarPopovers();
            location.hash = routeToProject(project.name);
        },
    })));
}

export async function initializeHeader(): Promise<void> {
    // item 66: popover model — the two toolbar buttons toggle their popovers; a document-level
    // click closes both (in-popover clicks stopPropagation to stay open).
    const projectsMenu = document.getElementById("projects-menu")!;
    const pathsPopover = document.getElementById("paths-popover")!;
    document.getElementById("projects-btn")!.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasHidden = projectsMenu.hidden;
        hideToolbarPopovers();
        projectsMenu.hidden = !wasHidden;
        if (!projectsMenu.hidden) {
            void populateProjectsMenu(projectsMenu);
        }
    });
    document.getElementById("paths-btn")!.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasHidden = pathsPopover.hidden;
        hideToolbarPopovers();
        pathsPopover.hidden = !wasHidden;
    });
    // Clicks inside the paths popover (typing in the inputs) must not reach the document-level
    // closer — EXCEPT the apply button, whose click closes the popover on its way up.
    pathsPopover.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).id !== "projects-dir-change") {
            event.stopPropagation();
        }
    });
    document.addEventListener("click", hideToolbarPopovers);
    const input = document.getElementById("projects-dir-input") as HTMLInputElement;
    const fileHistoryInput = document.getElementById("file-history-dir-input") as HTMLInputElement;
    // The last server-reported effective file-history dir. An UNEDITED field posts "" so the
    // server re-derives from the (possibly new) projects folder — otherwise the old derived
    // value would pin itself as an explicit override across folder switches (item 46).
    let reportedFileHistoryDir = "";
    const applyConfig = (config: WireConfig): void => {
        input.value = config.projectsDir;
        fileHistoryInput.value = config.fileHistoryDir;
        reportedFileHistoryDir = config.fileHistoryDir;
    };
    const config = await fetchJson<WireConfig>("/api/config");
    // Runs inside initializeHeader, before the bootstrap's renderRoute — so a relaunched server drops
    // stale consent choices before the first document load can read them (item 82).
    reconcileServerBootId(config.bootId);
    applyConfig(config);
    document.getElementById("projects-dir-change")!.addEventListener("click", async () => {
        const fileHistoryDir = fileHistoryInput.value === reportedFileHistoryDir ? "" : fileHistoryInput.value;
        const response = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectsDir: input.value, fileHistoryDir }),
        });
        if (!response.ok) {
            // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
            setBreadcrumb(`could not switch folder: ${(await response.json()).error}`);
            return;
        }
        // The server echoes the effective dirs — the file-history field prepopulates with the
        // value derived from the newly selected projects folder.
        applyConfig(await response.json() as WireConfig);
        documentCache.clear();
        rawLinesCache.clear();
        // Every project is a fresh load from the new folder, even under an identical name.
        lastLoadedProject = undefined;
        location.hash = "#/";
        renderRoute();
    });
    // Native macOS folder picker — fills the input; "Change folder…" still applies it.
    // Empty path = user cancelled; leave the field alone.
    const pickFolderInto = async (target: HTMLInputElement): Promise<void> => {
        const response = await fetch(`/api/pick-folder?current=${encodeURIComponent(target.value)}`);
        if (!response.ok) {
            // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
            setBreadcrumb(`folder picker failed: ${await response.text()}`);
            return;
        }
        const { path } = await response.json() as { path: string };
        if (path !== "") {
            target.value = path;
        }
    };
    document.getElementById("projects-dir-open")!.addEventListener("click", () => void pickFolderInto(input));
    document.getElementById("file-history-dir-open")!.addEventListener("click", () => void pickFolderInto(fileHistoryInput));
}
