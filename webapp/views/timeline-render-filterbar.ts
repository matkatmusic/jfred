// Timeline event-type filter bar (task 114) and keyword search box (task 127), wired over timeline-filter-model.ts.

import { createElement } from "../app-dom.ts";
import { computeMatchCounterLabel, computeWrappedMatchIndex } from "./details-find-model.ts";
import {
  TIMELINE_FILTER_BUTTONS,
  TIMELINE_FILTER_MODES,
  type TimelineFilterMode,
} from "./timeline-filter-model.ts";
import {
  computeMatchingNodeIndexes,
  computeSessionTitleByNodeIndex,
  isNodePassingFilters,
} from "./timeline-filter-search.ts";
import {
  ACTIVE_BUTTON_CLASS,
  initAllLinesButton,
  initReaskBaselineButton,
  markActiveButton,
} from "./timeline-render-filterbar-buttons.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";

const FILTERED_OUT_ROW_CLASS = "tl-filtered-out";
const CURRENT_MATCH_ROW_CLASS = "tl-search-current";

// Hide every row failing the combined mode+search predicate; restore the rest.
function applyTimelineFilters(context: TimelineRenderContext, mode: TimelineFilterMode, term: string, sessionTitleByNodeIndex: Map<number, string>): void {
  for (const [index, node] of context.nodes.entries()) {
    const row = context.nodeRows.get(index);
    if (row === undefined) {
      continue;
    }
    row.classList.toggle(FILTERED_OUT_ROW_CLASS, !isNodePassingFilters(node, mode, term, sessionTitleByNodeIndex.get(index)));
  }
}

// Set the hidden flag on every element of the search chrome.
function setElementsHidden(elements: HTMLElement[], hidden: boolean): void {
  for (const element of elements) {
    element.hidden = hidden;
  }
}

// Build the search box and single-select mode buttons into `bar` and unhide it; All starts active.
export function renderTimelineFilterBar(context: TimelineRenderContext, bar: HTMLElement): void {
  let activeMode: TimelineFilterMode = TIMELINE_FILTER_MODES.all;
  let searchTerm = "";
  const searchInput = createElement("input", { class: "timeline-search", type: "search", placeholder: "🔍 search" }) as HTMLInputElement;
  // Search chrome shows only while a term is entered: counter, step buttons, clear button.
  let matchNodeIndexes: number[] = [];
  let currentMatchPosition = -1;
  let currentMatchRow: HTMLElement | null = null;
  const countLabel = createElement("span", { class: "search-count" });
  const prevButton = createElement("button", { class: "search-step", text: "▲", title: "Previous result" }) as HTMLButtonElement;
  const nextButton = createElement("button", { class: "search-step", text: "▼", title: "Next result" }) as HTMLButtonElement;
  const clearButton = createElement("button", { class: "search-clear", text: "✕", title: "Clear search" }) as HTMLButtonElement;
  const searchChrome = [countLabel, prevButton, nextButton, clearButton];
  setElementsHidden(searchChrome, true);
  // Mark the current match row and select it, unless it is already selected.
  const selectCurrentMatch = () => {
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
    selectCurrentMatch();
  };
  // Task 148: session titles join the search; the node list is fixed per render.
  const sessionTitleByNodeIndex = computeSessionTitleByNodeIndex(context.nodes, context.reconstructionDocument.sessionTitles);
  // Re-derive the result list for the current term and mode, then land on result #1.
  const refreshFilteredRows = () => {
    applyTimelineFilters(context, activeMode, searchTerm, sessionTitleByNodeIndex);
    const hasTerm = searchTerm.trim() !== "";
    matchNodeIndexes = hasTerm ? computeMatchingNodeIndexes(context.nodes, activeMode, searchTerm, sessionTitleByNodeIndex) : [];
    currentMatchPosition = matchNodeIndexes.length === 0 ? -1 : 0;
    setElementsHidden(searchChrome, !hasTerm);
    updateCounterAndJump();
  };
  const moveMatchPosition = (delta: number) => {
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
    moveMatchPosition(event.shiftKey ? -1 : 1);
  };
  prevButton.onclick = () => moveMatchPosition(-1);
  nextButton.onclick = () => moveMatchPosition(1);
  clearButton.onclick = () => {
    searchInput.value = "";
    searchTerm = "";
    refreshFilteredRows();
    searchInput.focus();
  };
  const buttons: HTMLButtonElement[] = [];
  for (const [mode, label] of TIMELINE_FILTER_BUTTONS) {
    const button = createElement("button", { class: "toolbar-btn", text: label }) as HTMLButtonElement;
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
  initAllLinesButton();
  initReaskBaselineButton(context.project);
  bar.replaceChildren(searchInput, ...searchChrome, ...buttons);
  bar.hidden = false;
}
