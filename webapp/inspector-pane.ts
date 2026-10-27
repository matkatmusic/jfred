// Details pane builders for the JSON inspector: open the pane, tool-jump buttons, JSON body, snapshot drawer.

import { fetchJson } from "./app-fetch.ts";
import { renderCodeInto } from "./highlight.ts";
import {
  computeBlobRequestUrl,
  type LinkMaps,
  type WireBlobResponse,
  type WireFileHistory,
  type WireRevisionLink,
  type WireTrackedBackup,
  type WireValue,
} from "./inspector-links.ts";
import { createElement, renderHighlightedJson } from "./inspector-json.ts";
import { blobPresenceByKey, buildSnapshotDrawer } from "./inspector-snapshots.ts";

// Show the Details pane without touching its contents; diff and file modes paint their own columns.
export function openDetailsPane(): void {
  document.getElementById("inspector")!.classList.remove("hidden");
}

// item 66: the old build replaced the pane's children wholesale (collapse chevron + .inspector-content).
//     pane.classList.remove("collapsed");
//     const content = createElement("div", { class: "inspector-content" });
//     const collapseButton = createElement("button", { class: "row-btn inspector-close", text: "»", title: "Collapse inspector" });
//     collapseButton.onclick = () => toggleInspectorCollapsed(pane, collapseButton);
//     pane.replaceChildren(collapseButton, content);
// Open and clear the Details pane's right column for a JSON render; the diff toggle hides.
export function openInspectorPane(): HTMLElement {
  const pane = document.getElementById("inspector")!;
  // The 50%-width file-preview modifier is opt-in per open; callers wanting it re-add it.
  pane.classList.remove("file-preview-drawer");
  // A fresh open starts without the bottom snapshot drawer.
  pane.classList.remove("snapshot-drawer");
  openDetailsPane();
  document.getElementById("details-right-label")!.textContent = "JSON";
  document.getElementById("diff-mode-toggle")!.hidden = true;
  const body = document.getElementById("details-right-body")!;
  body.replaceChildren();
  return body;
}

// Append the hook/result jump buttons for the shown tool call (each only when its line exists).
export function appendToolNavigationButtons(toolTargets: { hookLine: number; resultLine: number }, toolButtons: HTMLElement[], renderLine: (line: number) => void): void {
  if (toolTargets.hookLine >= 0) {
    toolButtons.push(createElement("button", { class: "row-btn", text: "Go to PreToolUse hook", onclick: () => renderLine(toolTargets.hookLine) }));
  }
  if (toolTargets.resultLine >= 0) {
    toolButtons.push(createElement("button", { class: "row-btn", text: "Go to Tool Result", onclick: () => renderLine(toolTargets.resultLine) }));
  }
}

// Render the line's highlighted-JSON body (the non-formatted-text presentation).
export function buildHighlightedJsonBody(
  value: WireValue, clamped: number, maps: LinkMaps, renderLine: (line: number) => void,
  filesTouched: WireFileHistory[], openRevision: (link: WireRevisionLink) => void,
  sessionId: string, project: string | undefined,
  openSnapshotDrawer: (blobName: string, entry: WireTrackedBackup) => void,
): HTMLElement {
  // (item 23) old call: body = renderHighlightedJson(JSON.stringify(value, null, 4), value, clamped, maps, showLine, filesTouched, openRevision);
  return renderHighlightedJson(
    JSON.stringify(value, null, 4), value, clamped, maps, renderLine, filesTouched, openRevision,
    { sessionId, presenceByKey: blobPresenceByKey, project, openSnapshotDrawer },
  );
}

// Build the opener that fills the bottom drawer with one blob's verbatim content, JSON above and blob below.
export function createSnapshotDrawerOpener(sessionId: string): (blobName: string, entry: WireTrackedBackup) => Promise<void> {
  return async (blobName, entry) => {
    const result = await fetchJson(computeBlobRequestUrl(sessionId, blobName)) as WireBlobResponse;
    const pane = document.getElementById("inspector")!;
    // item 66: the content column is the static #details-right-body skeleton element.
    const content = document.getElementById("details-right-body");
    if (content === null) {
      return;
    }
    // Re-clicking a link while a drawer is open replaces the drawer's contents.
    pane.querySelector(".snapshot-pane")?.remove();
    pane.classList.add("snapshot-drawer");
    const snapshotText = createElement("pre", { class: "inspector-text" });
    renderCodeInto(snapshotText, result.content ?? "", entry.relativePath);
    const drawer = buildSnapshotDrawer(pane, entry, blobName, snapshotText);
    content.append(drawer);
  };
}
