// Layer 1's orphan bucket widget and the stage's widget list; the pair bubble lives in layer1-pair-widget.ts.

import { createElement } from "./app-dom.ts";
import { setAxisPx } from "./layer1-components/bubbles/layer1-lane-nodes.ts";
import { buildPairWidget } from "./layer1-pair-widget.ts";
import { formatInstantLabel } from "./layer1-components/ruler/layer1-ruler-rows.ts";
import type { WireOrphan, WirePair } from "./layer1-wire.ts";

// Task 266: rows carry the same `--axis-px` a `.node` does, so ruler clicks find bucket rows too.
function createOrphanRow(row: WireOrphan, earliestAxisPx: number): HTMLElement {
  return setAxisPx(createElement("li", {}, [
    createElement("span", { text: row.path }),
    createElement("em", { text: formatInstantLabel(row.instant) }),
  ]), row.axisPx - earliestAxisPx);
}

// Rows arrive sorted ascending, so files sharing an instant are neighbours.
function groupRowsByInstant(rows: WireOrphan[]): WireOrphan[][] {
  const groups: WireOrphan[][] = [];
  for (const row of rows) {
    const lastGroup = groups.at(-1);
    if (lastGroup !== undefined) {
      if (lastGroup[0]!.instant === row.instant) {
        lastGroup.push(row);
        continue;
      }
    }
    groups.push([row]);
  }
  return groups;
}

// One line per instant: the first file's name, then "+N more" opening a small list of the other files beside it.
function createInstantLine(sameInstantRows: WireOrphan[], earliestAxisPx: number): HTMLElement {
  const line = createOrphanRow(sameInstantRows[0]!, earliestAxisPx);
  const otherRows = sameInstantRows.slice(1);
  if (otherRows.length === 0) {
    return line;
  }
  const otherLines: HTMLElement[] = [];
  for (const otherRow of otherRows) {
    otherLines.push(createOrphanRow(otherRow, earliestAxisPx));
  }
  const popup = createElement("ul", { class: "more-files" }, otherLines);
  const moreButton = createElement("button", { text: `+${otherRows.length} more`, onclick: () => popup.classList.toggle("open") });
  line.querySelector("span")!.after(createElement("div", { class: "more" }, [moreButton, popup]));
  return line;
}

// `title`/`rows` come from one caller so direction is never inferred from contents; rows arrive sorted ascending, rows[0] is earliest.
export function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
  const earliest = rows[0];
  if (earliest === undefined) {
    return undefined;
  }
  // Was a plain flowing list, one <li> per file, all stacked under the earliest instant:
  // const items: HTMLElement[] = [];
  // for (const row of rows) {
  //   items.push(createOrphanRow(row, earliest.axisPx));
  // }
  // ... createElement("ul", {}, items),
  const lines: HTMLElement[] = [];
  for (const sameInstantRows of groupRowsByInstant(rows)) {
    lines.push(createInstantLine(sameInstantRows, earliest.axisPx));
  }
  let longestPathLength = 0;
  for (const row of rows) {
    longestPathLength = Math.max(longestPathLength, row.path.length);
  }
  // Absolutely placed rows add no height or width, so the holder carries the span (as a pair's lane does) and a width from the longest path.
  const rowHolder = createElement("ul", { class: "orphan-rows" }, lines);
  rowHolder.style.setProperty("--span-px", String(rows[rows.length - 1]!.axisPx - earliest.axisPx));
  rowHolder.style.setProperty("--path-ch", String(longestPathLength));
  return setAxisPx(createElement("div", { class: "filebox bucket" }, [
    createElement("div", { class: "fname", text: title }),
    createElement("div", { class: "sub", text: `${rows.length} files` }),
    rowHolder,
  ]), earliest.axisPx);
}

// The pair widgets, or the S18 empty-state message when the two roots share no path at all.
export function buildStagePairs(pairs: WirePair[]): HTMLElement[] {
  if (pairs.length === 0) {
    return [createElement("div", { class: "nopairs", text: "No git ↔ on-disk pairs." })];
  }
  const widgets: HTMLElement[] = [];
  for (const pair of pairs) {
    widgets.push(buildPairWidget(pair));
  }
  return widgets;
}
