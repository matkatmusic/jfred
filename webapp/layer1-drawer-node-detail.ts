// Task 257.5: the single-node drawer's header, meta row, fetch params and raw JSON reveal.

import { createElement, getInputById, getRequiredElementById } from "./app-dom.ts";
import { createEditDrawer, getNodeCommitHash, isEditNode } from "./layer1-drawer-diff.ts";
import { renderHighlightedJson } from "./inspector-json.ts";
import type { WireValue } from "./inspector-links.ts";

const SHORT_HASH_LENGTH = 8;

type NodeDrawerDetail = { params: URLSearchParams; head: string; meta: string; flashFile?: string };

// Task 317: a snapshot reads the OWNING session's sidecar; its header title arrives with the bytes.
function buildSnapshotParams(node: HTMLElement, sessionFile: string, path: string): URLSearchParams {
  return new URLSearchParams({
    snapshotSession: sessionFile,
    sessionId: node.dataset.sessionId ?? "",
    version: node.dataset.version ?? "",
    path,
    dir: getInputById("dir").value.trim(),
  });
}

function getSnapshotDrawerDetail(node: HTMLElement, path: string, basename: string): NodeDrawerDetail {
  const sessionFile = node.dataset.sessionFile ?? "";
  const flashFile = sessionFile.split("/").pop() ?? sessionFile;
  return {
    params: buildSnapshotParams(node, sessionFile, path),
    head: `${basename} Snapshot`,
    // 328.3: the header names the file ONCE; this row is provenance only.
    meta: `file-history @v${node.dataset.version ?? ""} of ${flashFile}`,
    flashFile,
  };
}

// No hash means the working tree; otherwise the file at that commit.
function getCommitDrawerDetail(path: string, basename: string, hash: string | undefined): NodeDrawerDetail {
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

// A commit node carries its hash on the dot's `title`; empty means no commit.
export function getNodeDrawerDetail(node: HTMLElement, path: string): NodeDrawerDetail {
  const isEdit = isEditNode(node);
  if (isEdit) {
    return createEditDrawer(node, path);
  }
  const basename = path.split("/").pop() ?? path;
  const isSnapshot = node.classList.contains("n-snap");
  if (isSnapshot) {
    return getSnapshotDrawerDetail(node, path, basename);
  }
  return getCommitDrawerDetail(path, basename, getNodeCommitHash(node));
}

// The raw JSON reveal has no transcript to link to, so a link click does nothing.
function addNoJsonLink(): void {}

export function renderRawJson(record: unknown): HTMLElement {
  return renderHighlightedJson(
    JSON.stringify(record, null, 4), record as WireValue, 0,
    { uuidToLine: new Map<string, number>(), toolIdToLines: new Map<string, number[]>() },
    addNoJsonLink, [], addNoJsonLink,
  );
}

// A failed response throws.
export async function fetchRawJsonLine(sessionFile: string, line: number): Promise<HTMLElement> {
  const response = await fetch(`/api/layer1-record?${new URLSearchParams({ jsonl: sessionFile, line: String(line) })}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return renderRawJson(await response.json());
}

function createRawJsonToggleHandler(jsonBox: HTMLElement, sessionFile: string, line: number): () => Promise<void> {
  let isRequested = false;
  return async () => {
    jsonBox.hidden = !jsonBox.hidden;
    if (isRequested) {
      return;
    }
    isRequested = true;
    jsonBox.replaceChildren(await fetchRawJsonLine(sessionFile, line));
  };
}

// The { } toggle fetches its JSONL line on first click, so drawers never wait.
export function appendRawJsonRevealForLine(sessionFile: string, line: number): void {
  const jsonBox = createElement("div", { class: "node-json" });
  jsonBox.hidden = true;
  const jsonToggle = createElement("button", {
    class: "json-toggle",
    text: "{ }",
    title: "Show raw transcript JSON",
    onclick: createRawJsonToggleHandler(jsonBox, sessionFile, line),
  });
  getRequiredElementById("dbody").append(jsonToggle, jsonBox);
}

// Task 213: { } toggles the clicked snapshot's raw transcript JSON.
export function appendRawJsonReveal(record: unknown): void {
  const jsonBox = createElement("div", { class: "node-json" }, [renderRawJson(record)]);
  jsonBox.hidden = true;
  const jsonToggle = createElement("button", {
    class: "json-toggle",
    text: "{ }",
    title: "Show raw transcript JSON",
    onclick: () => {
      jsonBox.hidden = !jsonBox.hidden;
    },
  });
  getRequiredElementById("dbody").append(jsonToggle, jsonBox);
}
