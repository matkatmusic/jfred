// Timeline selectbar + pick machinery (task 92 split from timeline.ts): the pick checkboxes,
// the contiguity rule hint, the picked-range summary strip, and the range-patch fetch.

import { el } from "../app-dom.ts";
import { fetchText, getConsentChoice } from "../app-fetch.ts";
import { downloadText } from "./download.ts";
import { checkNodeIsPickable, checkPickIsLegal, computeRangeSummary } from "./timeline-picks.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import type { TimelineNode } from "./timeline-types.ts";

export function buildConsentParams(context: TimelineRenderContext): URLSearchParams {
    const params = new URLSearchParams({ project: context.project });
    const choice = getConsentChoice(context.project);
    if (choice === "1") {
        params.set("allowScripts", "1");
    }
    if (choice === "0") {
        params.set("declined", "1");
    }
    return params;
}

export async function fetchRangePatch(context: TimelineRenderContext, fromStep: number, toStep: number): Promise<string> {
    const key = `${fromStep}-${toStep}`;
    if (context.cachedPatch.key !== key) {
        const params = buildConsentParams(context);
        params.set("fromStep", String(fromStep));
        params.set("toStep", String(toStep));
        context.cachedPatch = { key, text: await fetchText(`/api/range-patch?${params}`) };
    }
    return context.cachedPatch.text;
}

// (item 84) old: fetchStepFiles — one step's { path: content } map, showFilePreview's only
// data source ("state at step"). The Revision View reads a revision's content from the
// file-history view model instead (buildFileHistoryViewModel, already in details.ts), so this
// /api/step-files call has no caller left. The endpoint itself still serves the server.
// const fetchStepFiles = async (stepNumber: number): Promise<Record<string, string>> => {
//     const params = buildConsentParams();
//     params.set("step", String(stepNumber));
//     return fetchJson<Record<string, string>>(`/api/step-files?${params}`);
// };

// (item 84) old: showFilePreview — the chip's own file renderer. It painted #details-right-body
// ONLY and left #details-left showing the previously-selected row's file list: stale, and
// unrelated to the clicked chip. The chip now calls renderDetailsFileMode, which owns BOTH
// columns, so the second renderer is gone rather than rebuilt as a lookalike. Its two branches
// moved: state-at-step → the rev card's "Show content"; the picked-range diff → the Revision
// View's contiguous multi-card selection (details.ts showRangeDiff).
// NOTE: chip-click-while-steps-are-picked is NOT rebuilt — see plans/item84-unify-bottom-pane.md.
// const showFilePreview = async (node: TurnNode, change: FileChange, chipElement: HTMLElement): Promise<void> => {
//     if (toggleDrawerButton(chipElement)) {
//         return;
//     }
//     const drawer = openInspectorPane();
//     document.getElementById("inspector")!.classList.add("file-preview-drawer");
//     if (pickedIndexes.length > 0) {
//         const summary = computeRangeSummary(nodes, pickedIndexes);
//         const patchText = await fetchRangePatch(summary.fromStepIndex, summary.toStepIndex);
//         const block = splitPatchByFile(patchText).find((entry) =>
//             change.path === entry.path || change.path.endsWith(`/${entry.path}`));
//         const diffPane = el("div", { class: "timeline-preview" });
//         renderDiffText(diffPane, block?.block ?? "(file unchanged across the picked range)");
//         const pickedNumbers = pickedIndexes.map((picked) => nodes[picked]!.stepNumber!);
//         drawer.append(
//             el("div", { class: "timeline-preview-head", text: `${change.path} · diff before step ${Math.min(...pickedNumbers)} → at step ${Math.max(...pickedNumbers)}` }),
//             diffPane,
//         );
//         return;
//     }
//     // The turn's state of the file at its representative step, fetched on demand (skeleton steps
//     // carry no files). undefined when no file lives at that path at this step.
//     const filesAtStep = await fetchStepFiles(node.stepNumber!);
//     const content = filesAtStep[change.path];
//     // (item 49) old: el("div", { class: "timeline-preview", text: content ?? "(no snapshot carries this file at this step)" })
//     const contentPane = el("div", { class: "timeline-preview" });
//     if (content === undefined) {
//         contentPane.textContent = "(no snapshot carries this file at this step)";
//     } else {
//         renderCodeInto(contentPane, content, change.path);
//     }
//     drawer.append(
//         el("div", { class: "timeline-preview-head" }, [
//             el("span", { text: `${change.path} · state at step ${node.stepNumber}` }),
//             el("button", {
//                 class: "row-btn",
//                 text: "Export file state",
//                 onclick: () => downloadText(`${computeBaseName(change.path)}.step${node.stepNumber}`, content ?? ""),
//             }),
//         ]),
//         contentPane,
//     );
// };

