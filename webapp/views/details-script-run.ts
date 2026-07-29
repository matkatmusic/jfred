// Script-run Details mode (tasks 67/144): script left, changed-file list, one selected diff right; model half in details-script-run-model.ts.

import { el } from "../app-dom.ts";
import { revealDetailsPane } from "../inspector.ts";
import { type DetailsContext, computeDetailsHeaderText, fullContentsIsOn } from "./details-model.ts";
import { appendColumnsDiff } from "../diff-render.ts";
import {
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
    // task 144: one file's diff at a time; the columns/inline toggle cannot drive this pane, so it hides.
    hideDiffModeToggle();
    clearRightPaneBody();
    if (viewModel.files.length === 0) {
        return;
    }
    left.append(el("div", { class: "pane-title", text: "Files changed" }));
    const fileButtons = viewModel.files.map((entry, index) => el("button", {
        class: "row-btn",
        text: computeFileButtonLabel(entry),
        title: entry.path,
        onclick: () => void showSelectedFileDiff(index),
    }));
    const showSelectedFileDiff = async (index: number): Promise<void> => {
        for (const [buttonIndex, button] of fileButtons.entries()) {
            button.classList.toggle("selected", buttonIndex === index);
        }
        const entry = viewModel.files[index]!;
        const body = clearRightPaneBody();
        body.append(el("div", { class: "pane-title", text: entry.path }));
        await appendChangedFileDiff(body, entry, context);
    };
    left.append(...fileButtons);
    await showSelectedFileDiff(0);
}

// A file button's label: the path's basename (the full path rides on the button's title).
function computeFileButtonLabel(entry: ScriptRunFileEntry): string {
    return entry.path.slice(entry.path.lastIndexOf("/") + 1);
}

// One changed file's diff section from the shared /api/diff response; unresolved or blockless revisions explain themselves.
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
    appendColumnsDiff(body, block, entry.path);
}
