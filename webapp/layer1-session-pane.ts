// Task 292: draw the JSONLs pane (rows, title search, clear button) from layer1-sessions.ts's state.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { listVisibleSessions, selectedPaths } from "./layer1-sessions.ts";
import type { WireSession } from "./layer1-wire.ts";

// Plain click picks one; a re-click on the only pick clears; shift toggles just this one.
function applySessionClick(fullPath: string, extend: boolean): void {
  if (extend) {
    const wasSelected = selectedPaths.delete(fullPath);
    if (!wasSelected) {
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
  const distinctTitles = [...new Set(session.titles)];
  const titleRows: HTMLElement[] = [];
  for (const title of distinctTitles) {
    titleRows.push(createElement("div", { class: "stitle", text: title }));
  }
  const item = createElement("div", { class: `session-item${selectedPaths.has(session.fullPath) ? " selected" : ""}` }, [
    createElement("div", { class: "sname", text: session.file }),
    ...titleRows,
    // The day, then how many project files this session touched.
    createElement("div", { class: "smeta", text: `${formatInstantLabel(session.started).slice(0, 11)} · ${session.paths.length} files` }),
  ]);
  item.title = [...distinctTitles, `${formatInstantLabel(session.started)} → ${formatInstantLabel(session.ended)}`,
    ...session.paths].join("\n");
  item.dataset.file = session.file;
  function applyRowClick(event: MouseEvent): void {
    applySessionClick(session.fullPath, event.shiftKey);
    onChange();
  }
  item.addEventListener("click", applyRowClick);
  return item;
}

function containsSearchText(session: WireSession, searchText: string): boolean {
  for (const title of session.titles) {
    const isHit = title.toLowerCase().includes(searchText);
    if (isHit) {
      return true;
    }
  }
  return false;
}

// Draw the pane and wire its clear button; `onChange` is the page's re-filter.
export function renderSessionPane(onChange: () => void): void {
  const host = getRequiredElementById("sessions");
  function refreshPane(): void {
    renderSessionPane(onChange);
    onChange();
  }
  const visible = listVisibleSessions();
  const searchBox = getRequiredElementById("session-search") as HTMLInputElement;
  const searchText = searchBox.value.trim().toLowerCase();
  const matching: WireSession[] = [];
  for (const session of visible) {
    const isMatch = searchText === "" || containsSearchText(session, searchText);
    if (isMatch) {
      matching.push(session);
    }
  }
  const rows: HTMLElement[] = [];
  if (visible.length === 0) {
    rows.push(createElement("div", { class: "navempty", text: "no JSONLs touched this project's files" }));
  }
  else if (matching.length === 0) {
    rows.push(createElement("div", { class: "navempty", text: "no matches" }));
  }
  else {
    for (const session of matching) {
      rows.push(buildSessionItem(session, refreshPane));
    }
  }
  host.replaceChildren(...rows);
  // The title search narrows this list only, not the timeline.
  searchBox.oninput = () => renderSessionPane(onChange);
  (getRequiredElementById("session-search-clear") as HTMLButtonElement).onclick = () => {
    searchBox.value = "";
    renderSessionPane(onChange);
  };
  const clear = getRequiredElementById("clear-sessions") as HTMLButtonElement;
  clear.disabled = selectedPaths.size === 0;
  // Property assignment, so a re-run never stacks a second listener.
  clear.onclick = () => {
    selectedPaths.clear();
    refreshPane();
  };
}
