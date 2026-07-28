// The Layer 1 stage's two widget shapes: a pair's bubble and an orphan bucket. Split out of
// layer1-page.ts, which sat at the repo's 250-line cap.

import { el } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { buildTieGroupMarkers } from "./layer1-tie-groups.ts";
import type { WireOrphan, WirePair } from "./layer1-wire.ts";

// User-locked 2026-07-25: a full 40-char hash is wider than a widget, so only the label is shortened.
const SHORT_HASH_LENGTH = 8;

// The only value JS contributes to layout; every placement rule lives in layer1-styles.css.
export function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

// The DOT must carry the title too, not just the label: layer1-drawer.ts reads a commit's full hash
// off the clicked element, which is always the dot.
function appendAxisNode(lane: HTMLElement, axisPx: number, nodeClass: string, text: string, titleText?: string): void {
    lane.append(
        setAxisPx(el("i", { class: `node ${nodeClass}`, title: titleText }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text, title: titleText }), axisPx),
    );
}

function buildPairWidget(pair: WirePair): HTMLElement {
    // Spans EARLIEST to LATEST whichever KIND each is: an on-disk mtime predating the first commit
    // gave a negative offset, drawing the disk node over the header (247-249).
    const ladder = [...pair.commits, pair.onDisk];
    const nodePx = ladder.map((node) => node.axisPx);
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    // Task 259's markers go in BEFORE the nodes: neither carries a z-index, so DOM order is what
    // keeps the rectangle behind the dots and their labels.
    lane.append(el("div", { class: "lrail" }), ...buildTieGroupMarkers(ladder, startPx));
    for (const commit of pair.commits) {
        appendAxisNode(lane, commit.axisPx - startPx, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
    }
    appendAxisNode(lane, pair.onDisk.axisPx - startPx, "n-disk", "on disk");
    return setAxisPx(el("div", { class: "filebox" }, [
        // Task 280: the full path on `data-path`, not `title` — CSS reveals it in-page, and the
        // find box and File Nav's exact-path jump read the same attribute as the widget's identity.
        el("div", { class: "fname", text: pair.path.split("/").pop() ?? pair.path, "data-path": pair.path }),
        el("div", { class: "sub", text: `${pair.commits.length} commits · on disk` }),
        lane,
    ]), startPx);
}

// `title` and `rows` come from one caller so a bucket's direction is never inferred from contents —
// gitOrphans and diskOrphans are mirror images and a swap would be invisible (S18). Rows arrive
// sorted ascending, so rows[0] is the earliest; an empty bucket returns undefined.
export function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
    const earliest = rows[0];
    if (earliest === undefined) {
        return undefined;
    }
    // Task 266: each row carries the same WIDGET-RELATIVE `--axis-px` a `.node` does, so the ruler's
    // click lookup can find a bucket row the way it finds a pair's node. A bucket draws no `.node`
    // at all, so without this an instant only a bucket holds answered a click with nothing. No CSS
    // rule reads `--axis-px` on an `li`, so the row does not move — this is pure data.
    const list = el("ul", {}, rows.map((row) => setAxisPx(el("li", {}, [
        el("span", { text: row.path }),
        el("em", { text: formatInstantLabel(row.instant) }),
    ]), row.axisPx - earliest.axisPx)));
    return setAxisPx(el("div", { class: "filebox bucket" }, [
        el("div", { class: "fname", text: title }),
        el("div", { class: "sub", text: `${rows.length} files` }),
        list,
    ]), earliest.axisPx);
}

// The pair widgets, or the S18 empty-state message when the two roots share no path at all.
export function buildStagePairs(pairs: WirePair[]): HTMLElement[] {
    if (pairs.length === 0) {
        return [el("div", { class: "nopairs", text: "No git ↔ on-disk pairs." })];
    }
    return pairs.map(buildPairWidget);
}
