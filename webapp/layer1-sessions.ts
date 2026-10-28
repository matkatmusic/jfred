// Task 292: the JSONLs pane's session list and selection state; never touches the stage.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { readLayer1ViewStream, renderLoadbar } from "./layer1-progress.ts";
import { readSourcePaths } from "./layer1-source-paths.ts";
import { SourceKind } from "./layer1-wire.ts";
import type { WireSession } from "./layer1-wire.ts";

let sessions: WireSession[] = [];
// Keyed by `fullPath`, not object identity: the list is re-fetched on every load.
export const selectedPaths = new Set<string>();
// Paths the drawn view knows, relative to the project folder; empty shows every session.
let knownProjectPaths = new Set<string>();
let projectFolderPrefix = "";

// Transcripts record absolute paths; make them relative and drop paths outside the project.
export function listSessionPathsInProject(session: WireSession): string[] {
  if (projectFolderPrefix === "") {
    return session.paths;
  }
  const relativePaths: string[] = [];
  for (const path of session.paths) {
    const isInProject = path.startsWith(projectFolderPrefix);
    if (isInProject) {
      relativePaths.push(path.slice(projectFolderPrefix.length));
    }
  }
  return relativePaths;
}

// A session earns a row only if it touched a file this view draws (user, 2026-07-27).
function containsKnownProjectPath(session: WireSession): boolean {
  if (knownProjectPaths.size === 0) {
    return true;
  }
  for (const path of listSessionPathsInProject(session)) {
    const isKnown = knownProjectPaths.has(path);
    if (isKnown) {
      return true;
    }
  }
  return false;
}

export function listVisibleSessions(): WireSession[] {
  const visible: WireSession[] = [];
  for (const session of sessions) {
    const isVisible = containsKnownProjectPath(session);
    if (isVisible) {
      visible.push(session);
    }
  }
  return visible;
}

// Told by the page once a view is drawn, so the pane can be narrowed to it.
export function setKnownProjectPaths(projectFolder: string, paths: readonly string[]): void {
  projectFolderPrefix = projectFolder === "" ? "" : `${projectFolder.replace(/\/$/, "")}/`;
  knownProjectPaths = new Set(paths);
}

export function listSelectedSessions(): WireSession[] {
  const selected: WireSession[] = [];
  for (const session of listVisibleSessions()) {
    const isSelected = selectedPaths.has(session.fullPath);
    if (isSelected) {
      selected.push(session);
    }
  }
  return selected;
}

// The union of picked sessions' paths; empty means not filtering.
export function listSessionFilterTargets(): string[] {
  const targets = new Set<string>();
  for (const session of listSelectedSessions()) {
    for (const path of listSessionPathsInProject(session)) {
      targets.add(path);
    }
  }
  return [...targets];
}

// A filter from the previous project must not survive a new load.
export function resetSessionSelection(): void {
  selectedPaths.clear();
  sessions = [];
  knownProjectPaths = new Set();
  // Empty the pane now so the prior project's rows never show during the new build.
  getRequiredElementById("sessions").replaceChildren();
}

// Fetch sessions under the picked JSONL folders; no folders means no fetch.
export async function loadLayer1Sessions(): Promise<void> {
  const query = new URLSearchParams();
  const folderPaths = readSourcePaths(SourceKind.jsonl);
  for (const path of folderPaths) {
    query.append("jsonl", path);
  }
  sessions = [];
  if (folderPaths.length === 0) {
    return;
  }
  // The scan bar replaces the pane content, so the empty row never shows mid-scan.
  const fill = createElement("div", { class: "loadbar-fill" });
  const label = createElement("span", { class: "loadbar-label", text: "scanning JSONL files" });
  getRequiredElementById("sessions").replaceChildren(createElement("div", { class: "loadbar pane-loadbar" }, [
    createElement("div", { class: "loadbar-track" }, [fill]),
    label,
  ]));
  query.append("progress", "1");
  function renderScanProgress(text: string, current?: number, total?: number): void {
    renderLoadbar(fill, label, text, current, total);
  }
  try {
    const payload = await readLayer1ViewStream<{ sessions: WireSession[] }>(`/api/layer1-sessions?${query}`, renderScanProgress);
    sessions = payload?.sessions ?? [];
  }
  catch (error) {
    getRequiredElementById("sessions").replaceChildren(
      createElement("div", { class: "navempty", text: String(error) }),
    );
  }
}
