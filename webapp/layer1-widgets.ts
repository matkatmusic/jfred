// Layer 1's orphan bucket widget and the stage's widget list; the pair bubble lives in layer1-pair-widget.ts.

import { createElement } from "./app-dom.ts";
import { setAxisPx } from "./layer1-components/bubbles/layer1-lane-nodes.ts";
import { buildPairWidget } from "./layer1-pair-widget.ts";
import { formatInstantLabel } from "./layer1-components/ruler/layer1-ruler-rows.ts";
import type { WireOrphan, WirePair } from "./layer1-wire.ts";

// One drawn moment of a file: its mtime, or one of its snapshots.
interface OrphanLineEntry {
  path: string;
  instant: string;
  axisPx: number;
  isSnapshot: boolean;
}

function listOrphanLineEntries(rows: WireOrphan[]): OrphanLineEntry[] {
  const entries: OrphanLineEntry[] = [];
  for (const row of rows) {
    entries.push({ path: row.path, instant: row.instant, axisPx: row.axisPx, isSnapshot: false });
    for (const snapshot of row.snapshots ?? []) {
      entries.push({ path: row.path, instant: snapshot.instant, axisPx: snapshot.axisPx, isSnapshot: true });
    }
  }
  // At one instant the mtime entries come first, so a shared line is never hidden as a snapshot while a file's real line is on it.
  entries.sort((first, second) => Date.parse(first.instant) - Date.parse(second.instant) || Number(first.isSnapshot) - Number(second.isSnapshot));
  return entries;
}

// Task 266: rows carry the same `--axis-px` a `.node` does, so ruler clicks find bucket rows too.
function createOrphanRow(entry: OrphanLineEntry, earliestAxisPx: number): HTMLElement {
  const line = setAxisPx(createElement("li", { "data-component": "bubbleOrphanRow" }, [
    createElement("span", { "data-component": "bubbleOrphanPathText", text: entry.path }),
    createElement("em", { "data-component": "bubbleOrphanInstantText", text: formatInstantLabel(entry.instant) }),
  ]), entry.axisPx - earliestAxisPx);
  if (entry.isSnapshot) {
    line.classList.add("n-snap");
    line.prepend(createElement("i", { class: "snap-dot", "data-component": "bubbleOrphanSnapshotDot" }));
  }
  return line;
}

// Entries arrive sorted ascending, so entries sharing an instant are neighbours.
function groupEntriesByInstant(entries: OrphanLineEntry[]): OrphanLineEntry[][] {
  const groups: OrphanLineEntry[][] = [];
  for (const entry of entries) {
    const lastGroup = groups.at(-1);
    if (lastGroup !== undefined) {
      if (lastGroup[0]!.instant === entry.instant) {
        lastGroup.push(entry);
        continue;
      }
    }
    groups.push([entry]);
  }
  return groups;
}

// One line per instant: the first file's name, then "+N more" opening a small list of the other files beside it.
function createInstantLine(sameInstantEntries: OrphanLineEntry[], earliestAxisPx: number): HTMLElement {
  const line = createOrphanRow(sameInstantEntries[0]!, earliestAxisPx);
  const otherEntries = sameInstantEntries.slice(1);
  if (otherEntries.length === 0) {
    return line;
  }
  const otherLines: HTMLElement[] = [];
  for (const otherEntry of otherEntries) {
    otherLines.push(createOrphanRow(otherEntry, earliestAxisPx));
  }
  const popup = createElement("ul", { class: "more-files", "data-component": "bubbleMoreFilesList" }, otherLines);
  const moreButton = createElement("button", { "data-component": "bubbleMoreFilesButton", text: `+${otherEntries.length} more`, onclick: () => popup.classList.toggle("open") });
  line.querySelector("span")!.after(createElement("div", { class: "more" }, [moreButton, popup]));
  return line;
}

// `title`/`rows` come from one caller so direction is never inferred from contents; the earliest and latest drawn entries (mtimes and snapshots) bound the bucket.
export function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
  const entries = listOrphanLineEntries(rows);
  const earliest = entries[0];
  if (earliest === undefined) {
    return undefined;
  }
  const latest = entries[entries.length - 1]!;
  // Was a plain flowing list, one <li> per file, all stacked under the earliest instant:
  // const items: HTMLElement[] = [];
  // for (const row of rows) {
  //   items.push(createOrphanRow(row, earliest.axisPx));
  // }
  // ... createElement("ul", {}, items),
  const lines: HTMLElement[] = [];
  for (const sameInstantEntries of groupEntriesByInstant(entries)) {
    lines.push(createInstantLine(sameInstantEntries, earliest.axisPx));
  }
  let longestPathLength = 0;
  for (const row of rows) {
    longestPathLength = Math.max(longestPathLength, row.path.length);
  }
  // Absolutely placed rows add no height or width, so the holder carries the span (as a pair's lane does) and a width from the longest path.
  const rowHolder = createElement("ul", { class: "orphan-rows", "data-component": "bubbleOrphanRowList" }, lines);
  rowHolder.style.setProperty("--span-px", String(latest.axisPx - earliest.axisPx));
  rowHolder.style.setProperty("--path-ch", String(longestPathLength));
  return setAxisPx(createElement("div", { class: "filebox bucket", "data-component": "bubbleOrphanBucketSection" }, [
    createElement("div", { class: "fname", "data-component": "bubbleOrphanBucketTitle", text: title }),
    createElement("div", { class: "sub", "data-component": "bubbleOrphanCountText", text: `${rows.length} files` }),
    rowHolder,
  ]), earliest.axisPx);
}

// The pair widgets, or the S18 empty-state message when the two roots share no path at all.
export function buildStagePairs(pairs: WirePair[]): HTMLElement[] {
  if (pairs.length === 0) {
    return [createElement("div", { class: "nopairs", "data-component": "bubbleNoPairsText", text: "No git ↔ on-disk pairs." })];
  }
  const widgets: HTMLElement[] = [];
  for (const pair of pairs) {
    widgets.push(buildPairWidget(pair));
  }
  return widgets;
}
