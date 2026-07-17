// Right-pane JSON inspector: the selected JSONL line pretty-printed as actual JSON text
// (curly braces and all), syntax-highlighted — the presentation the legacy JFReD diff viewer
// used (web-shared/json-inspector.js), rebuilt without innerHTML: the text is tokenized and
// appended as text nodes + spans, so page content can never inject markup.
// Prev/Next walk the transcript line by line; uuid and toolu_… string values are jump-links
// to the linked line (a uuid jumps to the record it names; a tool id jumps to its use/result
// counterpart). Navigation also notifies the calling view so it can scroll/highlight along.

import { fetchJson, peekCachedDocument } from "./app-fetch.ts";
import { parseRouteSegments } from "./app-routes.ts";
import {
    computeBlobRequestUrl,
    computeLinkMaps,
    computeRevisionLinkRoute,
    findToolNavigationTargets,
    type LinkMaps,
    type WireBlobResponse,
    type WireFileHistory,
    type WireRecord,
    type WireRevisionLink,
    type WireTrackedBackup,
    type WireValue,
} from "./inspector-links.ts";
import { el, renderHighlightedJson } from "./inspector-json.ts";
import {
    blobPresenceByKey,
    buildSnapshotDrawer,
    bumpShowLineRenderCount,
    probeTrackedBackupPresence,
} from "./inspector-snapshots.ts";
import { extractReadableText } from "./inspector-text.ts";
import { renderCodeInto } from "./highlight.ts";

// Whether the inspector body renders formatted text instead of highlighted JSON. Module-level
// so the choice sticks across lines and re-opens for the browser session (same pattern as
// diff-vs-base's diffDisplayMode). ponytail: session-only; localStorage if ever wanted.
let inspectorShowsFormattedText = false;

// item 66: the collapse-rail is retired — the fork layout's #split-td splitter resizes the
// Details pane instead of a 24px rail toggle.
// // Item 10a: collapse shrinks the pane to a 24px rail (mirroring the Files drawer) instead of
// // display:none, so the SAME focusable button expands it again — glyph and label flip per state.
// function toggleInspectorCollapsed(pane: HTMLElement, button: HTMLElement) {
//     const collapsed = pane.classList.toggle("collapsed");
//     button.textContent = collapsed ? "«" : "»";
//     button.title = collapsed ? "Expand inspector" : "Collapse inspector";
// }

// Show the Details pane without touching its contents — the diff/file modes (views/details.ts)
// reveal first, then paint their own columns.
export function revealDetailsPane(): void {
    document.getElementById("inspector")!.classList.remove("hidden");
}

// The Details pane's right column, revealed and cleared for a JSON inspector render: label
// flips to "JSON", the diff toggle hides (it belongs to diff renders only), and the returned
// #details-right-body is the column every inspector/sub-route view fills.
// item 66: was — rebuilt the pane's children wholesale (collapse chevron + .inspector-content):
//     pane.classList.remove("collapsed");
//     const content = el("div", { class: "inspector-content" });
//     const collapseButton = el("button", { class: "row-btn inspector-close", text: "»", title: "Collapse inspector" });
//     collapseButton.onclick = () => toggleInspectorCollapsed(pane, collapseButton);
//     pane.replaceChildren(collapseButton, content);
export function openInspectorPane(): HTMLElement {
    const pane = document.getElementById("inspector")!;
    // The 50%-width file-preview modifier is opt-in per open; callers wanting it re-add it.
    pane.classList.remove("file-preview-drawer");
    // Same for the snapshot-drawer split: a fresh open starts without the bottom drawer.
    pane.classList.remove("snapshot-drawer");
    revealDetailsPane();
    document.getElementById("details-right-label")!.textContent = "JSON";
    document.getElementById("diff-mode-toggle")!.hidden = true;
    const body = document.getElementById("details-right-body")!;
    body.replaceChildren();
    return body;
}

// The project of the current #/project/* hash, or undefined on other routes.
function findCurrentProject(): string | undefined {
    const segments = parseRouteSegments();
    return segments[0] === "project" ? segments[1] : undefined;
}

// Append the hook/result jump buttons for the shown tool call (each only when its line exists).
function appendToolNavigationButtons(toolTargets: { hookLine: number; resultLine: number }, toolButtons: HTMLElement[], showLine: (line: number) => void): void {
    if (toolTargets.hookLine >= 0) {
        toolButtons.push(el("button", { class: "row-btn", text: "Go to PreToolUse hook", onclick: () => showLine(toolTargets.hookLine) }));
    }
    if (toolTargets.resultLine >= 0) {
        toolButtons.push(el("button", { class: "row-btn", text: "Go to Tool Result", onclick: () => showLine(toolTargets.resultLine) }));
    }
}

// Append the raw-JSON/formatted-text toggle button; flipping it re-shows the same line.
function appendFormattedTextToggleButton(toolButtons: HTMLElement[], showLine: (line: number) => void, clamped: number): void {
    toolButtons.push(el("button", {
        class: "row-btn",
        text: inspectorShowsFormattedText ? "Show raw JSON" : "Show as formatted text",
        onclick: () => {
            inspectorShowsFormattedText = !inspectorShowsFormattedText;
            showLine(clamped);
        },
    }));
}

