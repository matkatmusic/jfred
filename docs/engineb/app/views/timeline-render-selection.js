// Timeline row selection + header navigation (task 92 split from timeline.ts): flash/jump/select
// on a row, the Expand All toggle, and the Prev/Next file-touched walkers.
import { renderDetailsCommitMode, renderDetailsMessageMode } from "./details.js";
import { renderDetailsScriptRunMode } from "./details-script-run.js";
import { clearFileSelectionIn } from "./sidebar.js";
import { findContributingNodeIndexes } from "./timeline-commit-files.js";
import { findAdjacentFileTouchedIndex, findAdjacentRowIndex } from "./timeline-sessions.js";
import { COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND } from "./timeline-types.js";
// Restart the row-flash animation (mockup jumpToTimelineRow's remove/reflow/add dance).
export function flashRowElement(row) {
    row.classList.remove("flash");
    void row.offsetWidth; // restart the CSS animation
    row.classList.add("flash");
    setTimeout(() => row.classList.remove("flash"), 1300);
}
// Sidebar session clicks and the session-anchor route land here: scroll + flash the row.
export function jumpToTimelineRow(context, nodeIndex) {
    const row = context.nodeRows.get(nodeIndex);
    if (row === undefined) {
        return;
    }
    row.scrollIntoView({ block: "start" });
    flashRowElement(row);
}
// Row selection (mockup selectRow): swap .selected, re-derive the commit-contribution
// highlight, render the matching details mode, THEN center the row — the details render
// reflows the panes, so centering must run against the post-render layout (item 50).
export async function selectTimelineRow(context, nodeIndex) {
    const row = context.nodeRows.get(nodeIndex);
    if (row === undefined) {
        return;
    }
    if (context.selectedRow !== null) {
        context.selectedRow.classList.remove("selected");
    }
    context.selectedRow = row;
    context.fileNavReferenceIndex = nodeIndex; // Prev/Next walk from the manual selection
    context.refreshFileNavButtons();
    row.classList.add("selected");
    for (const other of context.nodeRows.values()) {
        other.classList.remove("contrib");
    }
    // The details pane leaves file mode. Only the Files sidebar's tree is cleared — the
    // "Files touched" tree this row is about to render lives in #details-left and owns its own
    // selection (item 84).
    clearFileSelectionIn(document.getElementById("drawer"));
    const node = context.nodes[nodeIndex];
    if (node.kind === COMMIT_NODE_KIND) {
        for (const contributingIndex of findContributingNodeIndexes(context.nodes, nodeIndex)) {
            context.nodeRows.get(contributingIndex)?.classList.add("contrib");
        }
        await renderDetailsCommitMode(node, nodeIndex, context.detailsContext);
    }
    else if (node.kind === TOOL_CALL_NODE_KIND && node.scriptRun !== undefined) {
        // task 67: a script run that modified files gets the script + before/after mode
        // (scriptRun is only stamped when its changedPaths is non-empty — deriveToolCallNodes).
        await renderDetailsScriptRunMode(node, nodeIndex, context.detailsContext);
    }
    else {
        await renderDetailsMessageMode(node, nodeIndex, context.detailsContext);
    }
    row.scrollIntoView({ block: "center" });
}
// ── Expand All / Collapse All (mockup updateToggleLabel). #toggle-all is a static skeleton
// element outside `container`; onclick property assignment (not addEventListener) so
// re-renders never stack handlers. ──
export function wireToggleAllButton(context) {
    const toggleAllButton = document.getElementById("toggle-all");
    const updateToggleLabel = () => {
        const anyCollapsed = context.expandableRows.some((expandable) => !expandable.classList.contains("expanded"));
        toggleAllButton.textContent = anyCollapsed ? "Expand All" : "Collapse All";
    };
    context.updateToggleLabel = updateToggleLabel;
    toggleAllButton.onclick = () => {
        const anyCollapsed = context.expandableRows.some((expandable) => !expandable.classList.contains("expanded"));
        for (const expandable of context.expandableRows) {
            expandable.classList.toggle("expanded", anyCollapsed);
        }
        updateToggleLabel();
    };
    updateToggleLabel();
}
// ── header Prev/Next over file-touching agent turns (task 85) plus the task-131 line-stepper
// pair (◀ Line / Line ▶: one visible row per click). Expanding IS the task's
// "click the triangle": the chips live in the bubble. onclick assignment, like #toggle-all,
// so re-renders never stack handlers. A button disables when no candidate row exists in
// its direction; selectTimelineRow re-enables/disables all four on every selection. ──
export function wireFileNavButtons(context) {
    const filesPrevButton = document.getElementById("files-prev");
    const filesNextButton = document.getElementById("files-next");
    const linePrevButton = document.getElementById("line-prev");
    const lineNextButton = document.getElementById("line-next");
    context.refreshFileNavButtons = () => {
        filesPrevButton.disabled = findAdjacentFileTouchedIndex(context.nodes, context.fileNavReferenceIndex, -1) === undefined;
        filesNextButton.disabled = findAdjacentFileTouchedIndex(context.nodes, context.fileNavReferenceIndex, 1) === undefined;
        linePrevButton.disabled = findAdjacentRowIndex(context.nodes, context.fileNavReferenceIndex, -1) === undefined;
        lineNextButton.disabled = findAdjacentRowIndex(context.nodes, context.fileNavReferenceIndex, 1) === undefined;
    };
    const jumpToAdjacentFileTouchedRow = (direction) => {
        const target = findAdjacentFileTouchedIndex(context.nodes, context.fileNavReferenceIndex, direction);
        if (target === undefined) {
            return;
        }
        context.nodeRows.get(target).classList.add("expanded"); // expand BEFORE selecting so centering sees the bubble
        context.updateToggleLabel();
        void context.selectTimelineRow(target); // selects + renders details + centers; also updates fileNavReferenceIndex + button states
    };
    // task 131: one visible row per click — no expand step (line rows are thin one-liners;
    // selectTimelineRow handles selection, details render, centering, and button refresh).
    const selectAdjacentRow = (direction) => {
        const target = findAdjacentRowIndex(context.nodes, context.fileNavReferenceIndex, direction);
        if (target === undefined) {
            return;
        }
        void context.selectTimelineRow(target);
    };
    filesPrevButton.onclick = () => jumpToAdjacentFileTouchedRow(-1);
    filesNextButton.onclick = () => jumpToAdjacentFileTouchedRow(1);
    linePrevButton.onclick = () => selectAdjacentRow(-1);
    lineNextButton.onclick = () => selectAdjacentRow(1);
    context.refreshFileNavButtons();
}
