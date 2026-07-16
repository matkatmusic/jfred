// Script-run Details mode (task 67): selecting a tool-call row whose sandbox execution modified
// files shows the script itself on the left and each affected file's before/after diff — the
// revision the run produced, rendered side-by-side — stacked on the right. The DOM-free
// resolution half lives in details-script-run-model.ts.

import { el } from "../app-dom.ts";
import { revealDetailsPane } from "../inspector.ts";
import { type DetailsContext, computeDetailsHeaderText, fullContentsIsOn } from "./details-model.ts";
import {
    appendColumnsDiff,
    clearRightPaneBody,
    fetchRevisionDiffBlocks,
    hideDiffModeToggle,
    setDetailsHeader,
    setRightPaneLabel,
} from "./details-diff.ts";
import { buildScriptRunDetailsViewModel, type ScriptRunFileEntry } from "./details-script-run-model.ts";
import type { ToolCallNode } from "./timeline-types.ts";

export async function renderDetailsScriptRunMode(node: ToolCallNode, nodeIndex: number, context: DetailsContext): Promise<void> {
    if (node.scriptRun === undefined) {
        return;
    }
    revealDetailsPane();
    setDetailsHeader(computeDetailsHeaderText(node, { index: nodeIndex, total: context.nodes.length }));
    const viewModel = buildScriptRunDetailsViewModel(node.scriptRun, context.document);
    const left = document.getElementById("details-left")!;
    left.replaceChildren(el("div", { class: "pane-title", text: "Script" }));
    // ponytail: plain text, no syntax highlight — renderCodeInto when someone asks.
    left.append(el("pre", { class: "script-source", text: viewModel.code }));
    setRightPaneLabel("Before / after this run");
    // The stacked sections are side-by-side by design (the task's ask); the single-diff
    // columns/inline toggle re-renders one pane-wide diff and cannot drive a stack.
    hideDiffModeToggle();
    const body = clearRightPaneBody();
    for (const entry of viewModel.files) {
        body.append(el("div", { class: "pane-title", text: entry.path }));
        await appendChangedFileDiff(body, entry, context);
    }
}

// One changed file's diff section: the resolved revision's block from the same /api/diff
// response the Revision View reads, rendered with its side-by-side grid. Unresolved paths and
// blockless revisions (rename-only, missing) explain themselves instead.
async function appendChangedFileDiff(body: HTMLElement, entry: ScriptRunFileEntry, context: DetailsContext): Promise<void> {
    if (entry.target === undefined || entry.revisionNumber === undefined) {
        body.append(el("div", { class: "dempty", text: `no reconstructed history for ${entry.path}` }));
        return;
    }
    const blocks = await fetchRevisionDiffBlocks(context.project, entry.target, fullContentsIsOn());
    const block = blocks[entry.revisionNumber - 1];
    if (block === undefined) {
        body.append(el("div", { class: "dempty", text: `no diff recorded for revision #${entry.revisionNumber} of ${entry.path}` }));
        return;
    }
    appendColumnsDiff(body, block);
}
