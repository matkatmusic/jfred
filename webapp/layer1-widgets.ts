// Layer 1's two widget shapes (pair bubble, orphan bucket), split out of layer1-page.ts once it hit the 250-line cap.

import { el } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { buildTieGroupMarkers } from "./layer1-tie-groups.ts";
import type { WireOrphan, WirePair, WireSnapshot } from "./layer1-wire.ts";

// User-locked 2026-07-25: a full 40-char hash is wider than a widget, so only the label is shortened.
const SHORT_HASH_LENGTH = 8;

export const CREATED_NODE_TITLE = "created-at is not the latest on-disk state — nothing to show";

// The only value JS contributes to layout; every placement rule lives in layer1-styles.css.
export function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

// The dot carries the title too: layer1-drawer.ts reads a commit's hash off the clicked dot.
function appendAxisNode(lane: HTMLElement, axisPx: number, nodeClass: string, text: string, titleText?: string): void {
    lane.append(
        setAxisPx(el("i", { class: `node ${nodeClass}`, title: titleText }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text, title: titleText }), axisPx),
    );
}

// Task 315: identity on `data-` attrs (task 280), on both elements; `n-snap` on both is task 314's hide handle.
function appendSnapshotNode(lane: HTMLElement, axisPx: number, snapshot: WireSnapshot): void {
    const identity = {
        "data-version": String(snapshot.version),
        "data-session-file": snapshot.sessionFile,
        "data-line": snapshot.line === undefined ? undefined : String(snapshot.line),
    };
    lane.append(
        setAxisPx(el("i", { class: "node n-snap", ...identity }), axisPx),
        setAxisPx(el("span", { class: "nlabel n-snap", text: `@v${snapshot.version} 📸`, ...identity }), axisPx),
    );
}

function buildPairWidget(pair: WirePair): HTMLElement {
    // Snapshots appended last, exactly as the server orders the ladder, so tie-group runs and the span both stay right.
    const snapshots = pair.snapshots ?? [];
    // Spans earliest to latest of any kind: a pre-commit mtime gave a negative offset over the header.
    const ladder = [...(pair.created === undefined ? [] : [pair.created]), ...pair.commits, pair.onDisk, ...snapshots];
    const nodePx = ladder.map((node) => node.axisPx);
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    // Task 259's markers go in before the nodes; with no z-index, DOM order keeps the rectangle behind the dots.
    lane.append(el("div", { class: "lrail" }), ...buildTieGroupMarkers(ladder, startPx));
    if (pair.created !== undefined) {
        appendAxisNode(lane, pair.created.axisPx - startPx, "n-disk n-created", "created at", CREATED_NODE_TITLE);
    }
    for (const commit of pair.commits) {
        appendAxisNode(lane, commit.axisPx - startPx, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
    }
    appendAxisNode(lane, pair.onDisk.axisPx - startPx, "n-disk", "on disk");
    for (const snapshot of snapshots) {
        appendSnapshotNode(lane, snapshot.axisPx - startPx, snapshot);
    }
    return setAxisPx(el("div", { class: "filebox" }, [
        // Task 280: full path lives on `data-path`; find box and File Nav's exact-path jump read that same attribute as identity.
        el("div", { class: "fname", text: pair.path.split("/").pop() ?? pair.path, "data-path": pair.path }),
        el("div", { class: "sub", text: `${pair.commits.length} commits · on disk` }),
        lane,
    ]), startPx);
}

// `title`/`rows` come from one caller so direction is never inferred from contents; rows arrive sorted ascending, rows[0] is earliest.
export function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
    const earliest = rows[0];
    if (earliest === undefined) {
        return undefined;
    }
    // Task 266: rows carry the same `--axis-px` a `.node` does, so ruler clicks find bucket rows too.
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
