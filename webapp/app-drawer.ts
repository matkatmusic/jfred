// The drawer overlay for a project's jsonl/file sub-routes, plus the details-pane reset that
// every route change runs first.

import { openInspectorPane } from "./inspector.ts";
import { peekCachedDocument } from "./app-fetch.ts";
import { renderConversationView } from "./views/conversation.ts";
import { computeFileRouteFocus } from "./views/details-model.ts";
import { renderDetailsFileMode } from "./views/details-revision-view.ts";
import { renderDiffVsBaseView } from "./views/diff-vs-base.ts";
import { renderRawLinesView } from "./views/raw-lines.ts";
import { activeDetailsContext } from "./views/timeline.ts";

// task 93: the file route's landing — THE Revision View, focused on the /rev/<n> anchor when
// present. activeDetailsContext is set by renderTimelineView, which app-router.ts always runs
// before renderSubRouteDrawer; undefined only if the timeline render itself failed.
function renderFileRouteInRevisionView(target: string, segments: string[]): void {
    if (activeDetailsContext === undefined) {
        return;
    }
    const anchorRev = segments[4] === "rev" ? segments[5] : undefined;
    const focus = computeFileRouteFocus(activeDetailsContext.document.filesTouched, target, anchorRev);
    renderDetailsFileMode(target, activeDetailsContext, focus);
}

// The drawer overlay for a project's jsonl/file sub-routes: the route's view renders into the
// inspector pane over the timeline. No drawer while the consent dialog or a build error still
// owns the view (no document is cached yet — the sub-views would only re-show the dialog).
export async function renderSubRouteDrawer(project: string, segments: string[]): Promise<void> {
    if (peekCachedDocument(project) === undefined) {
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
        } else {
            headerText = `Conversation — ${jsonl}`;
            renderContent = (content: HTMLElement) => renderConversationView(content, project, jsonl, segments[4] === "at" ? segments[5] : undefined);
        }
    } else if (segments[2] === "file") {
        const target = segments[3]!;
        if (segments[4] === "vsbase") {
            headerText = `Diff vs base — ${target}`;
            renderContent = (content: HTMLElement) => renderDiffVsBaseView(content, project, target, segments[5]);
        } else {
            // task 93: the File History view is retired (webapp/archive/) — the route lands in
            // THE Revision View instead. renderDetailsFileMode reveals the pane and sets its
            // own header, so the drawer's openInspectorPane/headerText tail must not run.
            // task 93: was — headerText = `File history — ${target}`;
            // task 93: was — renderContent = (content: HTMLElement) => renderFileHistoryView(content, project, target, segments[4] === "rev" ? segments[5] : undefined);
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

// item 66: the details pane (#inspector) is now a STATIC skeleton (index.html) — a route
// change hides it and clears only its content columns instead of wiping it wholesale.
// Null-safe on the inner ids because the pre-phase-5 openInspectorPane still rebuilds the
// pane's children wholesale in the interim.
export function resetDetailsPane(): void {
    document.getElementById("inspector")!.classList.add("hidden");
    document.getElementById("details-left")?.replaceChildren();
    document.getElementById("details-right-body")?.replaceChildren();
    const header = document.getElementById("details-header");
    if (header !== null) {
        header.textContent = "No selection";
    }
}
