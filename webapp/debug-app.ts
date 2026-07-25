// Per-file debug viewer skeleton (task 183): file selection over /api/file-ladder plus a
// deep-link per file (?project=<name>&file=<path>). A DEBUG surface — it may expose engine
// internals freely. Rendering the fetched revision ladder is task 184; the deep-linked boot
// only reports the revision count here.

import { el, getRequiredElementById } from "./app-dom.ts";

// The page's own path — every deep link routes back here.
const DEBUG_PAGE_PATH = "/app/debug.html";

// Set the one-line status text.
export function renderDebugStatus(text: string): void {
    getRequiredElementById("debug-status").textContent = text;
}

// One deep-link anchor per file, replacing the previous listing.
export function renderDebugFileList(projectName: string, files: string[]): void {
    const anchors = files.map((file) =>
        el("a", { href: `${DEBUG_PAGE_PATH}?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(file)}`, text: file }));
    getRequiredElementById("debug-file-list").replaceChildren(...anchors.map((anchor) => el("div", {}, [anchor])));
}

// Fetch the project's pickable final paths and list them as deep links.
async function loadFileList(projectName: string): Promise<void> {
    const response = await fetch(`/api/file-ladder?project=${encodeURIComponent(projectName)}`);
    if (!response.ok) {
        renderDebugStatus(`file list failed: ${await response.text()}`);
        return;
    }
    const listing = await response.json() as { files: string[] };
    renderDebugFileList(projectName, listing.files);
    renderDebugStatus("select a file to load its revision ladder");
}

// Fetch one file's revision ladder and report its size (task 184 renders it).
async function loadLadder(projectName: string, file: string): Promise<void> {
    const response = await fetch(`/api/file-ladder?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(file)}`);
    if (!response.ok) {
        renderDebugStatus(`ladder failed: ${await response.text()}`);
        return;
    }
    const ladder = await response.json() as { revisions: unknown[] };
    renderDebugStatus(`${file}: ${ladder.revisions.length} revision(s) loaded`);
}

// Boot for the three URL shapes: no project -> guidance; project -> the file list;
// project + file (a deep link) -> that file's ladder.
export async function bootDebugApp(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const projectName = params.get("project");
    if (projectName === null) {
        renderDebugStatus(`no project selected — open ${DEBUG_PAGE_PATH}?project=<name>`);
        return;
    }
    const file = params.get("file");
    if (file === null) {
        await loadFileList(projectName);
        return;
    }
    await loadLadder(projectName, file);
}

void bootDebugApp();
