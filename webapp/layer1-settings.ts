// Task 297: the Layer 1 page's saved project settings, written on demand and read back once at boot.
//
// The unload prompt is the browser's own; "discard" is just the reader leaving anyway.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { readSourcePaths, writeSourcePaths } from "./layer1-source-paths.ts";
import { SourceKind } from "./layer1-wire.ts";

// One saved project. `dir` is also the key it is stored under, so saving project A never disturbs project B.
interface Layer1ProjectSettings {
    dir: string;
    repo: string;
    branch: string;
    ref: string;
    jsonl: string[];
    fileHistory: string[];
    collapsedFolders?: string[];
}

let settingsDirty = false;

// Every saved project from the boot GET, so a project visited earlier is available without a second fetch.
let cachedProjectSettings: Record<string, Layer1ProjectSettings> = {};

export function getCollapsedFoldersForProject(dir: string): string[] {
    return cachedProjectSettings[dir]?.collapsedFolders ?? [];
}

// Folder-collapse state auto-saves independent of the dirty/Save-button flow, since it is navigation state, not a form field.
export function saveFolderCollapseState(collapsedFolders: string[]): void {
    const dir = getInputById("dir").value.trim();
    if (dir === "") {
        return;
    }
    cachedProjectSettings[dir] = { ...cachedProjectSettings[dir], dir, collapsedFolders } as Layer1ProjectSettings;
    void fetch("/api/layer1-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir, collapsedFolders }),
    }).catch(() => {});
}

// Something the saved record covers has moved: arm the button and drop the "saved" note, which is now describing an older state than the one on screen.
export function markSettingsDirty(): void {
    settingsDirty = true;
    (getRequiredElementById("save-settings") as HTMLButtonElement).disabled = false;
    getRequiredElementById("saved-note").textContent = "";
}

// A <select> that has not been populated yet reads "", which is the right value to save: no branch was chosen. getInputById would refuse it, so the selects are read directly.
function readSelectValue(id: string): string {
    return (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "";
}

function readCurrentSettings(): Layer1ProjectSettings {
    return {
        dir: getInputById("dir").value.trim(),
        repo: getInputById("repo").value.trim(),
        branch: readSelectValue("branch"),
        ref: getInputById("ref").value.trim(),
        jsonl: [...readSourcePaths(SourceKind.jsonl)],
        fileHistory: [...readSourcePaths(SourceKind.fileHistory)],
    };
}

async function saveSettings(): Promise<void> {
    const note = getRequiredElementById("saved-note");
    const response = await fetch("/api/layer1-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(readCurrentSettings()),
    });
    // A failed save leaves the button ARMED: nothing was written, so the page must not claim it was.
    if (!response.ok) {
        note.textContent = `save failed: ${await response.text()}`;
        return;
    }
    settingsDirty = false;
    (getRequiredElementById("save-settings") as HTMLButtonElement).disabled = true;
    note.textContent = "saved";
}

// Fill the page from the last saved project, or from .config/debugConfig.json's defaults, and report whether it filled anything.
//
// Precedence is PER FIELD, not per record: a link naming ?dir= and ?repo= must render those two, but it says nothing about the source lists, and blanking the whole restore over it is what left the headless harness — which always navigates with a query string — running on one derived JSONL folder instead of the three the config names.
export async function restoreSavedSettings(): Promise<boolean> {
    const url = new URLSearchParams(location.search);
    const response = await fetch("/api/layer1-settings");
    if (!response.ok) {
        return false;
    }
    const saved = await response.json() as {
        lastDir?: string | null;
        projects?: Record<string, Layer1ProjectSettings>;
        defaults?: Partial<Layer1ProjectSettings>;
    };
    cachedProjectSettings = saved.projects ?? {};
    // A saved project beats the debugConfig.json defaults, which beat nothing at all. Each field falls back independently, so a config naming only `dir` still contributes that one box.
    const project = saved.lastDir == null ? undefined : saved.projects?.[saved.lastDir];
    const chosen = project ?? saved.defaults;
    if (chosen === undefined) {
        return false;
    }
    fillBoxUnlessUrlNamesIt(url, "dir", chosen.dir);
    fillBoxUnlessUrlNamesIt(url, "repo", chosen.repo);
    fillBoxUnlessUrlNamesIt(url, "ref", chosen.ref);
    // A restored or configured list is deliberate, so it must NOT be re-derived from the project folder — that is exactly what `touched` means to layer1-source-paths.ts. The param names are the ones readSourceParams writes, so a link carrying its own lists still wins.
    if (chosen.jsonl !== undefined && !url.has("jsonl")) {
        writeSourcePaths(SourceKind.jsonl, [...chosen.jsonl]);
    }
    if (chosen.fileHistory !== undefined && !url.has("snapshots")) {
        writeSourcePaths(SourceKind.fileHistory, [...chosen.fileHistory]);
    }
    return true;
}

// The URL wins for the fields it names; an absent value leaves the box alone rather than blanking it.
function fillBoxUnlessUrlNamesIt(url: URLSearchParams, id: string, value: string | undefined): void {
    if (value !== undefined && !url.has(id)) {
        getInputById(id).value = value;
    }
}

// The boxes on the sources rows are part of the same saved record as the two lists, so editing one arms the button exactly as committing a list does.
const DIRTYING_INPUT_IDS = ["dir", "repo", "ref"];
const DIRTYING_SELECT_IDS = ["branch", "commit"];

export function wireSettingsSave(): void {
    getRequiredElementById("save-settings").addEventListener("click", () => { void saveSettings(); });
    for (const id of DIRTYING_INPUT_IDS) {
        getInputById(id).addEventListener("input", markSettingsDirty);
    }
    for (const id of DIRTYING_SELECT_IDS) {
        document.getElementById(id)?.addEventListener("change", markSettingsDirty);
    }
    window.addEventListener("beforeunload", (event) => {
        if (settingsDirty) {
            event.preventDefault();
        }
    });
}
