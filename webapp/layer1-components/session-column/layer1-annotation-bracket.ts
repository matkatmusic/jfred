// Task 382: the dashed bracket that joins the two nodes of one tool call (column and bubble share it).

import { createElement } from "../../app-dom.ts";

function readAxisPx(node: HTMLElement): number {
  return Number(node.style.getPropertyValue("--axis-px"));
}

// Starts at the upper node and runs to the lower one; the same two numbers as buildMark in layer1-ranges.ts.
export function buildPairBracket(first: HTMLElement, second: HTMLElement, className: string): HTMLElement {
  return buildPixelBracket(readAxisPx(first), readAxisPx(second), className);
}

// Draws a bracket from two pixel numbers, with no dot nodes.
export function buildPixelBracket(firstPx: number, secondPx: number, className: string): HTMLElement {
  const bracket = createElement("div", { class: className, "data-component": "sessionDotsBracket" });
  bracket.style.setProperty("--axis-px", String(Math.min(firstPx, secondPx)));
  bracket.style.setProperty("--span-px", String(Math.abs(secondPx - firstPx)));
  return bracket;
}