// Render the line's highlighted-JSON body (the non-formatted-text presentation).
function buildHighlightedJsonBody(
    value: WireValue, clamped: number, maps: LinkMaps, showLine: (line: number) => void,
    filesTouched: WireFileHistory[], openRevision: (link: WireRevisionLink) => void,
    sessionId: string, project: string | undefined,
    openSnapshotDrawer: (blobName: string, entry: WireTrackedBackup) => void,
): HTMLElement {
    // (item 23) old call: body = renderHighlightedJson(JSON.stringify(value, null, 4), value, clamped, maps, showLine, filesTouched, openRevision);
    return renderHighlightedJson(
        JSON.stringify(value, null, 4), value, clamped, maps, showLine, filesTouched, openRevision,
        { sessionId, presenceByKey: blobPresenceByKey, project, openSnapshotDrawer },
    );
}

// Assemble the Prev / line-counter / Next navigation row plus any tool-flow buttons.
function buildInspectorNavigationRow(clamped: number, rawLines: string[], showLine: (line: number) => void, toolButtons: HTMLElement[]): HTMLElement {
    return el("div", { class: "inspector-nav" }, [
        el("button", { class: "row-btn", text: "◀ Prev", onclick: () => showLine(clamped - 1) }),
        el("span", { class: "muted", text: `line ${clamped} / ${rawLines.length - 1}` }),
        el("button", { class: "row-btn", text: "Next ▶", onclick: () => showLine(clamped + 1) }),
        ...toolButtons,
    ]);
}

// Open the inspector on `line` of a transcript. onJumpToLine (optional) is called with every
// shown line so the calling view can scroll/highlight in step; it must not reopen the inspector.
export function openTranscriptInspector({ jsonlName, rawLines, line, onJumpToLine }: {
    jsonlName: string;
    rawLines: string[];
    line: number;
    onJumpToLine?: (line: number) => void;
}) {
    const maps = computeLinkMaps(rawLines);
    // Revision links resolve through the project's already-cached unified document — never a
    // build. On routes with no cached document, changeId values simply render unlinked.
    const project = findCurrentProject();
    const filesTouched = project === undefined ? [] : (peekCachedDocument(project)?.filesTouched ?? []) as WireFileHistory[];
    // Revision links navigate: the router renders file history as a drawer over the timeline
    // (renderSubRouteDrawer) and the URL reflects it, so revision links are shareable.
    const openRevision = (revisionLink: WireRevisionLink) => {
        location.hash = computeRevisionLinkRoute(project!, revisionLink);
    };
    // The shown transcript's session id, by the timeline's file-naming convention: the JSONL
    // is named "<sessionId>.jsonl". Blob presence probes and snapshot reads are owner-keyed
    // on it (a blob name only means something under its owning session's dir).
    const sessionId = jsonlName.replace(/\.jsonl$/, "");
    // Raise (or refill) the bottom snapshot drawer with one blob's verbatim content, splitting
    // the Details pane: JSON above, blob below.
    const openSnapshotDrawer = async (blobName: string, entry: WireTrackedBackup) => {
        const result = await fetchJson(computeBlobRequestUrl(sessionId, blobName)) as WireBlobResponse;
        const pane = document.getElementById("inspector")!;
        // item 66: was `pane.querySelector(".inspector-content")` — the content column is now
        // the static #details-right-body skeleton element.
        const content = document.getElementById("details-right-body");
        if (content === null) {
            return;
        }
        // Re-clicking a link while a drawer is open replaces the drawer's contents.
        pane.querySelector(".snapshot-pane")?.remove();
        pane.classList.add("snapshot-drawer");
        const snapshotText = el("pre", { class: "inspector-text" });
        renderCodeInto(snapshotText, result.content ?? "", entry.relativePath);
        const drawer = buildSnapshotDrawer(pane, entry, blobName, snapshotText);
        content.append(drawer);
    };
    const showLine = (index: number) => {
        const clamped = Math.min(Math.max(index, 0), rawLines.length - 1);
        const renderCountAtStart = bumpShowLineRenderCount();
        let value: WireValue;
        try {
            value = JSON.parse(rawLines[clamped]!) as WireValue;
        } catch {
            value = rawLines[clamped]!;
        }
        // Probe the on-disk presence of this record's tracked backups (unknowns only), then
        // re-render the SAME line once every probe settles — progressive enhancement: the
        // first paint shows those tokens plain, never a flicker loop.
        const trackedBackups = (value as WireRecord | null)?.snapshot?.trackedFileBackups;
        if (trackedBackups !== undefined) {
            probeTrackedBackupPresence(trackedBackups, sessionId, renderCountAtStart, showLine, clamped);
        }
        // Tool-flow jumps (shown only on assistant tool_use lines): hook + result of THIS call.
        const toolTargets = findToolNavigationTargets(rawLines, value);
        const toolButtons: HTMLElement[] = [];
        if (toolTargets !== undefined) {
            appendToolNavigationButtons(toolTargets, toolButtons, showLine);
        }
        const readableText = extractReadableText(value);
        if (readableText !== undefined) {
            appendFormattedTextToggleButton(toolButtons, showLine, clamped);
        }
        let body: HTMLElement;
        if (inspectorShowsFormattedText && readableText !== undefined) {
            body = el("pre", { class: "inspector-text", text: readableText });
        } else {
            body = buildHighlightedJsonBody(value, clamped, maps, showLine, filesTouched, openRevision, sessionId, project, openSnapshotDrawer);
        }
        openInspectorPane().append(
            buildInspectorNavigationRow(clamped, rawLines, showLine, toolButtons),
            el("h2", { text: jsonlName }),
            body,
        );
        if (onJumpToLine !== undefined) onJumpToLine(clamped);
    };
    showLine(line);
}
