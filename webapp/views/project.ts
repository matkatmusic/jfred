// Project navigation: a persistent left drawer on every #/project/* route (the project's
// JSONL files and touched files stay reachable from the conversation/file/raw views), and
// the project landing view, which hosts the script-consent dialog and a summary.
// The view-model half is DOM-free and tested against scenario ground truth (viewer-project-views.test.ts).

import { el as elUntyped } from "../app-dom.ts";
import {
    fetchDocument,
    fetchJson,
    peekCachedDocument,
} from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { routeToFileHistory, routeToProject, routeToTimeline } from "../app-routes.ts";

// app.ts is being typed in parallel; typed view of its untyped `el` for this file's call sites.
const el = elUntyped as (
    tag: string,
    attrs?: Record<string, unknown>,
    children?: readonly (Node | string)[],
) => HTMLElement;

// Wire shapes (JSON off the server: ids/paths/dates are plain strings), minimal to this file's use.
type WireFileHistory = { target: string };
type WireDocument = { filesTouched: WireFileHistory[]; messages: unknown[] };
type WireJsonlFile = { fileName: string; sizeBytes: number; modifiedAt: string };
type WireProjectListing = { name: string; jsonlFiles: WireJsonlFile[] };

// Pure view model for the project view (no DOM): every reconstructed file target across the
// project's (possibly many) JSONLs, sorted, for the files-touched tree pane.
export function buildProjectViewModel(document: WireDocument): { fileTargets: string[] } {
    return { fileTargets: document.filesTouched.map((history) => history.target).sort() };
}

// Group targets by their directory for the tree pane.
// ponytail: dirname grouping, not a nested collapsing tree — upgrade if deep hierarchies get unreadable.
function groupTargetsByDirectory(fileTargets: readonly string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const target of fileTargets) {
        const slash = target.lastIndexOf("/");
        const directory = slash < 0 ? "" : target.slice(0, slash);
        if (!groups.has(directory)) groups.set(directory, []);
        groups.get(directory)!.push(target);
    }
    return groups;
}

// The left drawer: JSONL files always (cheap listing); touched files only once the project's
// unified document is already cached (never forces a whole-project build just for navigation).
export async function renderProjectDrawer(
    drawer: HTMLElement,
    project: string,
    { activeJsonl, activeTarget }: { activeJsonl?: string; activeTarget?: string },
): Promise<void> {
    drawer.replaceChildren();
    // Collapse state is the `collapsed` class on the persistent #drawer element, so it survives
    // this replaceChildren-based re-render and resets on page reload (deliberately unpersisted).
    const toggleButton = el("button", {
        class: "row-btn drawer-toggle",
        text: drawer.classList.contains("collapsed") ? "»" : "«",
        title: "Collapse/expand files drawer",
        onclick: () => {
            const collapsed = drawer.classList.toggle("collapsed");
            toggleButton.textContent = collapsed ? "»" : "«";
        },
    });
    drawer.append(toggleButton);
    const listing = ((await fetchJson("/api/projects")) as WireProjectListing[]).find((entry) => entry.name === project);
    if (listing === undefined) return;
    drawer.append(el("div", { class: "pane-title" }, [el("a", { href: routeToProject(project), text: project })]));

    drawer.append(el("div", { class: "drawer-section-title", text: `JSONL files (${listing.jsonlFiles.length})` }));
    // The default view: a JSONL opens the project-wide revision timeline anchored at its session.
    // Direct #/…/jsonl/<f> URLs still render the conversation view (bookmarks stay valid); the
    // conversation stays reachable via the timeline's session-header links and inspector jumps.
    for (const entry of listing.jsonlFiles) {
        drawer.append(el("a", {
            class: `drawer-item${entry.fileName === activeJsonl ? " active" : ""}`,
            href: routeToTimeline(project, entry.fileName, undefined),
            text: entry.fileName,
            title: `${entry.sizeBytes} B · ${new Date(entry.modifiedAt).toLocaleString()}`,
        }));
    }

    const cachedDocument = peekCachedDocument<WireDocument>(project);
    if (cachedDocument === undefined) return;
    const viewModel = buildProjectViewModel(cachedDocument);
    drawer.append(el("div", { class: "drawer-section-title", text: `Files touched (${viewModel.fileTargets.length})` }));
    for (const [directory, targets] of groupTargetsByDirectory(viewModel.fileTargets)) {
        drawer.append(el("div", { class: "tree-dir", text: directory === "" ? "/" : directory }));
        for (const target of targets) {
            drawer.append(el("a", {
                class: `drawer-item drawer-file${target === activeTarget ? " active" : ""}`,
                href: routeToFileHistory(project, target),
                text: target.slice(target.lastIndexOf("/") + 1),
            }));
        }
    }
}

// The project landing view (#/project/<name>): builds the unified document (hosting the
// consent dialog when scripts need a decision) and shows a summary; the drawer is the nav.
export async function renderProjectView(container: HTMLElement, project: string): Promise<void> {
    const result = await fetchDocument<WireDocument>(project, undefined);
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    const viewModel = buildProjectViewModel(result.document!);
    container.append(el("div", { class: "pane-title", text: project }));
    container.append(el("div", { class: "muted", text: `${result.document!.messages.length} conversation turns · ${viewModel.fileTargets.length} files touched · pick a JSONL or file on the left` }));
}

