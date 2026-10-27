// The drawer overlay for a project's jsonl/file sub-routes, plus the details-pane reset that every route change runs first.

import { openInspectorPane } from "./inspector-pane.ts";
import { peekCachedDocument } from "./app-fetch.ts";
import { renderConversationView } from "./views/conversation.ts";
import { computeFileRouteFocus } from "./views/details-model.ts";
import { renderDetailsFileMode } from "./views/details-revision-view.ts";
import { renderDiffVsBaseView } from "./views/diff-vs-base.ts";
import { renderRawLinesView } from "./views/raw-lines.ts";
import { activeDetailsContext } from "./views/timeline.ts";

// task 93: the file route lands in the Revision View, focused on the /rev/<n> anchor when present.
function renderFileRouteInRevisionView(target: string, segments: string[]): void {
  if (activeDetailsContext === undefined) {
    return;
  }
  const anchorRev = segments[4] === "rev" ? segments[5] : undefined;
  const focus = computeFileRouteFocus(activeDetailsContext.document.filesTouched, target, anchorRev);
  renderDetailsFileMode(target, activeDetailsContext, focus);
}

// Render the route's view into the inspector pane; no drawer until a document is cached.
export async function renderSubRouteDrawer(project: string, segments: string[]): Promise<void> {
  const cachedDocument = peekCachedDocument(project);
  if (cachedDocument === undefined) {
    return;
  }
  let renderContent: ((content: HTMLElement) => unknown) | undefined;
  // item 66: the Details pane header names the sub-route the drawer shows.
  let headerText: string | undefined;
  if (segments[2] === "jsonl") {
    const jsonl = segments[3]!;
    if (segments[4] === "lines") {
      headerText = `Raw lines — ${jsonl}`;
      renderContent = (content: HTMLElement) => renderRawLinesView(content, project, jsonl);
    }
    else {
      headerText = `Conversation — ${jsonl}`;
      renderContent = (content: HTMLElement) => renderConversationView(content, project, jsonl, segments[4] === "at" ? segments[5] : undefined);
    }
  }
  else if (segments[2] === "file") {
    const target = segments[3]!;
    if (segments[4] === "vsbase") {
      headerText = `Diff vs base — ${target}`;
      renderContent = (content: HTMLElement) => renderDiffVsBaseView(content, project, target, segments[5]);
    }
    else {
      // task 93: the File History view is retired; the Revision View sets its own header, so the tail must not run.
      // headerText = `File history — ${target}`;
      // renderContent = (content: HTMLElement) => renderFileHistoryView(content, project, target, segments[4] === "rev" ? segments[5] : undefined);
      renderFileRouteInRevisionView(target, segments);
      return;
    }
  }
  if (renderContent === undefined) {
    return;
  }
  const content = openInspectorPane();
  document.getElementById("details-header")!.textContent = headerText!;
  await renderContent(content);
}

// item 66: the static #inspector skeleton is hidden and its content columns cleared on every route change.
export function resetDetailsPane(): void {
  document.getElementById("inspector")!.classList.add("hidden");
  document.getElementById("details-left")?.replaceChildren();
  document.getElementById("details-right-body")?.replaceChildren();
  const header = document.getElementById("details-header");
  if (header !== null) {
    header.textContent = "No selection";
  }
}
