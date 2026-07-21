// Timeline row construction (task 92 split from timeline.ts): the batched one-.tl-row-per-node
// build loop behind the progress overlay. The per-cell builders (fork gutter, commit cells,
// triangle, { } button, bubble) live in timeline-render-row-cells.ts (task 121 split, 250-line cap).

import { el } from "../app-dom.ts";
import { hideLoadingProgress, showLoadingProgress } from "../app-progress.ts";
import {
    computeRolePillClass,
    computeRolePillLabel,
    computeRowSummaryText,
    computeSessionShortLabel,
    findSessionStartIndexes,
} from "./timeline-labels.ts";
import { appendGapRows, computeGapRowBuckets } from "./reconstruction-render.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import {
    appendCommitCells,
    appendExpandedBubble,
    appendExpansionTriangle,
    appendJsonRecordButton,
    appendSessionStartMarker,
    buildGraphCell,
    computeRoleClass,
} from "./timeline-render-row-cells.ts";
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
    COMMIT_NODE_KIND,
    TOOL_CALL_NODE_KIND,
} from "./timeline-types.ts";

// ── rows: one .tl-row per node (mockup renderTimeline) ──
export async function buildTimelineRows(context: TimelineRenderContext, container: HTMLElement): Promise<void> {
    // Session-start markers: an interleaved multi-JSONL project otherwise never shows where
    // a later session began (item 66 follow-up, user-reported on s58).
    const sessionStartsByIndex = new Map(
        findSessionStartIndexes(context.nodes).map((start) => [start.nodeIndex, start.sessionId]),
    );
    // task 119: dashed gap rows for skipped transcript lines, bucketed by the node index each
    // renders before (bucket nodes.length lands after the loop).
    const gapRowBuckets = computeGapRowBuckets(context.reconstructionDocument, context.nodes);
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

        appendGapRows(rowFragment, gapRowBuckets.get(index));
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
            appendCommitCells(context, line, row, node);
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
        // agent turns and the merged baseline commit row (the kept renderFileButtonRow machinery).
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
    appendGapRows(rowFragment, gapRowBuckets.get(context.nodes.length));   // gaps past the last node
    // Reveal the finished timeline in one append — the first moment any row hits the live DOM.
    container.append(rowFragment);
    } finally {
        hideLoadingProgress();
    }
}
