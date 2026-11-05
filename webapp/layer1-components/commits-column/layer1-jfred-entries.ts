// Task 383: builds the jfred commit column elements: node, label, line and chain.

import { createElement } from "../../app-dom.ts";
import { buildPairBracket } from "../session-column/layer1-annotation-bracket.ts";
import type { JfredBranch } from "./layer1-jfred-state.ts";
import { computeAxisPixelsAt } from "../bubbles/layer1-ranges.ts";
import type { WireRulerTick } from "../../layer1-wire.ts";

export const JfredEntryKind = {
  base: "base",
  commit: "commit",
  pending: "pending",
} as const;
export type JfredEntryKind = (typeof JfredEntryKind)[keyof typeof JfredEntryKind];

export interface JfredEntry {
  kind: JfredEntryKind;
  // Undefined for the pending mark: it has no hash yet.
  shortHash: string | undefined;
  // Undefined for the base: it has no parent.
  parentShortHash: string | undefined;
  instant: string;
  label: string;
  // Undefined for the base: it has no message.
  message: string | undefined;
}

// Base first, then the commits in order, then the pending mark; the pending parent is the tip.
export function listJfredEntries(branch: JfredBranch): JfredEntry[] {
  if (branch.base === undefined)
    return [];
  const { base } = branch;
  const entries: JfredEntry[] = [{ kind: JfredEntryKind.base, shortHash: base.shortHash, parentShortHash: undefined, instant: base.instant, label: `base ${base.shortHash}`, message: undefined }];
  for (const commit of branch.commits)
    entries.push({ kind: JfredEntryKind.commit, shortHash: commit.shortHash, parentShortHash: commit.parentShortHash, instant: commit.instant, label: commit.shortHash, message: commit.message });
  if (branch.pending !== undefined)
    entries.push({ kind: JfredEntryKind.pending, shortHash: undefined, parentShortHash: (branch.commits.at(-1) ?? base).shortHash, instant: branch.pending.instant, label: "pending", message: branch.pending.message });
  return entries;
}

function buildEntryElement(tag: string, className: string, entry: JfredEntry, ticks: readonly WireRulerTick[], text?: string): HTMLElement {
  const element = createElement(tag, {
    class: className,
    "data-entry-kind": entry.kind,
    "data-short-hash": entry.shortHash,
    "data-parent-hash": entry.parentShortHash,
    "data-instant": entry.instant,
    // The hover popup shows the message; only the base keeps a native title.
    title: entry.message === undefined ? `${entry.label} | ${entry.instant}` : undefined,
    text,
  });
  element.style.setProperty("--axis-px", String(computeAxisPixelsAt(Date.parse(entry.instant), ticks)));
  return element;
}

function buildEntryNode(entry: JfredEntry, ticks: readonly WireRulerTick[]): HTMLElement {
  const lookClass = entry.kind === JfredEntryKind.commit ? "" : ` j-${entry.kind}`;
  return buildEntryElement("i", `jnode${lookClass}`, entry, ticks);
}

export function buildJfredEntries(branch: JfredBranch, ticks: readonly WireRulerTick[]): HTMLElement[] {
  const entries = listJfredEntries(branch);
  const elements: HTMLElement[] = [];
  let previousNode: HTMLElement | undefined;
  for (const entry of entries) {
    const node = buildEntryNode(entry, ticks);
    const chainClass = entry.kind === JfredEntryKind.pending ? "jchain j-pending" : "jchain";
    if (previousNode !== undefined)
      elements.push(buildPairBracket(previousNode, node, chainClass));
    elements.push(node, buildEntryElement("span", "jlabel", entry, ticks, entry.label), buildEntryElement("div", "jline", entry, ticks));
    previousNode = node;
  }
  return elements;
}
