// Timeline keyword search: row haystack, session-title index, and the combined mode+search predicate.

import { isNodeInFilterMode, type TimelineFilterMode } from "./timeline-filter-model.ts";
import { findSessionStartIndexes } from "./timeline-labels-pills.ts";
import type { TimelineNode } from "./timeline-types.ts";

// Everything a row can visibly say, lowercased once.
function computeNodeSearchHaystack(node: TimelineNode): string {
  const parts: string[] = [];
  if (node.text !== undefined) {
    parts.push(node.text);
  }
  if (node.summary !== undefined) {
    parts.push(node.toolName ?? "", node.summary);
  }
  if (node.detail !== undefined) {
    parts.push(node.detail);
  }
  if (node.resultHash !== undefined) {
    parts.push(node.resultHash);
  }
  for (const change of node.fileChanges ?? []) {
    parts.push(change.path, change.displayPath, change.renamedFrom ?? "");
  }
  return parts.join("\n").toLowerCase();
}

// Each titled session adds its title to its FIRST node only, so search jumps to the session header.
export function computeSessionTitleByNodeIndex(nodes: TimelineNode[], sessionTitles: Record<string, string> | undefined): Map<number, string> {
  const titleByNodeIndex = new Map<number, string>();
  if (sessionTitles === undefined) {
    return titleByNodeIndex;
  }
  for (const sessionStart of findSessionStartIndexes(nodes)) {
    const sessionTitle = sessionTitles[sessionStart.sessionId];
    if (sessionTitle === undefined) {
      continue;
    }
    titleByNodeIndex.set(sessionStart.nodeIndex, sessionTitle);
  }
  return titleByNodeIndex;
}

// Blank term matches all; else case-insensitive substring over row text or session title.
export function isNodeMatchingSearchTerm(node: TimelineNode, term: string, sessionTitle?: string): boolean {
  const normalizedTerm = term.trim().toLowerCase();
  if (normalizedTerm === "") {
    return true;
  }
  if (sessionTitle !== undefined) {
    const lowerTitle = sessionTitle.toLowerCase();
    const isTitleMatch = lowerTitle.includes(normalizedTerm);
    if (isTitleMatch) {
      return true;
    }
  }
  const haystack = computeNodeSearchHaystack(node);
  return haystack.includes(normalizedTerm);
}

// A row stays visible only when it passes both the mode button and the search term.
export function isNodePassingFilters(node: TimelineNode, mode: TimelineFilterMode, term: string, sessionTitle?: string): boolean {
  const isInMode = isNodeInFilterMode(node, mode);
  if (!isInMode) {
    return false;
  }
  return isNodeMatchingSearchTerm(node, term, sessionTitle);
}

// Indexes of nodes passing both filters, in timeline order; the list length is the counter's N.
export function computeMatchingNodeIndexes(nodes: TimelineNode[], mode: TimelineFilterMode, term: string, sessionTitleByNodeIndex?: Map<number, string>): number[] {
  const matchingIndexes: number[] = [];
  for (const [index, node] of nodes.entries()) {
    const sessionTitle = sessionTitleByNodeIndex?.get(index);
    const isMatching = isNodePassingFilters(node, mode, term, sessionTitle);
    if (isMatching) {
      matchingIndexes.push(index);
    }
  }
  return matchingIndexes;
}
