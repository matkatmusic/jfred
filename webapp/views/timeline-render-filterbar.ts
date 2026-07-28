// Timeline event-type filter bar (task 114) + keyword search box (task 127) — thin DOM wiring over timeline-filter-model.ts. Renders a search input and one .toolbar-btn per mode into #timeline-filter-bar; a row hides when its node fails the combined mode+search predicate.  State is per-render: navigation rebuilds the bar back at "All" with a blank term (app-router re-hides the bar on every route change).

import { el } from "../app-dom.ts";
import { clearBaselineChoice, getBaselineChoice } from "../app-choices.ts";
import { dropProjectDocuments } from "../app-fetch.ts";
import { renderRoute } from "../app-router.ts";
import { computeMatchCounterLabel, computeWrappedMatchIndex } from "./details-find-model.ts";
import { checkAllLinesIsOn, toggleAllLinesSetting } from "./timeline-line-nodes.ts";
import {
    TIMELINE_FILTER_BUTTONS,
    TIMELINE_FILTER_MODES,
    checkNodePassesFilters,
    computeMatchingNodeIndexes,
    computeSessionTitleByNodeIndex,
    type TimelineFilterMode,
} from "./timeline-filter-model.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";

const ACTIVE_BUTTON_CLASS = "active";
const FILTERED_OUT_ROW_CLASS = "tl-filtered-out";
const CURRENT_MATCH_ROW_CLASS = "tl-search-current";

// Hide every row failing the combined mode+search predicate; restore the rest.
function applyTimelineFilters(context: TimelineRenderContext, mode: TimelineFilterMode, term: string, sessionTitleByNodeIndex: Map<number, string>): void {
    for (const [index, node] of context.nodes.entries()) {
        const row = context.nodeRows.get(index);
        if (row === undefined) {
            continue;
        }
        row.classList.toggle(FILTERED_OUT_ROW_CLASS, !checkNodePassesFilters(node, mode, term, sessionTitleByNodeIndex.get(index)));
    }
}

// Mark exactly one button of the group as the active mode.
function markActiveButton(buttons: HTMLButtonElement[], activeButton: HTMLButtonElement): void {
    for (const button of buttons) {
        button.classList.toggle(ACTIVE_BUTTON_CLASS, button === activeButton);
    }
}

