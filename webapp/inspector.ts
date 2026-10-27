// Right-pane JSON inspector: the selected JSONL line as highlighted JSON text, with jump-links, Prev/Next, and tool-flow buttons.

import { peekCachedDocument } from "./app-fetch.ts";
import { parseRouteSegments } from "./app-routes.ts";
import {
  computeLinkMaps,
  computeRevisionLinkRoute,
  type WireFileHistory,
  type WireRecord,
  type WireRevisionLink,
  type WireValue,
} from "./inspector-links.ts";
import { findToolNavigationTargets } from "./inspector-tool-nav.ts";
import { createElement } from "./inspector-json.ts";
import {
  appendToolNavigationButtons,
  buildHighlightedJsonBody,
  createSnapshotDrawerOpener,
  openInspectorPane,
} from "./inspector-pane.ts";
import {
  bumpShowLineRenderCount,
  probeTrackedBackupPresence,
} from "./inspector-snapshots.ts";
import { extractReadableText } from "./inspector-text.ts";

// Whether the inspector body shows formatted text instead of JSON; sticks for the browser session. ponytail: session-only.
let inspectorShowsFormattedText = false;

// item 66: the collapse-rail is retired; the fork layout's #split-td splitter resizes the Details pane.
// // Item 10a: collapse shrinks the pane to a 24px rail (mirroring the Files drawer) instead of
// // display:none, so the SAME focusable button expands it again — glyph and label flip per state.
// function toggleInspectorCollapsed(pane: HTMLElement, button: HTMLElement) {
//     const collapsed = pane.classList.toggle("collapsed");
//     button.textContent = collapsed ? "«" : "»";
//     button.title = collapsed ? "Expand inspector" : "Collapse inspector";
// }

// The project of the current #/project/* hash, or undefined on other routes.
function findCurrentProject(): string | undefined {
  const segments = parseRouteSegments();
  return segments[0] === "project" ? segments[1] : undefined;
}

// Append the raw-JSON/formatted-text toggle button; flipping it re-shows the same line.
function appendFormattedTextToggleButton(toolButtons: HTMLElement[], renderLine: (line: number) => void, clamped: number): void {
  toolButtons.push(createElement("button", {
    class: "row-btn",
    text: inspectorShowsFormattedText ? "Show raw JSON" : "Show as formatted text",
    onclick: () => {
      inspectorShowsFormattedText = !inspectorShowsFormattedText;
      renderLine(clamped);
    },
  }));
}

// task 141: the nav counter is 0-based with its inclusive index range, like the app's other raw-line indexes.
export function formatInspectorLineCounter(lineIndex: number, lineCount: number): string {
  return `line ${lineIndex} of 0–${lineCount - 1}`;
}

// Prev is off on the first line; Next is off on the last line.
export function computeInspectorNavDisabledStates(lineIndex: number, lineCount: number): { prevIsDisabled: boolean; nextIsDisabled: boolean } {
  return { prevIsDisabled: lineIndex === 0, nextIsDisabled: lineIndex === lineCount - 1 };
}

// Assemble the Prev / line-counter / Next navigation row plus any tool-flow buttons.
function buildInspectorNavigationRow(clamped: number, rawLines: string[], renderLine: (line: number) => void, toolButtons: HTMLElement[]): HTMLElement {
  // task 142: the row is rebuilt per line; set disabled as a property, since setAttribute("disabled", "false") still disables.
  const disabledStates = computeInspectorNavDisabledStates(clamped, rawLines.length);
  const prevButton = createElement("button", { class: "row-btn", text: "◀ Prev", onclick: () => renderLine(clamped - 1) }) as HTMLButtonElement;
  prevButton.disabled = disabledStates.prevIsDisabled;
  const nextButton = createElement("button", { class: "row-btn", text: "Next ▶", onclick: () => renderLine(clamped + 1) }) as HTMLButtonElement;
  nextButton.disabled = disabledStates.nextIsDisabled;
  return createElement("div", { class: "inspector-nav" }, [
    prevButton,
    createElement("span", { class: "muted", text: formatInspectorLineCounter(clamped, rawLines.length) }),
    nextButton,
    ...toolButtons,
  ]);
}

// Open the inspector on `line`; onJumpToLine receives every shown line so the caller can scroll along.
export function openTranscriptInspector({ jsonlName, rawLines, line, onJumpToLine }: {
  jsonlName: string;
  rawLines: string[];
  line: number;
  onJumpToLine?: (line: number) => void;
}) {
  const maps = computeLinkMaps(rawLines);
  // Revision links resolve through the cached unified document; with none cached, changeIds render unlinked.
  const project = findCurrentProject();
  const filesTouched = project === undefined ? [] : (peekCachedDocument(project)?.filesTouched ?? []) as WireFileHistory[];
  // Revision links set the hash, so the router opens file history as a shareable drawer.
  const openRevision = (revisionLink: WireRevisionLink) => {
    location.hash = computeRevisionLinkRoute(project!, revisionLink);
  };
  // The JSONL is named "<sessionId>.jsonl"; blob probes and snapshot reads are keyed on that session.
  const sessionId = jsonlName.replace(/\.jsonl$/, "");
  const openSnapshotDrawer = createSnapshotDrawerOpener(sessionId);
  const renderLine = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), rawLines.length - 1);
    const renderCountAtStart = bumpShowLineRenderCount();
    let value: WireValue;
    try {
      value = JSON.parse(rawLines[clamped]!) as WireValue;
    }
    catch {
      value = rawLines[clamped]!;
    }
    // Probe tracked-backup presence, then re-render this line once the probes settle.
    const trackedBackups = (value as WireRecord | null)?.snapshot?.trackedFileBackups;
    if (trackedBackups !== undefined) {
      probeTrackedBackupPresence(trackedBackups, sessionId, renderCountAtStart, renderLine, clamped);
    }
    // Tool-flow jumps (shown only on assistant tool_use lines): hook + result of THIS call.
    const toolTargets = findToolNavigationTargets(rawLines, value);
    const toolButtons: HTMLElement[] = [];
    if (toolTargets !== undefined) {
      appendToolNavigationButtons(toolTargets, toolButtons, renderLine);
    }
    const readableText = extractReadableText(value);
    if (readableText !== undefined) {
      appendFormattedTextToggleButton(toolButtons, renderLine, clamped);
    }
    const hasReadableText = readableText !== undefined;
    const showsFormattedText = inspectorShowsFormattedText && hasReadableText;
    let body: HTMLElement;
    if (showsFormattedText) {
      body = createElement("pre", { class: "inspector-text", text: readableText });
    }
    else {
      body = buildHighlightedJsonBody(value, clamped, maps, renderLine, filesTouched, openRevision, sessionId, project, openSnapshotDrawer);
    }
    openInspectorPane().append(
      buildInspectorNavigationRow(clamped, rawLines, renderLine, toolButtons),
      createElement("h2", { text: jsonlName }),
      body,
    );
    if (onJumpToLine !== undefined)
      onJumpToLine(clamped);
  };
  renderLine(line);
}
