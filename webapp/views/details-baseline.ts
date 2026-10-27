// task 56 follow-up: baseline pane showing a base-commit beacon's committed bytes under a banner.

import { createElement } from "../app-dom.ts";
import { renderContentInDetails } from "./details-diff.ts";
import { extractGitBaseCommitHash } from "./timeline-changes.ts";
import {
  type WireDocument as WireHistoryDocument,
  buildFileHistoryViewModel,
  findRevisionForChangeId,
} from "./file-history-model.ts";

export function showGitBaselineInDetails(historyDocument: WireHistoryDocument, path: string, changeId: string): void {
  // The document's file histories carry each revision's own lines, so the committed content is derivable client-side — no fetch.
  const link = findRevisionForChangeId(historyDocument.filesTouched, changeId);
  const revisionNumber = link?.revisionNumber ?? 1;
  const content = buildFileHistoryViewModel(historyDocument, path).revisions[revisionNumber - 1]?.content;
  // renderContentInDetails owns the pane lifecycle; the banner stack is prepended after.
  renderContentInDetails(path, revisionNumber, content);
  const body = document.getElementById("details-right-body")!;
  body.prepend(
    createElement("div", { class: "recon-banner" }, [
      createElement("span", { class: "warn", text: "Git-derived baseline" }),
      ` — content seeded from base commit ${extractGitBaseCommitHash(changeId)}`,
    ]),
    createElement("pre", { class: "diff-text", text: "(this revision's bytes come from the configured git base commit, not from any session record)" }),
    createElement("div", { class: "pane-title", text: "— baseline content —" }),
  );
}
