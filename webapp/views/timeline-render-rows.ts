// Timeline row construction (task 92 split from timeline.ts): the fork gutter cell, the role
// classes, and the batched one-.tl-row-per-node build loop behind the progress overlay.

import { el } from "../app-dom.ts";
import { hideLoadingProgress, showLoadingProgress } from "../app-progress.ts";
import {
    computeRolePillClass,
    computeRolePillLabel,
    computeRowSummaryText,
    computeSessionShortLabel,
    computeSessionStartLabel,
    findSessionStartIndexes,
} from "./timeline-labels.ts";
import { renderFileButtonRow } from "./timeline-render-chips.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { buildPickCell } from "./timeline-render-selectbar.ts";
import {
    checkRowIsExpandable,
    checkTimelineNeedsProgressOverlay,
    computeTimelineBuildProgressLabel,
    computeTimelineProgressFraction,
    ORPHAN_LANE_COLOR,
    TIMELINE_BUILD_BATCH_SIZE,
    waitForNextAnimationFrame,
} from "./timeline-sessions.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type TimelineNode,
} from "./timeline-types.ts";

// The mockup's role-* text/bubble class per node kind (agent turns are the assistant role).
function computeRoleClass(kind: TimelineNode["kind"]): string {
    if (kind === USER_TURN_NODE_KIND) {
        return "role-user";
    }
    if (kind === AGENT_TURN_NODE_KIND) {
        return "role-assistant";
    }
    if (kind === TOOL_CALL_NODE_KIND) {
        return "role-tool";
    }
    if (kind === COMMIT_NODE_KIND) {
        return "role-commit";
    }
    return "role-end";
}

// Commit and session-end dots render hollow (border ring) — both read as terminators (the old
// SVG rail's convention, now the .g-hollow class).
function checkDotIsHollow(kind: TimelineNode["kind"]): boolean {
    if (kind === COMMIT_NODE_KIND) {
        return true;
    }
    return kind === SESSION_END_NODE_KIND;
}

// The fork gutter cell (mockup buildGraphCell): the lane-1 rail tinted with the row's session
// color; rows inside a computeGraphLaneRuns run add the lane-2 rail (fork curve on the run's
// first row, cut-off on its last) and put their dot on lane 2 (CSS colors it).
function buildGraphCell(kind: TimelineNode["kind"], index: number, laneRuns: { startIndex: number; endIndex: number }[], sessionColor: string): HTMLElement {
    const cell = el("div", { class: "tl-graph" });
    cell.append(el("span", { class: "g-rail g-l1", style: `background:${sessionColor}` }));
    const run = laneRuns.find((candidate) => index >= candidate.startIndex && index <= candidate.endIndex);
    if (run !== undefined) {
        const lane2 = el("span", { class: "g-rail g-l2" });
        if (index === run.startIndex) {
            lane2.classList.add("g-start");
            cell.append(el("span", { class: "g-fork" }));
        }
        if (index === run.endIndex) {
            lane2.classList.add("g-end");
        }
        cell.append(lane2);
    }
    const dot = el("span", { class: `g-dot ${run === undefined ? "g-l1" : "g-l2"}` });
    if (checkDotIsHollow(kind)) {
        dot.classList.add("g-hollow");
        dot.style.color = sessionColor;                    // .g-hollow's ring is currentColor
    } else if (run === undefined) {
        dot.style.background = sessionColor;               // lane-2 dots keep the CSS lane color
    }
    cell.append(dot);
    return cell;
}

// The tinted session-start marker row (extracted from buildTimelineRows).
function appendSessionStartMarker(context: TimelineRenderContext, rowFragment: DocumentFragment, sessionColor: string, startedSessionId: string): void {
    const marker = el("div", { class: "tl-session-start" });
    marker.style.color = sessionColor;
    marker.append(el("span", {
        class: "tl-session-start-label",
        text: computeSessionStartLabel(context.reconstructionDocument.sessionTitles, startedSessionId),
    }));
    rowFragment.append(marker);
}

// The commit row's spacer, label, and (when a hash exists) hash pill (extracted from buildTimelineRows).
function appendCommitCells(line: HTMLElement, node: TimelineNode): void {
    line.append(el("span", { class: "tl-tri", text: "" }));   // spacer keeps columns aligned
    line.append(el("span", { class: "commit-label", text: "git commit" }));
    if (node.resultHash !== undefined) {                       // no hash → no pill (a blank "—" reads broken)
        line.append(el("span", { class: "commit-pill", text: node.resultHash }));
    }
}

// The ▸ triangle that toggles a row's expanded state (extracted from buildTimelineRows).
function appendExpansionTriangle(context: TimelineRenderContext, line: HTMLElement, row: HTMLElement): void {
    const tri = el("span", { class: "tl-tri", text: "▸" });
    tri.addEventListener("click", (event) => {
        event.stopPropagation();                   // expansion must not change selection
        row.classList.toggle("expanded");
        context.updateToggleLabel();
    });
    line.append(tri);
}

// The { } button that opens the row's JSONL record in the details pane (extracted from buildTimelineRows).
function appendJsonRecordButton(context: TimelineRenderContext, line: HTMLElement, index: number): void {
    line.append(el("button", {
        class: "tl-json",
        text: "{ }",
        title: "Show this row's JSONL record in the details pane",
        onclick: async (event: Event) => {
            event.stopPropagation();
            await context.selectTimelineRow(index);
            context.openNodeInspector(index);
        },
    }));
}

