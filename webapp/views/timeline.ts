// Revision-timeline view (#/project/<name>/timeline): the render orchestrator — one row per
// reconstruction step across EVERY JSONL in the project, strictly chronological, with git-commit
// nodes as pick hard-stops. The DOM-free view-model lives in the timeline-*.ts modules
// (timeline-types / -nodes / -changes / -commit-files / -picks / -labels / -file-tree /
// -sessions); the DOM render groups live in the timeline-render-*.ts modules (-context /
// -inspectors / -selectbar / -chips / -rows / -selection), all sharing one
// TimelineRenderContext built here (task 92 split).

import { el } from "../app-dom.ts";
import { fetchDocument, fetchJson, fetchRawRecords } from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { showLoadingProgress } from "../app-progress.ts";
import { openInspectorPane } from "../inspector.ts";
import { renderDetailsFileMode } from "./details-revision-view.ts";
import { renderForkSidebar } from "./sidebar.ts";
import {
    buildFileTree,
    buildFilesSidebarViewModel,
} from "./timeline-file-tree.ts";
import { findTimelineNodeIndexForRawLine } from "./timeline-labels.ts";
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
} from "./timeline-sessions.ts";
import {
    type TranscriptLocation,
    type WireProjectListing,
    type WireTimelineDocument,
} from "./timeline-types.ts";
import type { DetailsContext } from "./details-model.ts";

// task 93: the /file/ drawer route (app-drawer.ts) renders THE Revision View, which needs the
// current render pass's DetailsContext. renderTimelineView always runs before
// renderSubRouteDrawer (app-router.ts), so this is set whenever that route fires.
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
    // Synthetic changeIds (user-edit / evidence splices) match no JSONL line. Say so
    // in the right column rather than opening the inspector on nothing.
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

// The project-wide revision timeline (#/project/<name>/timeline[/session/<jsonl>]) — the default
// view a drawer JSONL link opens. anchorJsonl scrolls to that session's first node.
// anchorLine (optional, 0-based raw line of anchorJsonl): scroll to the owning step, open the
// inspector on it.
export async function renderTimelineView(container: HTMLElement, project: string, anchorJsonl?: string, anchorLine?: string): Promise<void> {
    const result = await fetchDocument(project, undefined);
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    // app.ts ships the streamed document as an opaque Record; this view reads the timeline fields.
    const reconstructionDocument = result.document as WireTimelineDocument;
    // fetchDocument hid its indicator on resolve, but the synchronous view-model build below runs over
    // the whole (large) document — that is the unresponsive, blank gap the user sees between
    // "transferring document" and "Building timeline". Put an indeterminate indicator back up and yield
    // one frame so the browser paints it first; the shimmer is transform-based, so it keeps animating on
    // the compositor even while this thread is blocked building the view-model. (item 82)
    showLoadingProgress("preparing timeline…", Number.NaN);
    await waitForNextAnimationFrame();
    const { nodes } = buildTurnTimelineViewModel(reconstructionDocument);
    const listing = (await fetchJson<WireProjectListing[]>("/api/projects")).find((entry) => entry.name === project);
    // (item 66) old local closure, lifted into the exported view-model helper findJsonlForSession:
    // const findJsonlForSession = (sessionId: string | undefined) =>
    //     listing?.jsonlFiles.find((file) => file.fileName.startsWith(sessionId!))?.fileName;

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

    // The pane header's summary + expand-all button are STATIC skeleton elements outside
    // `container` (index.html); each render rewrites them.
    const numberedNodes = nodes.filter((node) => node.stepNumber !== undefined);
    const touchedCount = new Set(nodes.flatMap((node) => (node.fileChanges ?? []).map((change) => change.path))).size;
    document.getElementById("timeline-summary")!.textContent =
        `${sessionColors.size} session${sessionColors.size === 1 ? "" : "s"} · ${numberedNodes.length} steps · ${touchedCount} files`;

    // ── selection state + bar ──
    const barText = el("span", {});
    const ruleHint = el("span", { class: "timeline-rule", text: "picks must be contiguous — commits are hard stops" });
    // The selectbar is the static #timeline-selectbar strip under the rows (fork layout);
    // visibility is the mockup's .visible class, driven by updateSelectbar.
    const selectbar = document.getElementById("timeline-selectbar")!;
    selectbar.hidden = false;
    selectbar.classList.remove("visible");

    // The one shared render context (task 92): per-render state, DOM anchors, and the
    // cross-group calls the timeline-render-* modules make through it.
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
        // Built once per render; the details pane drives the timeline back through these callbacks.
        detailsContext: {
            project,
            document: reconstructionDocument,
            nodes,
            openNodeInspector: (nodeIndex: number) => openNodeInspector(context, nodeIndex),
            selectTimelineRow: (nodeIndex: number) => selectTimelineRowAndFlash(context, nodeIndex),
            // item 84: a rev card's { } opens its revision's causing record. openInspectorPane fills
            // the right column ONLY, so the rev cards on the left stay standing — that is exactly
            // the "revision cards still shown" the item asks for, at no cost.
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
    );

    // (item 66) GONE with the fork port (see webapp/archive/timeline-pre-item66.ts): the
    // background click-to-close handler, the SVG drawRail + resize listener, the per-session
    // header rows, and the orphan divider — the CSS gutter and the details pane replace them.

    // ── session anchor (…/timeline/session/<jsonl>): flash-scroll the session's first row ──
    if (anchorJsonl !== undefined && anchorLine === undefined) {
        const firstNodeIndex = nodes.findIndex((candidate) =>
            candidate.sessionId !== undefined && anchorJsonl.startsWith(candidate.sessionId));
        if (firstNodeIndex >= 0) {
            context.jumpToTimelineRow(firstNodeIndex);
        }
    }

    // Line anchor (…/at/<n>): select the owning row, open the inspector on that exact line
    // (openStepInspector would re-derive first-matching changeId and could land elsewhere),
    // and only THEN center-scroll — the details open reflows the panes (item 37 ordering).
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
