// Highlighted-JSON rendering for the inspector, built from text nodes and spans, never innerHTML.

import { createElement } from "./app-dom.ts";
import { findRevisionForChangeId } from "./views/file-history-model.ts";
import {
  findBackupTimeForBlob,
  findJumpTarget,
  findTrackedBackupEntry,
  type LinkMaps,
  type WireFileHistory,
  type WireRevisionLink,
  type WireValue,
} from "./inspector-links.ts";
import { appendSnapshotToken, type SnapshotContext } from "./inspector-json-snapshot.ts";
import { getTokenClass, isValueLong, JSON_STRING_CLASS, JSON_TOKEN_PATTERN } from "./inspector-json-tokens.ts";

// Finds a string token's link: renders snapshot tokens itself (handled), else reports a jump or revision link.
function findStringTokenLink(
  pre: HTMLElement, tokenClass: string, token: string, record: WireValue,
  currentLine: number, maps: LinkMaps, filesTouched: WireFileHistory[],
  snapshotContext: SnapshotContext | undefined,
): { handled: boolean; jumpTarget: number | undefined; revisionLink: WireRevisionLink | undefined } {
  let jumpTarget: number | undefined;
  let revisionLink: WireRevisionLink | undefined;
  try {
    const value = JSON.parse(token) as string;
    const trackedEntry = snapshotContext === undefined ? undefined : findTrackedBackupEntry(record, value);
    if (trackedEntry !== undefined) {
      appendSnapshotToken(pre, tokenClass, token, value, trackedEntry, filesTouched, snapshotContext!);
      return { handled: true, jumpTarget, revisionLink };
    }
    jumpTarget = findJumpTarget(value, currentLine, maps);
    if (jumpTarget === undefined) {
      revisionLink = findRevisionForChangeId(filesTouched, value, findBackupTimeForBlob(record, value));
    }
  }
  catch { /* not a lone string literal — no link */ }
  return { handled: false, jumpTarget, revisionLink };
}

function appendJumpLinkSpan(
  pre: HTMLElement, tokenClass: string, token: string, jumpTarget: number,
  showLine: (line: number) => void,
) {
  pre.append(createElement("span", {
    class: `${tokenClass} jump-link`,
    title: `Jump to line ${jumpTarget}`,
    onclick: () => showLine(jumpTarget),
    text: token,
  }));
}

function appendRevisionLinkSpan(
  pre: HTMLElement, tokenClass: string, token: string, revisionLink: WireRevisionLink,
  openRevision: (link: WireRevisionLink) => void,
) {
  pre.append(createElement("span", {
    class: `${tokenClass} jump-link`,
    title: revisionLink.revisionNumber === undefined
      ? `Open ${revisionLink.target} revisions`
      : `Open ${revisionLink.target} at revision #${revisionLink.revisionNumber}`,
    onclick: () => openRevision(revisionLink),
    text: token,
  }));
}

// Long value: first 7 wrapped lines only (CSS line-clamp), […] toggles the rest.
function appendCollapsibleLongValue(pre: HTMLElement, tokenClass: string, token: string) {
  const valueSpan = createElement("span", { class: `${tokenClass} json-collapsed`, text: token });
  const expandToggle = createElement("button", {
    class: "row-btn json-expand",
    text: "[…]",
    title: "Show the full value",
    onclick: () => {
      const collapsed = valueSpan.classList.toggle("json-collapsed");
      expandToggle.textContent = collapsed ? "[…]" : "[hide]";
    },
  });
  pre.append(valueSpan, expandToggle);
}

// Pretty JSON text -> a <pre> of text nodes and highlight spans; linkable string values become jump-links.
export function renderHighlightedJson(
  prettyText: string, record: WireValue, currentLine: number, maps: LinkMaps,
  showLine: (line: number) => void, filesTouched: WireFileHistory[],
  openRevision: (link: WireRevisionLink) => void, snapshotContext?: SnapshotContext,
) {
  const pre = createElement("pre", { class: "inspector-json" });
  let lastIndex = 0;
  for (const match of prettyText.matchAll(JSON_TOKEN_PATTERN)) {
    if (match.index > lastIndex) {
      pre.append(prettyText.slice(lastIndex, match.index));
    }
    const token = match[0];
    const tokenClass = getTokenClass(token);
    let jumpTarget: number | undefined;
    let revisionLink: WireRevisionLink | undefined;
    let handledAsSnapshot = false;
    if (tokenClass === JSON_STRING_CLASS) {
      const resolution = findStringTokenLink(pre, tokenClass, token, record, currentLine, maps, filesTouched, snapshotContext);
      handledAsSnapshot = resolution.handled;
      jumpTarget = resolution.jumpTarget;
      revisionLink = resolution.revisionLink;
    }
    lastIndex = match.index + token.length;
    if (handledAsSnapshot) {
      continue;
    }
    const isLong = isValueLong(tokenClass, token);
    if (jumpTarget !== undefined) {
      appendJumpLinkSpan(pre, tokenClass, token, jumpTarget, showLine);
    }
    else if (revisionLink !== undefined) {
      appendRevisionLinkSpan(pre, tokenClass, token, revisionLink, openRevision);
    }
    else if (isLong) {
      appendCollapsibleLongValue(pre, tokenClass, token);
    }
    else {
      pre.append(createElement("span", { class: tokenClass, text: token }));
    }
  }
  pre.append(prettyText.slice(lastIndex));
  return pre;
}
