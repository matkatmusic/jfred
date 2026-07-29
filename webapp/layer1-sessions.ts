// Task 292: the JSONLs pane — the folder tree's selection rules applied to session transcripts.
//
// It filters the FILE LIST only; layer1-ranges.ts's band says which stretch a session owns. Never touches the stage.

import { el, getRequiredElementById } from "./app-dom.ts";
import { paintLoadbar, readLayer1ViewStream } from "./layer1-progress.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { readSourcePaths, SourceKind } from "./layer1-source-paths.ts";
import type { WireSession } from "./layer1-wire.ts";

let sessions: WireSession[] = [];
// Keyed by `fullPath`, not object identity: the list is re-fetched on every load.
const selectedPaths = new Set<string>();
// Every path the drawn view knows, RELATIVE to the project folder; empty = nothing known yet, show every session.
let knownProjectPaths = new Set<string>();
let projectFolderPrefix = "";

// Transcripts record ABSOLUTE paths; translate to the view's relative spelling, dropping paths outside the project on purpose.
function listSessionPathsInProject(session: WireSession): string[] {
    if (projectFolderPrefix === "") {
        return session.paths;
    }
    return session.paths
        .filter((path) => path.startsWith(projectFolderPrefix))
        .map((path) => path.slice(projectFolderPrefix.length));
}

// A session earns a row only if it touched a file this view draws (user, 2026-07-27).
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

// The union of picked sessions' paths in the view's spelling; empty means "not filtering".
export function listSessionFilterTargets(): string[] {
    return [...new Set(listSelectedSessions().flatMap(listSessionPathsInProject))];
}

// A filter from the previous project must not survive a new load.
export function resetSessionSelection(): void {
    selectedPaths.clear();
    sessions = [];
    knownProjectPaths = new Set();
}

// Fetch sessions under the picked JSONL folders; no folders = no fetch. Refusals report INTO the pane only.
export async function loadLayer1Sessions(): Promise<void> {
    const query = new URLSearchParams();
    for (const path of readSourcePaths(SourceKind.jsonl)) {
        query.append("jsonl", path);
    }
    sessions = [];
    if ([...query.keys()].length === 0) {
        return;
    }
    // Task 304: the scan bar replaces the pane's content, so the empty-state row can never lie mid-scan.
    const fill = el("div", { class: "loadbar-fill" });
    const label = el("span", { class: "loadbar-label", text: "scanning JSONL files" });
    getRequiredElementById("sessions").replaceChildren(el("div", { class: "loadbar pane-loadbar" }, [
        el("div", { class: "loadbar-track" }, [fill]),
        label,
    ]));
    query.append("progress", "1");
    try {
        const payload = await readLayer1ViewStream<{ sessions: WireSession[] }>(
            `/api/layer1-sessions?${query}`,
            (text, current, total) => paintLoadbar(fill, label, text, current, total),
        );
        sessions = payload?.sessions ?? [];
    } catch (error) {
        getRequiredElementById("sessions").replaceChildren(
            el("div", { class: "navempty", text: String(error) }),
        );
    }
}

// Plain click picks one; a re-click on the only pick clears; shift toggles just this one.
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
        // The day, then how much of the project this session touched — what decides a click.
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

// Draw the pane and wire its clear button; `onChange` is the page's re-filter (no-cycle, like `afterPick`).
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
    // Property assignment, not addEventListener: re-runs per load/click; a second listener would fire stale callbacks.
    clear.onclick = () => {
        selectedPaths.clear();
        redraw();
    };
}
