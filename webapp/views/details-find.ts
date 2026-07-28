// Details-pane find widget (task 127) — thin DOM wiring over details-find-model.ts: the #details-find input + n/N counter + prev/next buttons in the right pane's header row.  Matches are found over #details-right-body's text nodes and painted with the CSS Custom Highlight API (no DOM mutation, so hljs spans and diff grids keep their own markup).

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

// Paint all matches + the current one; counter/scroll still work when the Custom Highlight API is unavailable, there is just no paint.
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
function runDetailsFind(term: string): void {
    const textNodes = collectRightPaneTextNodes();
    const matches = findMatchesInTextNodeValues(textNodes.map((textNode) => textNode.data), term);
    matchRanges = matches.map((match) => {
        const range = new Range();
        range.setStart(textNodes[match.nodeIndex]!, match.start);
        range.setEnd(textNodes[match.nodeIndex]!, match.end);
        return range;
    });
    currentMatchIndex = matchRanges.length === 0 ? -1 : 0;
    updateFindCounterAndScroll();
}

// Step to the next (+1) / previous (-1) match, wrapping; re-searches first when the pane was re-rendered since the last search (resetDetailsFind emptied the ranges).
function stepDetailsFind(delta: number): void {
    if (matchRanges.length === 0) {
        runDetailsFind((document.getElementById("details-find-input") as HTMLInputElement).value);
        return;
    }
    currentMatchIndex = computeWrappedMatchIndex(currentMatchIndex, matchRanges.length, delta);
    updateFindCounterAndScroll();
}

// Drop all match state and paint — called before every right-pane re-render (its Ranges die with the replaced DOM). The input's text is kept so Enter re-runs against the new content.
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

// One-time chrome wiring (app.ts bootstrap): input searches as you type; Enter / Shift+Enter and the < / > buttons step through matches; the Fork-style ✕ (shown once a term is entered) clears the term and its highlights.
export function initDetailsFind(): void {
    const input = document.getElementById("details-find-input") as HTMLInputElement;
    const clearButton = document.getElementById("details-find-clear") as HTMLButtonElement;
    input.oninput = () => {
        clearButton.hidden = input.value === "";
        runDetailsFind(input.value);
    };
    input.onkeydown = (event) => {
        if (event.key !== "Enter") {
            return;
        }
        stepDetailsFind(event.shiftKey ? -1 : 1);
    };
    clearButton.onclick = () => {
        input.value = "";
        clearButton.hidden = true;
        runDetailsFind("");
        input.focus();
    };
    document.getElementById("details-find-prev")!.onclick = () => stepDetailsFind(-1);
    document.getElementById("details-find-next")!.onclick = () => stepDetailsFind(1);
}