// Build the search box + single-select mode buttons into `bar` and unhide it; the All button starts active with a blank term.
export function renderTimelineFilterBar(context: TimelineRenderContext, bar: HTMLElement): void {
    let activeMode: TimelineFilterMode = TIMELINE_FILTER_MODES.all;
    let searchTerm = "";
    const searchInput = el("input", { class: "timeline-search", type: "search", placeholder: "🔍 search" }) as HTMLInputElement;
    // Fork-style search chrome, shown only while a term is entered: n/N counter (current result of results found), ▲/▼ jump buttons, then the ✕ clear button. Entering a term jumps to result #1; ▲/▼ (and Enter / Shift+Enter) walk the results, wrapping.
    let matchNodeIndexes: number[] = [];
    let currentMatchPosition = -1;
    let currentMatchRow: HTMLElement | null = null;
    const countLabel = el("span", { class: "search-count" });
    const prevButton = el("button", { class: "search-step", text: "▲", title: "Previous result" }) as HTMLButtonElement;
    const nextButton = el("button", { class: "search-step", text: "▼", title: "Next result" }) as HTMLButtonElement;
    const clearButton = el("button", { class: "search-clear", text: "✕", title: "Clear search" }) as HTMLButtonElement;
    const searchChrome = [countLabel, prevButton, nextButton, clearButton];
    searchChrome.forEach((element) => { element.hidden = true; });
    // Move the current-result marker to the current match's row and SELECT it — selection renders the details pane and centers the row, so result #1 shows its details the moment a term lands on it. Guarded on the already-selected row so retyping a term that keeps landing on the same result doesn't re-render the pane per keystroke.
    const jumpToCurrentMatch = () => {
        currentMatchRow?.classList.remove(CURRENT_MATCH_ROW_CLASS);
        currentMatchRow = null;
        const nodeIndex = matchNodeIndexes[currentMatchPosition];
        if (nodeIndex === undefined) {
            return;
        }
        const row = context.nodeRows.get(nodeIndex);
        if (row === undefined) {
            return;
        }
        currentMatchRow = row;
        row.classList.add(CURRENT_MATCH_ROW_CLASS);
        if (row !== context.selectedRow) {
            void context.selectTimelineRow(nodeIndex);
            return;
        }
        row.scrollIntoView({ block: "nearest" });
    };
    const updateCounterAndJump = () => {
        countLabel.textContent = computeMatchCounterLabel(currentMatchPosition, matchNodeIndexes.length);
        jumpToCurrentMatch();
    };
    // task 148: session titles join the search — computed once, the node list is fixed for this render (navigation rebuilds the bar).
    const sessionTitleByNodeIndex = computeSessionTitleByNodeIndex(context.nodes, context.reconstructionDocument.sessionTitles);
    // Re-derive the result list for the current term+mode and land on result #1.
    const refreshFilteredRows = () => {
        applyTimelineFilters(context, activeMode, searchTerm, sessionTitleByNodeIndex);
        const hasTerm = searchTerm.trim() !== "";
        matchNodeIndexes = hasTerm ? computeMatchingNodeIndexes(context.nodes, activeMode, searchTerm, sessionTitleByNodeIndex) : [];
        currentMatchPosition = matchNodeIndexes.length === 0 ? -1 : 0;
        searchChrome.forEach((element) => { element.hidden = !hasTerm; });
        updateCounterAndJump();
    };
    const stepMatch = (delta: number) => {
        currentMatchPosition = computeWrappedMatchIndex(currentMatchPosition, matchNodeIndexes.length, delta);
        updateCounterAndJump();
    };
    searchInput.oninput = () => {
        searchTerm = searchInput.value;
        refreshFilteredRows();
    };
    searchInput.onkeydown = (event) => {
        if (event.key !== "Enter") {
            return;
        }
        stepMatch(event.shiftKey ? -1 : 1);
    };
    prevButton.onclick = () => stepMatch(-1);
    nextButton.onclick = () => stepMatch(1);
    clearButton.onclick = () => {
        searchInput.value = "";
        searchTerm = "";
        refreshFilteredRows();
        searchInput.focus();
    };
    const buttons: HTMLButtonElement[] = [];
    for (const [mode, label] of TIMELINE_FILTER_BUTTONS) {
        const button = el("button", { class: "toolbar-btn", text: label }) as HTMLButtonElement;
        if (mode === TIMELINE_FILTER_MODES.all) {
            button.classList.add(ACTIVE_BUTTON_CLASS);
        }
        button.onclick = () => {
            markActiveButton(buttons, button);
            activeMode = mode;
            refreshFilteredRows();
        };
        buttons.push(button);
    }
    // task 134: raw-lines toggle — unlike the display-only mode buttons this changes node DERIVATION, so it re-renders the whole route (the app-consent renderRoute precedent); sessionStorage carries the state across the rebuild. task 161: the button is static pane-header markup (index.html); the router's timeline-pane-header hidden toggle governs its visibility, this per-render pass owns its active state and click wiring.
    const allLinesButton = document.getElementById("all-lines-btn") as HTMLButtonElement;
    allLinesButton.classList.toggle(ACTIVE_BUTTON_CLASS, checkAllLinesIsOn());
    allLinesButton.onclick = () => {
        toggleAllLinesSetting();
        void renderRoute();
    };
    // task 152: re-pose the pre-baseline question — clears the stored answer and the project's cached documents, then re-renders so the choice-less document fetch reaches the server (which is what makes it ask again). Only offered once an answer is stored: no stored answer means no baseline is configured, or the question is already pending. task 157: static app-header markup (index.html); app-router re-hides it on every navigation.
    const reaskBaselineButton = document.getElementById("reask-baseline-btn") as HTMLButtonElement;
    reaskBaselineButton.hidden = getBaselineChoice(context.project) === null;
    reaskBaselineButton.onclick = () => {
        clearBaselineChoice(context.project);
        dropProjectDocuments(context.project);
        void renderRoute();
    };
    bar.replaceChildren(searchInput, ...searchChrome, ...buttons);
    bar.hidden = false;
}
