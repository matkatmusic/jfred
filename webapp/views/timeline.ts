// Revision-timeline render orchestrator: one chronological row per reconstruction step.

import { createElement } from "../app-dom.ts";
import { fetchDocument } from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { getModeChoice } from "../app-choices.ts";
import { renderModeSelectionView } from "../app-mode-select.ts";
import { showLoadingProgress } from "../app-progress.ts";
import { renderDetailsFileMode } from "./details-revision-view.ts";
import { renderForkSidebar } from "./sidebar.ts";
import { buildCoverageSegmentsByTarget, renderReconstructionBanner } from "./reconstruction-render.ts";
import { buildFileTree } from "./timeline-file-tree.ts";
import { buildFilesSidebarViewModel } from "./timeline-file-tree-sidebar.ts";
import { checkAllLinesIsOn } from "./timeline-line-nodes.ts";
import { buildTurnTimelineViewModel } from "./timeline-nodes.ts";
import { moveToSessionAnchor, openLineAnchor } from "./timeline-anchors.ts";
import { createTimelineRenderContext } from "./timeline-context.ts";
import { resolveChipLineLocations, resolveLineLabels } from "./timeline-render-inspectors.ts";
import { renderTimelineFilterBar } from "./timeline-render-filterbar.ts";
import { buildTimelineRows } from "./timeline-render-rows.ts";
import { renderSelectbarButtons } from "./timeline-render-pickbar.ts";
import { attachFileNavButtons, attachToggleAllButton } from "./timeline-render-selection.ts";
import { buildSessionsSidebarViewModel, waitForNextAnimationFrame } from "./timeline-sessions.ts";
import type { WireTimelineDocument } from "./timeline-wire-types.ts";
import { buildSessionColors, fetchProjectListing, formatTimelineSummary } from "./timeline-view-setup.ts";
import type { DetailsContext } from "./details-model.ts";

// The /file/ drawer route reads this pass's DetailsContext, set here since renderTimelineView always runs first.
export let activeDetailsContext: DetailsContext | undefined;

function renderFileDetails(target: string, detailsContext: DetailsContext): void {
  void renderDetailsFileMode(target, detailsContext);
}

// anchorJsonl scrolls to that session's first node; anchorLine is a 0-based raw line of it.
export async function renderTimelineView(container: HTMLElement, project: string, anchorJsonl?: string, anchorLine?: string): Promise<void> {
  // The reconstruction-mode decision gets its own view, before any build work is kicked off.
  const modeChoice = getModeChoice(project);
  if (modeChoice === null) {
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
  // The view-model build blocks the thread; re-show an indicator first.
  showLoadingProgress("preparing timeline…", Number.NaN);
  await waitForNextAnimationFrame();
  const { nodes } = buildTurnTimelineViewModel(reconstructionDocument, checkAllLinesIsOn());
  const listing = await fetchProjectListing(project);
  const sessionColors = buildSessionColors(nodes);

  // The pane header's summary is a static element outside `container`, so each render rewrites it.
  document.getElementById("timeline-summary")!.textContent = formatTimelineSummary(nodes, sessionColors.size);
  renderReconstructionBanner(reconstructionDocument);

  const barText = createElement("span", {});
  const ruleHint = createElement("span", { class: "timeline-rule", text: "picks must be contiguous — commits are hard stops" });
  // Visibility is the .visible class, driven by updateSelectbar.
  const selectbar = document.getElementById("timeline-selectbar")!;
  selectbar.hidden = false;
  selectbar.classList.remove("visible");

  const context = createTimelineRenderContext({ project, nodes, listing, reconstructionDocument, sessionColors, selectbar, barText, ruleHint });
  // task 93: publish this pass's DetailsContext for the /file/ drawer route.
  activeDetailsContext = context.detailsContext;

  renderSelectbarButtons(context);
  await resolveLineLabels(context);
  await resolveChipLineLocations(context);
  await buildTimelineRows(context, container);
  renderTimelineFilterBar(context, document.getElementById("timeline-filter-bar")!);
  attachToggleAllButton(context);
  attachFileNavButtons(context);

  // Fork sidebar: the Sessions + Files panes in the static #drawer.
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

  // Session anchor (…/timeline/session/<jsonl>) flash-scrolls to the session's first row.
  if (anchorLine === undefined) {
    if (anchorJsonl !== undefined) {
      moveToSessionAnchor(context, anchorJsonl);
    }
  }
  else {
    await openLineAnchor(context, anchorJsonl!, anchorLine);
  }
}
