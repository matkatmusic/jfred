// Task 383: the commit message text for a jfred cut mark, and the per-file snapshot lines it lists.

import { isBeaconNode } from "./layer1-cut-beacons.ts";
import { JFRED_SUBJECT_PREFIX } from "./layer1-wire-jfred.ts";

export const FOOTNOTE_PREFIX = "reconstructed by JFRED @ ";

export interface CommitMessageParts {
  markInstant: string;
  skippedCount: number;
  snapLines: string[];
  wallClock: string;
}

export function buildCommitMessage(parts: CommitMessageParts): string {
  const sections: string[] = [`${JFRED_SUBJECT_PREFIX}${parts.markInstant}`];
  if (parts.skippedCount > 0)
    sections.push(`includes ${parts.skippedCount} unmarked changes`);
  if (parts.snapLines.length > 0)
    sections.push(parts.snapLines.join("\n"));
  sections.push([`Author-Date: ${parts.markInstant}`, `Commit-Date: ${parts.wallClock}`, `${FOOTNOTE_PREFIX}${parts.wallClock}`].join("\n"));
  return sections.join("\n\n");
}

// The latest beacon node of one box at or before the mark; the first of equal instants wins.
function findLatestBeaconNode(box: HTMLElement, markMs: number): HTMLElement | undefined {
  let latest: HTMLElement | undefined;
  let latestInstantMs = -Infinity;
  for (const node of box.querySelectorAll<HTMLElement>(".node")) {
    const instantMs = Date.parse(node.dataset["instant"]!);
    const isCandidate = isBeaconNode(node) && instantMs <= markMs;
    const isNewer = instantMs > latestInstantMs;
    const replacesLatest = isCandidate && isNewer;
    if (replacesLatest) {
      latest = node;
      latestInstantMs = instantMs;
    }
  }
  return latest;
}

export function listSnapLines(markMs: number): string[] {
  const lines: string[] = [];
  for (const box of document.querySelectorAll<HTMLElement>("#stage .filebox")) {
    const path = box.querySelector<HTMLElement>(".fname")?.dataset["path"];
    const node = path === undefined ? undefined : findLatestBeaconNode(box, markMs);
    if (path === undefined)
      continue;
    if (node === undefined)
      continue;
    lines.push(`${path}: ${node.nextElementSibling!.textContent} at ${node.dataset["instant"]}`);
  }
  return lines;
}