// The expanded row's bubble: full text plus agent-turn file chips (extracted from buildTimelineRows).
function appendExpandedBubble(context: TimelineRenderContext, node: TimelineNode, index: number, previewPane: HTMLElement, main: HTMLElement, row: HTMLElement): void {
    const bubble = el("div", { class: `tl-bubble ${computeRoleClass(node.kind)}` });
    bubble.append(node.kind === TOOL_CALL_NODE_KIND ? `${node.toolName}(${node.summary})` : node.text ?? "");
    if (node.kind === AGENT_TURN_NODE_KIND) {
        bubble.append(el("div", { class: "timeline-chips" },
            node.fileChanges!.map((change) => renderFileButtonRow(context, node, index, change, previewPane))));
    }
    main.append(bubble);
    context.expandableRows.push(row);
}

// ── rows: one .tl-row per node (mockup renderTimeline) ──
export async function buildTimelineRows(context: TimelineRenderContext, container: HTMLElement): Promise<void> {
    // Session-start markers: an interleaved multi-JSONL project otherwise never shows where
    // a later session began (item 66 follow-up, user-reported on s58).
    const sessionStartsByIndex = new Map(
        findSessionStartIndexes(context.nodes).map((start) => [start.nodeIndex, start.sessionId]),
    );
    // Large timelines build in yielding batches behind a centered progress overlay so the
    // multi-second synchronous DOM build (500+ rows) no longer looks frozen (item 78). Small
    // timelines take neither overlay nor yield — the loop stays a straight synchronous pass.
    // Rows accumulate in a DETACHED fragment and are appended to `container` only once the whole
    // build finishes: the half-built timeline must never show behind the overlay — the progress
    // bar stands alone until the timeline is ready (item 78 follow-up, user-reported).
    const showBuildProgress = checkTimelineNeedsProgressOverlay(context.nodes.length);
    const rowFragment = document.createDocumentFragment();
    if (showBuildProgress) {
        showLoadingProgress(computeTimelineBuildProgressLabel(0, context.nodes.length), computeTimelineProgressFraction(0, context.nodes.length));
        // Yield once so the overlay paints before the (blocking) first batch.
        await waitForNextAnimationFrame();
    }
    try {
    for (const [index, node] of context.nodes.entries()) {
        const sessionColor = node.sessionId === undefined
            ? ORPHAN_LANE_COLOR
            : context.sessionColors.get(node.sessionId) ?? ORPHAN_LANE_COLOR;

        const startedSessionId = sessionStartsByIndex.get(index);
        if (startedSessionId !== undefined) {
            appendSessionStartMarker(context, rowFragment, sessionColor, startedSessionId);
        }

        const previewPane = el("div", { class: "hidden" });
        context.previewPanes.set(index, previewPane);
        const row = el("div", { class: `tl-row${node.isOrphaned === true ? " orphan" : ""}` });
        row.append(buildGraphCell(node.kind, index, context.laneRuns, sessionColor));
        const main = el("div", { class: "tl-main" });
        const line = el("div", { class: "tl-line" });

        // Pick cell (existing pick model: only surviving agent turns with snapshots).
        line.append(buildPickCell(context, node, index));

        if (node.kind === COMMIT_NODE_KIND) {
            appendCommitCells(line, node);
        } else if (checkRowIsExpandable(node)) {
            appendExpansionTriangle(context, line, row);
        } else {
            line.append(el("span", { class: "tl-tri", text: "" }));   // session ends stay thin
        }
        const rolePillLabel = computeRolePillLabel(node);
        if (rolePillLabel !== undefined) {
            line.append(el("span", { class: `role-pill ${computeRolePillClass(rolePillLabel)}`, text: rolePillLabel }));
        }
        line.append(el("span", {
            class: `tl-text ${computeRoleClass(node.kind)}${node.isSystem === true ? " system" : ""}`,
            text: computeRowSummaryText(node),
        }));
        // task 103: a FAILED git command's rows (commit node / Bash tool-call row) badge red —
        // failed commands are badged, never suppressed.
        if (node.isError === true) {
            line.append(el("span", { class: "failed-badge", text: "FAILED" }));
        }
        // task 67: a script run the sandbox proved modified files carries its count on the row.
        if (node.scriptRun !== undefined) {
            line.append(el("span", { class: "script-files-badge", text: `modified ${node.scriptRun.changedPaths.length} file(s)` }));
        }
        line.append(el("span", { class: "tl-ts", text: new Date(node.when).toLocaleString() }));
        line.append(el("span", { class: "tl-pos", text: context.lineLabels.get(index) ?? "" }));
        line.append(el("span", { class: "tl-uuid", text: node.sessionId === undefined ? "" : computeSessionShortLabel(node.sessionId) }));
        if (node.kind !== COMMIT_NODE_KIND) {              // commits are repo events: no JSONL record
            appendJsonRecordButton(context, line, index);
        }
        line.addEventListener("click", () => {
            void context.selectTimelineRow(index);
        });
        main.append(line);

        // Expandable rows carry the mockup bubble: the full text, plus the file-chips block on
        // agent turns (the kept renderFileButtonRow machinery).
        if (checkRowIsExpandable(node)) {
            appendExpandedBubble(context, node, index, previewPane, main, row);
        }
        main.append(previewPane);
        row.append(main);
        rowFragment.append(row);
        context.nodeRows.set(index, row);
        if (showBuildProgress && (index + 1) % TIMELINE_BUILD_BATCH_SIZE === 0) {
            showLoadingProgress(computeTimelineBuildProgressLabel(index + 1, context.nodes.length), computeTimelineProgressFraction(index + 1, context.nodes.length));
            await waitForNextAnimationFrame();
        }
    }
    // Reveal the finished timeline in one append — the first moment any row hits the live DOM.
    container.append(rowFragment);
    } finally {
        hideLoadingProgress();
    }
}
