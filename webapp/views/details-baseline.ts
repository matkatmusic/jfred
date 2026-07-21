// task 56 follow-up: the git-derived baseline pane — the unrecoverable-placeholder pattern
// (task-126 banner stack) applied to base-commit beacon revisions. A beacon's computed diff
// is usually empty ("no content change in this revision"), so the pane shows the committed
// bytes themselves: a banner naming the base commit, a provenance note, then the revision's
// full content, syntax-highlighted.

import { el } from "../app-dom.ts";
import { showContentInDetails } from "./details-diff.ts";
import { extractGitBaseCommitHash } from "./timeline-changes.ts";
import {
    type WireDocument as WireHistoryDocument,
    buildFileHistoryViewModel,
    findRevisionForChangeId,
} from "./file-history-model.ts";

export function showGitBaselineInDetails(historyDocument: WireHistoryDocument, path: string, changeId: string): void {
    // The document's file histories carry each revision's own lines, so the committed
    // content is derivable client-side — no fetch.
    const link = findRevisionForChangeId(historyDocument.filesTouched, changeId);
    const revisionNumber = link?.revisionNumber ?? 1;
    const content = buildFileHistoryViewModel(historyDocument, path).revisions[revisionNumber - 1]?.content;
    // showContentInDetails owns the pane lifecycle (label, toggle reset, highlight); the
    // banner stack is prepended after, mirroring the task-126 unrecoverable pane.
    showContentInDetails(path, revisionNumber, content);
    const body = document.getElementById("details-right-body")!;
    body.prepend(
        el("div", { class: "recon-banner" }, [
            el("span", { class: "warn", text: "Git-derived baseline" }),
            ` — content seeded from base commit ${extractGitBaseCommitHash(changeId)}`,
        ]),
        el("pre", { class: "diff-text", text: "(this revision's bytes come from the configured git base commit, not from any session record)" }),
        el("div", { class: "pane-title", text: "— baseline content —" }),
    );
}
