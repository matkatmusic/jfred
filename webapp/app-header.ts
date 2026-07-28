// ─── header: toolbar popovers (item 66) + the runtime-switchable folders (item 46) ────── Split from app-router.ts (task 115). initializeHeader calls back into the router (renderRoute, setBreadcrumb, resetLastLoadedProject), so the dependency direction is header → router.

import { el } from "./app-dom.ts";
import { reconcileServerBootId } from "./app-choices.ts";
import { documentCache, fetchJson, rawLinesCache } from "./app-fetch.ts";
import { routeToProject } from "./app-routes.ts";
import { renderRoute, resetLastLoadedProject, setBreadcrumb } from "./app-router.ts";

// The /api/config payload (wire shape: paths as plain strings). bootId stamps the server launch — see reconcileServerBootId (item 82: re-prompt for consent after a server relaunch).
type WireConfig = { projectsDir: string; fileHistoryDir: string; bootId: string };

// The /api/projects payload rows, as far as the Projects menu reads them.
type WireProjectListing = { name: string };

// Native macOS folder picker — fills the input; the popover's apply/store buttons still apply it. Empty path = user cancelled; leave the field alone. Module-level export so the task-137 repo field (app-paths-project.ts) reuses it.
export async function pickFolderInto(target: HTMLInputElement): Promise<void> {
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
}

// The last server-reported effective file-history dir. An UNEDITED field posts "" so the server re-derives from the (possibly new) projects folder — otherwise the old derived value would pin itself as an explicit override across folder switches (item 46).  (Hoisted out of initializeHeader for task 153: the prefill restore below needs it.)
let reportedFileHistoryDir = "";

// task 153: the per-project fileHistory override currently prefilled into the task-136 field ("" = none). Lets computeFileHistoryDirToPost treat the prefilled value as UNEDITED (post "" = derive) and lets the next popover open restore the derived state.
let prefilledProjectOverrideDir = "";

// task 153: surface a stored per-project fileHistory override in the task-136 field on popover open. No override restores the derived state ONLY when a prefill is active — a user's manual explicit-override gesture is never clobbered.
export function prefillFileHistoryOverrideField(overrideDir: string | undefined): void {
    const fileHistoryFields = document.getElementById("file-history-fields")!;
    const fileHistoryInput = document.getElementById("file-history-dir-input") as HTMLInputElement;
    if (overrideDir !== undefined) {
        fileHistoryFields.hidden = false;
        fileHistoryInput.value = overrideDir;
        prefilledProjectOverrideDir = overrideDir;
        return;
    }
    if (prefilledProjectOverrideDir === "") {
        return;
    }
    fileHistoryFields.hidden = true;
    fileHistoryInput.value = reportedFileHistoryDir;
    prefilledProjectOverrideDir = "";
}

// Both toolbar popovers close together — opening one, picking a project, applying a folder change, or any document-level click funnels through here (the mockup's pattern).
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
    // item 66: popover model — the two toolbar buttons toggle their popovers; a document-level click closes both (in-popover clicks stopPropagation to stay open).
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
    // Clicks inside the paths popover (typing in the inputs) must not reach the document-level closer — EXCEPT the apply button, whose click closes the popover on its way up.
    pathsPopover.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).id !== "projects-dir-change") {
            event.stopPropagation();
        }
    });
    document.addEventListener("click", hideToolbarPopovers);
    const input = document.getElementById("projects-dir-input") as HTMLInputElement;
    const fileHistoryInput = document.getElementById("file-history-dir-input") as HTMLInputElement;
    // task 136: the file-history field hides behind a toggle — hidden means "derive from the projects folder"; showing the field is the explicit-override gesture.
    const fileHistoryFields = document.getElementById("file-history-fields")!;
    document.getElementById("file-history-toggle")!.addEventListener("click", () => {
        fileHistoryFields.hidden = !fileHistoryFields.hidden;
    });
    const applyConfig = (config: WireConfig): void => {
        input.value = config.projectsDir;
        fileHistoryInput.value = config.fileHistoryDir;
        reportedFileHistoryDir = config.fileHistoryDir;
    };
    const config = await fetchJson<WireConfig>("/api/config");
    // Runs inside initializeHeader, before the bootstrap's renderRoute — so a relaunched server drops stale consent choices before the first document load can read them (item 82).
    reconcileServerBootId(config.bootId);
    applyConfig(config);
    // task 136: while the file-history fields are hidden the dir is DERIVED — always post "" so the server re-derives from the projects folder (the item-46 convention).
    const computeFileHistoryDirToPost = (): string => {
        if (fileHistoryFields.hidden) {
            return "";
        }
        if (fileHistoryInput.value === reportedFileHistoryDir) {
            return "";
        }
        // task 153: an unedited prefilled per-project override is not a global-override gesture.
        if (fileHistoryInput.value === prefilledProjectOverrideDir) {
            return "";
        }
        return fileHistoryInput.value;
    };
    document.getElementById("projects-dir-change")!.addEventListener("click", async () => {
        const fileHistoryDir = computeFileHistoryDirToPost();
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
        // The server echoes the effective dirs — the file-history field prepopulates with the value derived from the newly selected projects folder.
        applyConfig(await response.json() as WireConfig);
        documentCache.clear();
        rawLinesCache.clear();
        // Every project is a fresh load from the new folder, even under an identical name.
        resetLastLoadedProject();
        location.hash = "#/";
        renderRoute();
    });
    document.getElementById("projects-dir-open")!.addEventListener("click", () => void pickFolderInto(input));
    document.getElementById("file-history-dir-open")!.addEventListener("click", () => void pickFolderInto(fileHistoryInput));
}