export function flashRule(context: TimelineRenderContext): void {
    context.ruleHint.classList.add("show");
    setTimeout(() => context.ruleHint.classList.remove("show"), 1600);
}

export function updateSelectbar(context: TimelineRenderContext): void {
    context.pickedIndexes = [...context.pickBoxes.entries()]
        .filter(([, box]) => box.checked)
        .map(([index]) => index)
        .sort((a, b) => a - b);
    for (const [index, row] of context.nodeRows) {
        row.classList.toggle("picked", context.pickBoxes.get(index)?.checked === true);
    }
    context.selectbar.classList.toggle("visible", context.pickedIndexes.length > 0);
    if (context.pickedIndexes.length > 0) {
        const summary = computeRangeSummary(context.nodes, context.pickedIndexes);
        context.barText.textContent =
            `${summary.stepCount} step${summary.stepCount === 1 ? "" : "s"} picked · ` +
            `${summary.filePaths.length} file${summary.filePaths.length === 1 ? "" : "s"}`;
    }
}

function clearAllPickBoxes(context: TimelineRenderContext): void {
    for (const box of context.pickBoxes.values()) {
        box.checked = false;
    }
    updateSelectbar(context);
}

// replaceChildren (not append): the selectbar is static, re-renders must not stack contents.
export function renderSelectbarButtons(context: TimelineRenderContext): void {
    context.selectbar.replaceChildren(context.barText, context.ruleHint, el("button", {
        class: "toolbar-btn",
        text: "Export .patch",
        onclick: async () => {
            const summary = computeRangeSummary(context.nodes, context.pickedIndexes);
            const patchText = await fetchRangePatch(context, summary.fromStepIndex, summary.toStepIndex);
            downloadText(`${context.project}-steps-${summary.fromStepIndex}-${summary.toStepIndex}.patch`, patchText);
        },
    }), el("button", {
        class: "toolbar-btn",
        text: "Clear",
        onclick: () => clearAllPickBoxes(context),
    }));
}

function handlePickChange(context: TimelineRenderContext, pick: HTMLInputElement): void {
    const candidate = [...context.pickBoxes.entries()].filter(([, box]) => box.checked).map(([i]) => i);
    if (!checkPickIsLegal(context.nodes, candidate)) {
        pick.checked = !pick.checked;
        flashRule(context);
    }
    updateSelectbar(context);
}

// Pick cell (existing pick model: only surviving agent turns with snapshots).
export function buildPickCell(context: TimelineRenderContext, node: TimelineNode, index: number): HTMLElement {
    const pickCell = el("span", { class: "tl-pick" });
    if (checkNodeIsPickable(node)) {
        const pick = el("input", { type: "checkbox" }) as HTMLInputElement;
        context.pickBoxes.set(index, pick);
        pick.addEventListener("click", (event) => event.stopPropagation()); // picking must not change selection
        pick.addEventListener("change", () => handlePickChange(context, pick));
        pickCell.append(pick);
    }
    return pickCell;
}
