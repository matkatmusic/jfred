// The Layer 1 stage's two widget shapes: a pair's bubble and an orphan bucket.
//
// Moved out of webapp/layer1-page.ts, which sat at the repo's 250-line cap while tasks 292, 295,
// 296 and 297 still had to wire into its boot — the same reason layer1-sources.ts, layer1-progress.ts
// and layer1-zoom.ts were split out before it. A pure move: no rule below changed on the way over.

import { el } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { buildTieGroupMarkers } from "./layer1-tie-groups.ts";
import type { WireOrphan, WirePair } from "./layer1-wire.ts";

// User-locked 2026-07-25: 8 characters. The full hash stays on the wire and on the node's `title`;
// only the visible label is shortened, because 40 monospace characters at 10 px is ~240 px — wider
// than a widget, which is most of the overprinting in the reported screenshot.
const SHORT_HASH_LENGTH = 8;

// Task 257's rule, on the inert node itself (mockup 955-971).
export const CREATED_NODE_TITLE = "created-at is not the latest on-disk state — nothing to show";

// Hand CSS one finished ruler offset. Every placement rule still lives in layer1-styles.css — this
// is the only value JS contributes to layout.
export function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

// One dot plus its label, both pinned to the same widget-relative offset. `titleText` is optional so
// the "on disk" node, which has nothing longer to reveal, is unaffected; el() omits an undefined
// attribute, so a hover title costs one key and no new code path.
// The DOT carries the title too, not just the label: webapp/layer1-drawer.ts reads a commit node's
// full hash off the element the click resolved to, which is always the dot. With it only on the
// label the drawer saw an empty hash, asked for `git show :<path>`, and the route answered the
// on-disk form's "missing query param: dir" (user, 2026-07-27).
function appendAxisNode(lane: HTMLElement, axisPx: number, nodeClass: string, text: string, titleText?: string): void {
    lane.append(
        setAxisPx(el("i", { class: `node ${nodeClass}`, title: titleText }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text, title: titleText }), axisPx),
    );
}

// One pair's widget: named by its BASENAME, full path revealed in-page on hover (task 280 — a path
// is unbounded but the bubble is 168 px), offset to its EARLIEST node, a node per commit, on-disk
// node last.
function buildPairWidget(pair: WirePair): HTMLElement {
    // Spans EARLIEST to LATEST whichever KIND each is: an on-disk mtime predating the first commit
    // gave a negative offset, drawing the disk node over the header (247-249). Empty ladder: free.
    // The ladder in wire order — commits oldest-first, on-disk last (src/viewer_api_layer1.ts's
    // listPairNodeLadder). Held whole rather than just its offsets so task 259 can read the
    // instants back off it and group the nodes that share one.
    const ladder = [...(pair.created === undefined ? [] : [pair.created]), ...pair.commits, pair.onDisk];
    const nodePx = ladder.map((node) => node.axisPx);
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    // Task 259's markers go in BEFORE the nodes: neither carries a z-index, so DOM order is what
    // keeps the rectangle behind the dots and their labels (`.node`'s own z-index: 6 is above both).
    lane.append(el("div", { class: "lrail" }), ...buildTieGroupMarkers(ladder, startPx));
    if (pair.created !== undefined) {
        appendAxisNode(lane, pair.created.axisPx - startPx, "n-disk n-created", "created at", CREATED_NODE_TITLE);
    }
    for (const commit of pair.commits) {
        // Short label, full hash on hover — see SHORT_HASH_LENGTH.
        appendAxisNode(lane, commit.axisPx - startPx, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
    }
    appendAxisNode(lane, pair.onDisk.axisPx - startPx, "n-disk", "on disk");
    return setAxisPx(el("div", { class: "filebox" }, [
        // Task 280: the full path on `data-path`, not `title`. A `title` renders as the native
        // tooltip — delayed, unstyled and gone on the first mouse move — which the user rejected;
        // the CSS hover rule reveals the whole name in-page instead. Same attribute the find box
        // and the File Nav's exact-path jump read, so this is also the widget's identity.
        el("div", { class: "fname", text: pair.path.split("/").pop() ?? pair.path, "data-path": pair.path }),
        el("div", { class: "sub", text: `${pair.commits.length} commits · on disk` }),
        lane,
    ]), startPx);
}

// One orphan bucket: a plain file list carrying each member's own timestamp, placed at its
// EARLIEST member's instant. `title` and `rows` are supplied together by the single caller so a
// bucket's direction is never inferred from its contents — gitOrphans and diskOrphans are mirror
// images and a swap would be invisible (spec S18 "Output contract"). The endpoint already sorts
// rows ascending, so rows[0] IS the earliest member and no Math.min is needed here.
// Undefined for an empty bucket: S18 omits those entirely.
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
