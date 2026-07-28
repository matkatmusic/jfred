// Revision-timeline render orchestrator: one chronological row per reconstruction step, view-model in timeline-*.ts, DOM groups in timeline-render-*.ts.

import { el } from "../app-dom.ts";
import { fetchDocument, fetchJson, fetchRawRecords } from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { getModeChoice } from "../app-choices.ts";
import { renderModeSelectionView } from "../app-mode-select.ts";
import { showLoadingProgress } from "../app-progress.ts";
import { openInspectorPane } from "../inspector.ts";
import { renderDetailsFileMode } from "./details-revision-view.ts";
import { renderForkSidebar } from "./sidebar.ts";
import { buildCoverageSegmentsByTarget, renderReconstructionBanner } from "./reconstruction-render.ts";
import {
    buildFileTree,
    buildFilesSidebarViewModel,
} from "./timeline-file-tree.ts";
import { findTimelineNodeIndexForRawLine } from "./timeline-labels.ts";
import { checkAllLinesIsOn } from "./timeline-line-nodes.ts";
import { buildTurnTimelineViewModel } from "./timeline-nodes.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { clearActiveChip, markChipActive } from "./timeline-render-chips.ts";
import {
    findTranscriptLineForChangeId,
    openNodeInspector,
    openTranscriptInspectorSynced,
    resolveChipLineLocations,
    resolveLineLabels,
} from "./timeline-render-inspectors.ts";
import { renderTimelineFilterBar } from "./timeline-render-filterbar.ts";
import { buildTimelineRows } from "./timeline-render-rows.ts";
import { fetchRangePatch, renderSelectbarButtons, updateSelectbar } from "./timeline-render-selectbar.ts";
import {
    flashRowElement,
    jumpToTimelineRow,
    selectTimelineRow,
    wireFileNavButtons,
    wireToggleAllButton,
} from "./timeline-render-selection.ts";
import {
    buildSessionsSidebarViewModel,
    computeGraphLaneRuns,
    SESSION_LANE_VARIABLES,
    waitForNextAnimationFrame,
    type WireProjectListing,
} from "./timeline-sessions.ts";
import {
    type TranscriptLocation,
    type WireTimelineDocument,
} from "./timeline-types.ts";
import type { DetailsContext } from "./details-model.ts";

// The /file/ drawer route reads this pass's DetailsContext, set here since renderTimelineView always runs first.
export let activeDetailsContext: DetailsContext | undefined;

function selectTimelineRowAndFlash(context: TimelineRenderContext, nodeIndex: number): void {
    void selectTimelineRow(context, nodeIndex).then(() => {
        const row = context.nodeRows.get(nodeIndex);
        if (row !== undefined) {
            flashRowElement(row);
        }
    });
}

async function openRecordInspectorForChangeId(context: TimelineRenderContext, changeId: string): Promise<void> {
    const located = await findTranscriptLineForChangeId(context, changeId);
    // Synthetic changeIds (user-edit / evidence splices) match no JSONL line.
    if (located === undefined) {
        openInspectorPane().append(
            el("div", { class: "muted", text: "no transcript line for this revision (synthetic change id)" }),
        );
        return;
    }
    openTranscriptInspectorSynced(context, located);
}

function renderFileDetails(target: string, detailsContext: DetailsContext): void {
    void renderDetailsFileMode(target, detailsContext);
}

