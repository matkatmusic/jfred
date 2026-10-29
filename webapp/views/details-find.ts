// Details-pane find widget: DOM wiring over details-find-model.ts, painted with the CSS Custom Highlight API.

import {
  computeMatchCounterLabel,
  computeWrappedMatchIndex,
  findMatchesInTextNodeValues,
} from "./details-find-model.ts";

const ALL_MATCHES_HIGHLIGHT_NAME = "details-find";
const CURRENT_MATCH_HIGHLIGHT_NAME = "details-find-current";

let matchRanges: Range[] = [];
let currentMatchIndex = -1;

// Every text node currently rendered in the right pane's body, in document order.
function collectRightPaneTextNodes(): Text[] {
  const body = document.getElementById("details-right-body")!;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode() !== null) {
    textNodes.push(walker.currentNode as Text);
  }
  return textNodes;
}

// Paint all matches and the current one; without the Highlight API there is no paint.
function applyFindHighlights(): void {
  if (CSS.highlights === undefined) {
    return;
  }
  CSS.highlights.set(ALL_MATCHES_HIGHLIGHT_NAME, new Highlight(...matchRanges));
  const currentRange = matchRanges[currentMatchIndex];
  CSS.highlights.set(CURRENT_MATCH_HIGHLIGHT_NAME, currentRange === undefined ? new Highlight() : new Highlight(currentRange));
}

// Repaint the counter + highlights and bring the current match into view.
function updateFindCounterAndScroll(): void {
  document.getElementById("details-find-count")!.textContent = computeMatchCounterLabel(currentMatchIndex, matchRanges.length);
  applyFindHighlights();
  const currentRange = matchRanges[currentMatchIndex];
  if (currentRange === undefined) {
    return;
  }
  (currentRange.startContainer.parentElement ?? undefined)?.scrollIntoView({ block: "nearest" });
}

// Re-search the pane's current text and land on the first match.
function executeDetailsFind(term: string): void {
  const textNodes = collectRightPaneTextNodes();
  const textNodeValues: string[] = [];
  for (const textNode of textNodes) {
    textNodeValues.push(textNode.data);
  }
  const matches = findMatchesInTextNodeValues(textNodeValues, term);
  matchRanges = [];
  for (const match of matches) {
    const range = new Range();
    range.setStart(textNodes[match.nodeIndex]!, match.start);
    range.setEnd(textNodes[match.nodeIndex]!, match.end);
    matchRanges.push(range);
  }
  currentMatchIndex = matchRanges.length === 0 ? -1 : 0;
  updateFindCounterAndScroll();
}

// Move to the next (+1) or previous (-1) match, wrapping; re-search first when the ranges are empty.
function moveDetailsFindMatch(delta: number): void {
  if (matchRanges.length === 0) {
    executeDetailsFind((document.getElementById("details-find-input") as HTMLInputElement).value);
    return;
  }
  currentMatchIndex = computeWrappedMatchIndex(currentMatchIndex, matchRanges.length, delta);
  updateFindCounterAndScroll();
}

// Drop all match state and paint before each right-pane re-render; the input text stays.
export function resetDetailsFind(): void {
  matchRanges = [];
  currentMatchIndex = -1;
  if (CSS.highlights !== undefined) {
    CSS.highlights.delete(ALL_MATCHES_HIGHLIGHT_NAME);
    CSS.highlights.delete(CURRENT_MATCH_HIGHLIGHT_NAME);
  }
  const counter = document.getElementById("details-find-count");
  if (counter !== null) {
    counter.textContent = computeMatchCounterLabel(-1, 0);
  }
}

// One-time wiring at bootstrap: typing searches, Enter and the buttons move, the clear button resets.
export function initDetailsFind(): void {
  const input = document.getElementById("details-find-input") as HTMLInputElement;
  const clearButton = document.getElementById("details-find-clear") as HTMLButtonElement;
  input.oninput = () => {
    clearButton.hidden = input.value === "";
    executeDetailsFind(input.value);
  };
  input.onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    moveDetailsFindMatch(event.shiftKey ? -1 : 1);
  };
  clearButton.onclick = () => {
    input.value = "";
    clearButton.hidden = true;
    executeDetailsFind("");
    input.focus();
  };
  document.getElementById("details-find-prev")!.onclick = () => moveDetailsFindMatch(-1);
  document.getElementById("details-find-next")!.onclick = () => moveDetailsFindMatch(1);
}
