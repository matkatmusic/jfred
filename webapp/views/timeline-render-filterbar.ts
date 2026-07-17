// Timeline event-type filter bar (task 114) — thin DOM wiring over timeline-filter-model.ts.
// Renders one .toolbar-btn per mode into #timeline-filter-bar; clicking a button hides every
// .tl-row whose node fails checkNodeMatchesFilterMode. State is per-render: navigation rebuilds
// the bar back at "All" (app-router re-hides the bar on every route change).

import { el } from "../app-dom.ts";
import {
    TIMELINE_FILTER_BUTTONS,
    TIMELINE_FILTER_MODES,
    checkNodeMatchesFilterMode,
    type TimelineFilterMode,
} from "./timeline-filter-model.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";

const ACTIVE_BUTTON_CLASS = "active";
const FILTERED_OUT_ROW_CLASS = "tl-filtered-out";

// Hide every row whose node fails the mode's predicate; restore the rest.
function applyTimelineFilterMode(context: TimelineRenderContext, mode: TimelineFilterMode): void {
    for (const [index, node] of context.nodes.entries()) {
        const row = context.nodeRows.get(index);
        if (row === undefined) {
            continue;
        }
        row.classList.toggle(FILTERED_OUT_ROW_CLASS, !checkNodeMatchesFilterMode(node, mode));
    }
}

// Mark exactly one button of the group as the active mode.
function markActiveButton(buttons: HTMLButtonElement[], activeButton: HTMLButtonElement): void {
    for (const button of buttons) {
        button.classList.toggle(ACTIVE_BUTTON_CLASS, button === activeButton);
    }
}

// Build the single-select mode buttons into `bar` and unhide it; the All button starts active.
export function renderTimelineFilterBar(context: TimelineRenderContext, bar: HTMLElement): void {
    const buttons: HTMLButtonElement[] = [];
    for (const [mode, label] of TIMELINE_FILTER_BUTTONS) {
        const button = el("button", { class: "toolbar-btn", text: label }) as HTMLButtonElement;
        if (mode === TIMELINE_FILTER_MODES.all) {
            button.classList.add(ACTIVE_BUTTON_CLASS);
        }
        button.onclick = () => {
            markActiveButton(buttons, button);
            applyTimelineFilterMode(context, mode);
        };
        buttons.push(button);
    }
    bar.replaceChildren(...buttons);
    bar.hidden = false;
}
