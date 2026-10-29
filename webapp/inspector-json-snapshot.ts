// Snapshot backupFileName token rendering for the highlighted-JSON inspector.

import { createElement } from "./app-dom.ts";
import {
  computeRevisionLinkRoute,
  computeSnapshotHistoryAnchor,
  type WireFileHistory,
  type WireRevisionLink,
  type WireTrackedBackup,
} from "./inspector-links.ts";

// The state appendSnapshotToken renders from.
export type SnapshotContext = {
  sessionId: string;
  presenceByKey: Map<string, boolean | undefined>;
  project: string | undefined;
  openSnapshotDrawer: (blobName: string, entry: WireTrackedBackup) => void;
};

function appendViewInRevisionsButton(pre: HTMLElement, snapshotContext: SnapshotContext, anchor: WireRevisionLink) {
  pre.append(createElement("button", {
    class: "row-btn snapshot-history-btn",
    text: "View in File Revisions",
    onclick: () => {
      location.hash = computeRevisionLinkRoute(snapshotContext.project!, anchor);
    },
  }));
}

// Renders a backupFileName token by disk presence: link when present, missing note when absent.
export function appendSnapshotToken(
  pre: HTMLElement, tokenClass: string, token: string, value: string,
  entry: WireTrackedBackup, filesTouched: WireFileHistory[], snapshotContext: SnapshotContext,
) {
  const presence = snapshotContext.presenceByKey.get(`${snapshotContext.sessionId}|${value}`);
  if (presence !== true) {
    pre.append(createElement("span", { class: tokenClass, text: token }));
    if (presence === false) {
      pre.append(createElement("span", { class: "muted", text: " (missing from disk)" }));
    }
    return;
  }
  pre.append(createElement("span", {
    class: `${tokenClass} jump-link`,
    title: "view snapshot",
    onclick: () => snapshotContext.openSnapshotDrawer(value, entry),
    text: token,
  }));
  const anchor = computeSnapshotHistoryAnchor(filesTouched, entry.relativePath, entry.backupTime);
  if (anchor !== undefined) {
    appendViewInRevisionsButton(pre, snapshotContext, anchor);
  }
}