// anchorJsonl scrolls to that session's first node; anchorLine is a 0-based raw line of it.
export async function renderTimelineView(container: HTMLElement, project: string, anchorJsonl?: string, anchorLine?: string): Promise<void> {
    // The reconstruction-mode decision gets its own view, before any build work is kicked off.
    if (getModeChoice(project) === null) {
        await renderModeSelectionView(container, project);
        return;
    }
    const result = await fetchDocument(project, undefined);
    if (result.baselineQuestion !== undefined) {
        renderBaselineQuestionDialog(container, project, result.baselineQuestion);
        return;
    }
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    const reconstructionDocument = result.document as WireTimelineDocument;
    // The view-model build below blocks the thread; re-show an indicator first since the shimmer keeps animating on the compositor.
    showLoadingProgress("preparing timeline…", Number.NaN);
    await waitForNextAnimationFrame();
    const { nodes } = buildTurnTimelineViewModel(reconstructionDocument, checkAllLinesIsOn());
    const listing = (await fetchJson<WireProjectListing[]>("/api/projects")).find((entry) => entry.name === project);

    const sessionColors = new Map<string, string>();
    for (const node of nodes) {
        if (node.sessionId === undefined) {
            continue;
        }
        if (sessionColors.has(node.sessionId)) {
            continue;
        }
        sessionColors.set(node.sessionId, `var(${SESSION_LANE_VARIABLES[sessionColors.size % SESSION_LANE_VARIABLES.length]})`);
    }

    // The pane header's summary and expand-all button are static skeleton elements outside `container`, so each render rewrites them.
    const numberedNodes = nodes.filter((node) => node.stepNumber !== undefined);
    const touchedCount = new Set(nodes.flatMap((node) => (node.fileChanges ?? []).map((change) => change.path))).size;
    document.getElementById("timeline-summary")!.textContent =
        `${sessionColors.size} session${sessionColors.size === 1 ? "" : "s"} · ${numberedNodes.length} steps · ${touchedCount} files`;
    renderReconstructionBanner(reconstructionDocument);

    const barText = el("span", {});
    const ruleHint = el("span", { class: "timeline-rule", text: "picks must be contiguous — commits are hard stops" });
    // Visibility is the .visible class, driven by updateSelectbar.
    const selectbar = document.getElementById("timeline-selectbar")!;
    selectbar.hidden = false;
    selectbar.classList.remove("visible");

    // The one shared render context every timeline-render-* module calls through.
    const context: TimelineRenderContext = {
        project,
        nodes,
        listing,
        reconstructionDocument,
        sessionColors,
        pickBoxes: new Map<number, HTMLInputElement>(),
        nodeRows: new Map<number, HTMLElement>(),
        previewPanes: new Map<number, HTMLElement>(),
        expandableRows: [],
        lineLabels: new Map<number, string>(),
        chipLineLocations: new Map<string, TranscriptLocation>(),
        laneRuns: computeGraphLaneRuns(nodes),
        selectedRow: null,
        fileNavReferenceIndex: -1,
        pickedIndexes: [],
        activeChip: null,
        cachedPatch: { key: "", text: "" },
        selectbar,
        barText,
        ruleHint,
        selectTimelineRow: (nodeIndex: number) => selectTimelineRow(context, nodeIndex),
        jumpToTimelineRow: (nodeIndex: number) => jumpToTimelineRow(context, nodeIndex),
        openNodeInspector: (nodeIndex: number) => openNodeInspector(context, nodeIndex),
        clearActiveChip: () => clearActiveChip(context),
        markChipActive: (chipElement: HTMLElement) => markChipActive(context, chipElement),
        updateSelectbar: () => updateSelectbar(context),
        refreshFileNavButtons: () => {},               // no-op until wireFileNavButtons runs
        updateToggleLabel: () => {},                   // no-op until wireToggleAllButton runs
        detailsContext: {
            project,
            document: reconstructionDocument,
            nodes,
            openNodeInspector: (nodeIndex: number) => openNodeInspector(context, nodeIndex),
            selectTimelineRow: (nodeIndex: number) => selectTimelineRowAndFlash(context, nodeIndex),
            // item 84: opening a rev card's causing record fills only the right column, so the left-side rev cards stay visible.
            openRecordForChangeId: (changeId: string) => void openRecordInspectorForChangeId(context, changeId),
            fetchRangePatch: (fromStep: number, toStep: number) => fetchRangePatch(context, fromStep, toStep),
        },
    };
    // task 93: publish this pass's DetailsContext for the /file/ drawer route.
    activeDetailsContext = context.detailsContext;

    renderSelectbarButtons(context);
    await resolveLineLabels(context);
    await resolveChipLineLocations(context);
    await buildTimelineRows(context, container);
    renderTimelineFilterBar(context, document.getElementById("timeline-filter-bar")!);
    wireToggleAllButton(context);
    wireFileNavButtons(context);

    // ── fork sidebar (phase 6): the Sessions + Files panes in the static #drawer ──
    renderForkSidebar(
        document.getElementById("drawer")!,
        buildSessionsSidebarViewModel(nodes, listing),
        buildFileTree(buildFilesSidebarViewModel(reconstructionDocument)),
        {
            onSessionClick: context.jumpToTimelineRow,
            onFileClick: (target: string) => renderFileDetails(target, context.detailsContext),
        },
        buildCoverageSegmentsByTarget(reconstructionDocument),
    );

    // (item 66) fork port removed the old drawer chrome (see webapp/archive/timeline-pre-item66.ts); the CSS gutter and details pane replace it.

    // ── session anchor (…/timeline/session/<jsonl>): flash-scroll the session's first row ──
    if (anchorJsonl !== undefined && anchorLine === undefined) {
        const firstNodeIndex = nodes.findIndex((candidate) =>
            candidate.sessionId !== undefined && anchorJsonl.startsWith(candidate.sessionId));
        if (firstNodeIndex >= 0) {
            context.jumpToTimelineRow(firstNodeIndex);
        }
    }

    // Line anchor (…/at/<n>): select the row, open its exact line, then center-scroll last since opening reflows the panes (item 37).
    if (anchorLine !== undefined) {
        const rawLines = await fetchRawRecords(project, anchorJsonl!);
        const rawLineIndex = Number(anchorLine);
        const nodeIndex = findTimelineNodeIndexForRawLine(nodes, rawLines[rawLineIndex] ?? "");
        if (nodeIndex >= 0) {
            await context.selectTimelineRow(nodeIndex);
        }
        openTranscriptInspectorSynced(context, { jsonlName: anchorJsonl!, rawLines, line: rawLineIndex });
        context.nodeRows.get(nodeIndex)?.scrollIntoView({ block: "center" });
    }
}
