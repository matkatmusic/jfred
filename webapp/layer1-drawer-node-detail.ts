// Task 257.5: the single-node drawer's header, meta row, fetch params and raw JSON reveal.

import { createElement, getInputById, getRequiredElementById } from "./app-dom.ts";
import { describeEditDrawer, isEditNode, nodeCommitHash } from "./layer1-drawer-diff.ts";
import { renderHighlightedJson } from "./inspector-json.ts";
import type { WireValue } from "./inspector-links.ts";

const SHORT_HASH_LENGTH = 8;

// A commit node carries its hash on the dot's `title`; empty means no commit.
export function getNodeDrawerDetail(node: HTMLElement, path: string): { params: URLSearchParams; head: string; meta: string; flashFile?: string } {
  const isEdit = isEditNode(node);
  if (isEdit) {
    return describeEditDrawer(node, path);
  }
  const basename = path.split("/").pop() ?? path;
  // Task 317: a snapshot reads the OWNING session's sidecar; its header title arrives with the bytes.
  const isSnapshot = node.classList.contains("n-snap");
  if (isSnapshot) {
    const sessionFile = node.dataset.sessionFile ?? "";
    const flashFile = sessionFile.split("/").pop() ?? sessionFile;
    return {
      params: new URLSearchParams({
        snapshotSession: sessionFile,
        sessionId: node.dataset.sessionId ?? "",
        version: node.dataset.version ?? "",
        path,
        dir: getInputById("dir").value.trim(),
      }),
      head: `${basename} Snapshot`,
      // 328.3: the header names the file ONCE; this row is provenance only.
      meta: `file-history @v${node.dataset.version ?? ""} of ${flashFile}`,
      flashFile,
    };
  }
  const hash = nodeCommitHash(node);
  if (hash === undefined) {
    return {
      params: new URLSearchParams({ dir: getInputById("dir").value.trim(), path }),
      head: `${basename} — Current on-disk state`,
      meta: "working tree",
    };
  }
  return {
    params: new URLSearchParams({ repo: getInputById("repo").value.trim(), path, hash }),
    head: `${basename} — at commit ${hash.slice(0, SHORT_HASH_LENGTH)}`,
    meta: `git show ${hash}`,
  };
}

// The raw JSON reveal has no transcript to link to, so a link click does nothing.
function addNoJsonLink(): void {}

function renderRawJson(record: unknown): HTMLElement {
  return renderHighlightedJson(
    JSON.stringify(record, null, 4), record as WireValue, 0,
    { uuidToLine: new Map<string, number>(), toolIdToLines: new Map<string, number[]>() },
    addNoJsonLink, [], addNoJsonLink,
  );
}

// The [{ }] toggle fetches its JSONL line on the first click, so no node's drawer waits on a record.
export function appendRawJsonRevealForLine(sessionFile: string, line: number): void {
  const jsonBox = createElement("div", { class: "node-json" });
  jsonBox.hidden = true;
  let isRequested = false;
  const jsonToggle = createElement("button", {
    class: "json-toggle",
    text: "[{ }]",
    title: "Show raw transcript JSON",
    onclick: async () => {
      jsonBox.hidden = !jsonBox.hidden;
      if (isRequested) {
        return;
      }
      isRequested = true;
      const response = await fetch(`/api/layer1-record?${new URLSearchParams({ jsonl: sessionFile, line: String(line) })}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      jsonBox.replaceChildren(renderRawJson(await response.json()));
    },
  });
  getRequiredElementById("dbody").append(jsonToggle, jsonBox);
}

// Task 213: [{ }] toggles the clicked snapshot's raw transcript JSON.
export function appendRawJsonReveal(record: unknown): void {
  const jsonBox = createElement("div", { class: "node-json" }, [renderRawJson(record)]);
  jsonBox.hidden = true;
  const jsonToggle = createElement("button", {
    class: "json-toggle",
    text: "[{ }]",
    title: "Show raw transcript JSON",
    onclick: () => {
      jsonBox.hidden = !jsonBox.hidden;
    },
  });
  getRequiredElementById("dbody").append(jsonToggle, jsonBox);
}
