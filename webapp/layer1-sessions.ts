// Task 292: the JSONLs pane, below the File Nav. The folder tree's selection rules applied to session transcripts — a plain click picks one, a plain click on the only picked one clears it, shift extends (plans/layer1-mockup.html:1245-1271).
//
// What it filters is the FILE LIST: each surviving file keeps its WHOLE history, and the band webapp/layer1-ranges.ts draws over the canvas is what says which stretch of that history the session is answerable for. That is why this module reports targets and never touches the stage.

import { el, getRequiredElementById } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { readSourcePaths, SourceKind } from "./layer1-source-paths.ts";
import type { WireSession } from "./layer1-wire.ts";

let sessions: WireSession[] = [];
// Keyed by `fullPath`, not by the object: the list is re-fetched on every load, so an identity Set would silently lose its selection the moment the payload was replaced.
const selectedPaths = new Set<string>();
// Every path the drawn view knows about — the pairs plus both orphan buckets — as the view spells them: RELATIVE to the project folder. Empty until a view has been drawn, which reads as "nothing known yet" and shows every session rather than none.
let knownProjectPaths = new Set<string>();
let projectFolderPrefix = "";

// A transcript records ABSOLUTE paths; the Layer 1 view spells the same files relative to the project folder. Translating here is what lets the two be compared at all — and dropping the paths outside the project folder is deliberate: a session that only touched files elsewhere has nothing to say about this timeline.
function listSessionPathsInProject(session: WireSession): string[] {
    if (projectFolderPrefix === "") {
        return session.paths;
    }
    return session.paths
        .filter((path) => path.startsWith(projectFolderPrefix))
        .map((path) => path.slice(projectFolderPrefix.length));
}

// A session earns a row only if it touched at least one file this view draws (user, 2026-07-27): the pane lists the transcripts answerable for THIS project, not every transcript under the source folders.
function sessionTouchesTheProject(session: WireSession): boolean {
    if (knownProjectPaths.size === 0) {
        return true;
    }
    return listSessionPathsInProject(session).some((path) => knownProjectPaths.has(path));
}

export function listVisibleSessions(): WireSession[] {
    return sessions.filter(sessionTouchesTheProject);
}

// Told by the page once a view is drawn, so the pane can be narrowed to it.
export function setKnownProjectPaths(projectFolder: string, paths: readonly string[]): void {
    projectFolderPrefix = projectFolder === "" ? "" : `${projectFolder.replace(/\/$/, "")}/`;
    knownProjectPaths = new Set(paths);
}

export function listSelectedSessions(): WireSession[] {
    return listVisibleSessions().filter((session) => selectedPaths.has(session.fullPath));
}

// The union of every picked session's touched paths, in the view's own spelling so filterLayer1ViewByTargets can match them. Empty means "not filtering", which is exactly what that filter reads an empty target list as.
export function listSessionFilterTargets(): string[] {
    return [...new Set(listSelectedSessions().flatMap(listSessionPathsInProject))];
}

// A filter from the previous project must not survive a new load.
export function resetSessionSelection(): void {
    selectedPaths.clear();
    sessions = [];
    knownProjectPaths = new Set();
}

// Fetch the sessions under the picked JSONL source folders. No source folders means no fetch and no sessions. A refusal is reported INTO the pane and nowhere else: this pane is an accessory, never a reason the timeline cannot draw.
export async function loadLayer1Sessions(): Promise<void> {
    const query = new URLSearchParams();
    for (const path of readSourcePaths(SourceKind.jsonl)) {
        query.append("jsonl", path);
    }
    sessions = [];
    if ([...query.keys()].length === 0) {
        return;
    }
    try {
        const response = await fetch(`/api/layer1-sessions?${query}`);
        if (!response.ok) {
            throw new Error(await response.text());
        }
        sessions = (await response.json() as { sessions: WireSession[] }).sessions;
    } catch (error) {
        getRequiredElementById("sessions").replaceChildren(
            el("div", { class: "navempty", text: String(error) }),
        );
    }
}

// A plain click picks one; a plain click on the ONLY picked one clears it; shift toggles this one and leaves the rest alone.
function applySessionClick(fullPath: string, extend: boolean): void {
    if (extend) {
        if (!selectedPaths.delete(fullPath)) {
            selectedPaths.add(fullPath);
        }
        return;
    }
    const wasOnlySelection = selectedPaths.size === 1 && selectedPaths.has(fullPath);
    selectedPaths.clear();
    if (!wasOnlySelection) {
        selectedPaths.add(fullPath);
    }
}

function buildSessionItem(session: WireSession, onChange: () => void): HTMLElement {
    const item = el("div", { class: `session-item${selectedPaths.has(session.fullPath) ? " selected" : ""}` }, [
        el("div", { class: "sname", text: session.file }),
        // The day, then how much of the project this session touched — the two readings that decide whether it is worth clicking, in the width the pane has.
        el("div", { class: "smeta", text: `${formatInstantLabel(session.started).slice(0, 11)} · ${session.paths.length} files` }),
        el("div", { class: "smeta", text: session.title }),
    ]);
    item.title = `${session.title}\n${formatInstantLabel(session.started)} → ${formatInstantLabel(session.ended)}\n`
        + session.paths.join("\n");
    item.addEventListener("click", (event) => {
        applySessionClick(session.fullPath, event.shiftKey);
        onChange();
    });
    return item;
}

// Draw the pane and wire its clear button. `onChange` is the page's re-filter — passed in for the same no-cycle reason wireFolderPickers takes `afterPick`.
export function renderSessionPane(onChange: () => void): void {
    const host = getRequiredElementById("sessions");
    const redraw = (): void => {
        renderSessionPane(onChange);
        onChange();
    };
    const visible = listVisibleSessions();
    host.replaceChildren(...(visible.length > 0
        ? visible.map((session) => buildSessionItem(session, () => redraw()))
        : [el("div", { class: "navempty", text: "no JSONLs touched this project's files" })]));
    const clear = getRequiredElementById("clear-sessions") as HTMLButtonElement;
    clear.disabled = selectedPaths.size === 0;
    // Property assignment, not addEventListener: this runs again on every load and on every click, and a second listener would fire the previous render's callback as well.
    clear.onclick = () => {
        selectedPaths.clear();
        redraw();
    };
}
