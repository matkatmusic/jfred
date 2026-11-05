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

// `title`/`rows` come from one caller so direction is never inferred from contents; rows arrive sorted ascending, rows[0] is earliest.
export function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
  const earliest = rows[0];
  if (earliest === undefined) {
    return undefined;
  }
  const items: HTMLElement[] = [];
  for (const row of rows) {
    items.push(createOrphanRow(row, earliest.axisPx));
  }
  return setAxisPx(createElement("div", { class: "filebox bucket" }, [
    createElement("div", { class: "fname", text: title }),
    createElement("div", { class: "sub", text: `${rows.length} files` }),
    createElement("ul", {}, items),
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
