// Timeline pick checkboxes and the selectbar strip: rule hint, summary text, export and clear buttons.

import { createElement } from "../app-dom.ts";
import { saveTextFile } from "./download.ts";
import { isNodePickable, isPickLegal, computeRangeSummary } from "./timeline-picks.ts";
import { fetchRangePatch } from "./timeline-render-selectbar.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

function hideRuleHint(context: TimelineRenderContext): void {
  context.ruleHint.classList.remove("show");
}

export function triggerRuleFlash(context: TimelineRenderContext): void {
  context.ruleHint.classList.add("show");
  setTimeout(hideRuleHint, 1600, context);
}

function compareAscending(left: number, right: number): number {
  return left - right;
}

function collectCheckedIndexes(context: TimelineRenderContext): number[] {
  const checkedIndexes: number[] = [];
  for (const [index, box] of context.pickBoxes) {
    if (box.checked) {
      checkedIndexes.push(index);
    }
  }
  return checkedIndexes.sort(compareAscending);
}

export function updateSelectbar(context: TimelineRenderContext): void {
  context.pickedIndexes = collectCheckedIndexes(context);
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
  context.selectbar.replaceChildren(context.barText, context.ruleHint, createElement("button", {
    class: "toolbar-btn",
    text: "Export .patch",
    onclick: async () => {
      const summary = computeRangeSummary(context.nodes, context.pickedIndexes);
      const patchText = await fetchRangePatch(context, summary.fromStepIndex, summary.toStepIndex);
      saveTextFile(`${context.project}-steps-${summary.fromStepIndex}-${summary.toStepIndex}.patch`, patchText);
    },
  }), createElement("button", {
    class: "toolbar-btn",
    text: "Clear",
    onclick: () => clearAllPickBoxes(context),
  }));
}

function applyPickChange(context: TimelineRenderContext, pick: HTMLInputElement): void {
  const candidate = collectCheckedIndexes(context);
  const isLegal = isPickLegal(context.nodes, candidate);
  if (!isLegal) {
    pick.checked = !pick.checked;
    triggerRuleFlash(context);
  }
  updateSelectbar(context);
}

function stopEventPropagation(event: Event): void {
  event.stopPropagation();
}

// Pick cell (existing pick model: only surviving agent turns with snapshots).
export function buildPickCell(context: TimelineRenderContext, node: TimelineNode, index: number): HTMLElement {
  const pickCell = createElement("span", { class: "tl-pick" });
  const isPickable = isNodePickable(node);
  if (isPickable) {
    const pick = createElement("input", { type: "checkbox" }) as HTMLInputElement;
    context.pickBoxes.set(index, pick);
    pick.addEventListener("click", stopEventPropagation); // picking must not change selection
    pick.addEventListener("change", applyPickChange.bind(null, context, pick));
    pickCell.append(pick);
  }
  return pickCell;
}
