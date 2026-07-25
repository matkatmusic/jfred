// Per-file debug viewer (task 183 skeleton, task 184 ladder rendering): file selection over
// /api/file-ladder plus a deep-link per file (?project=<name>&file=<path>), and the selected
// file's revision ladder rendered as a plain ordered list. A DEBUG surface — it may expose
// engine internals freely (source attribution, conflict notes, seed hashes).

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

// The wire form of one file's revision ladder — what JSON.parse yields from
// /api/file-ladder?file=: Path/Uuid arrive as plain strings and Dates as ISO text, so this is
// NOT the engine's FileHistory (precedent: WireLayeredGraph in layered-app.ts).
interface WireFileRevision {
    kind: string;
    changeId: string;
    timestamp: string;
    unrecoverable?: { reason: string };
}

interface WireFileLadder {
    target: string;
    revisions: WireFileRevision[];
}

// A `gitBase:<hash>:<target>` changeId marks a base-commit seed (reconstruction_base_commit.ts);
// its hash is the commit this revision was seeded from. Any other changeId has no seed.
const SEED_CHANGE_ID_PREFIX = "gitBase:";

function extractSeedHash(changeId: string): string | undefined {
    if (!changeId.startsWith(SEED_CHANGE_ID_PREFIX)) {
        return undefined;
    }
    return changeId.slice(SEED_CHANGE_ID_PREFIX.length).split(":")[0];
}

// The definition rows for one revision: source attribution (the event kind that produced it plus
// its changeId — the only per-revision provenance the ladder carries) and the timestamp always,
// the seed hash and the conflict note only where the revision has them.
function buildRevisionRows(revision: WireFileRevision): (Node | string)[] {
    const rows: (Node | string)[] = [
        el("dt", { text: "source" }),
        el("dd", { class: "debug-source", text: `${revision.kind} (${revision.changeId})` }),
        el("dt", { text: "time" }),
        el("dd", { class: "debug-time", text: revision.timestamp }),
    ];
    const seedHash = extractSeedHash(revision.changeId);
    if (seedHash !== undefined) {
        rows.push(el("dt", { text: "seed" }), el("dd", { class: "debug-seed", text: seedHash }));
    }
    if (revision.unrecoverable !== undefined) {
        rows.push(el("dt", { text: "conflict" }), el("dd", { class: "debug-conflict", text: revision.unrecoverable.reason }));
    }
    return rows;
}

// Render the ladder as an ordered list — the <li> position IS the revision index — replacing any
// previously rendered ladder.
export function renderDebugLadder(ladder: WireFileLadder): void {
    const items = ladder.revisions.map((revision) => el("li", {}, [el("dl", {}, buildRevisionRows(revision))]));
    getRequiredElementById("debug-ladder").replaceChildren(...items);
}

// Fetch one file's revision ladder and render it.
async function loadLadder(projectName: string, file: string): Promise<void> {
    const response = await fetch(`/api/file-ladder?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(file)}`);
    if (!response.ok) {
        renderDebugStatus(`ladder failed: ${await response.text()}`);
        return;
    }
    const ladder = await response.json() as WireFileLadder;
    renderDebugLadder(ladder);
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
