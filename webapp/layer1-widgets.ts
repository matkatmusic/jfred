// Layer 1's two widget shapes (pair bubble, orphan bucket), split out of layer1-page.ts once it hit the 250-line cap.

import { el } from "./app-dom.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import { buildNodesWithSameTimestampMarkers } from "./layer1-nodes-with-same-timestamp.ts";
import { WireEditKind, WireScriptExecutorKind, type WireEdit, type WireOrphan, type WirePair, type WireScriptRun, type WireSnapshot } from "./layer1-wire.ts";

// User-locked 2026-07-25: a full 40-char hash is wider than a widget, so only the label is shortened.
const SHORT_HASH_LENGTH = 8;

export const CREATED_NODE_TITLE = "created-at is not the latest on-disk state — nothing to show";

// The only value JS contributes to layout; every placement rule lives in layer1-styles.css.
export function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

// The dot carries the title too: layer1-drawer.ts reads a commit's hash off the clicked dot.
function appendAxisNode(lane: HTMLElement, axisPx: number, instant: string, nodeClass: string, text: string, titleText?: string): void {
    lane.append(
        setAxisPx(el("i", { class: `node ${nodeClass}`, title: titleText, "data-instant": instant }), axisPx),
        setAxisPx(el("span", { class: "nlabel", text, title: titleText, "data-instant": instant }), axisPx),
    );
}

// Task 315: identity on `data-` attrs (task 280), on both elements; `n-snap` on both is task 314's hide handle.
function appendSnapshotNode(lane: HTMLElement, axisPx: number, snapshot: WireSnapshot): void {
    const identity = {
        "data-instant": snapshot.instant,
        "data-version": String(snapshot.version),
        "data-session-id": snapshot.sessionId,
        "data-session-file": snapshot.sessionFile,
        "data-line": snapshot.line === undefined ? undefined : String(snapshot.line),
    };
    lane.append(
        setAxisPx(el("i", { class: "node n-snap", ...identity }), axisPx),
        setAxisPx(el("span", { class: "nlabel n-snap", text: `@v${snapshot.version} 📸`, ...identity }), axisPx),
    );
}

// Task 343: the dot class hides the node; confidence is a ring class, never a fill swap.
function appendEditNode(lane: HTMLElement, axisPx: number, edit: WireEdit): void {
    const isRead = edit.kind === WireEditKind.read;
    const kindClass = isRead ? "n-read" : "n-edit";
    const identity = {
        title: edit.confidence,
        "data-change-id": edit.changeId,
        "data-kind": edit.kind,
        "data-confidence": edit.confidence,
        "data-instant": edit.instant,
        "data-session-id": edit.sessionId,
        "data-session-file": edit.sessionFile,
        "data-line": edit.line === undefined ? undefined : String(edit.line),
    };
    lane.append(
        setAxisPx(el("i", { class: `node ${kindClass} conf-${edit.confidence}`, ...identity }), axisPx),
        setAxisPx(el("span", { class: `nlabel ${kindClass}`, text: isRead ? "[R]✓" : "[e]", ...identity }), axisPx),
    );
}

// Task 356: dot and label share the identity attrs; a bash run is never provable, so its ring is dashed.
function appendScriptRunNode(lane: HTMLElement, axisPx: number, run: WireScriptRun): void {
    const isBash = run.executorKind === WireScriptExecutorKind.bash;
    const identity = {
        title: run.label ?? `${run.executorKind} run`,
        "data-tool-use-id": run.toolUseId,
        "data-executor-kind": run.executorKind,
        "data-instant": run.instant,
        "data-session-id": run.sessionId,
        "data-session-file": run.sessionFile,
    };
    const iconText = run.executorKind === WireScriptExecutorKind.python ? "🐍" : "$";
    lane.append(
        setAxisPx(el("i", { class: `node n-script${isBash ? " never-provable" : ""}`, ...identity }), axisPx),
        setAxisPx(el("span", { class: "nlabel n-script", text: run.label ?? iconText, ...identity }), axisPx),
    );
}

function buildPairWidget(pair: WirePair): HTMLElement {
    // Snapshots, edits and script runs go last, as the server orders the ladder, so same-timestamp runs and the span stay right.
    const snapshots = pair.snapshots ?? [];
    const edits = pair.edits ?? [];
    const scriptRuns = pair.scriptRuns ?? [];
    // Spans earliest to latest of any kind: a pre-commit mtime gave a negative offset over the header.
    const ladder = [...(pair.created === undefined ? [] : [pair.created]), ...pair.commits, pair.onDisk, ...snapshots, ...edits, ...scriptRuns];
    const nodePx = ladder.map((node) => node.axisPx);
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    // Task 259's markers go in before the nodes; with no z-index, DOM order keeps the rectangle behind the dots.
    lane.append(el("div", { class: "lrail" }), ...buildNodesWithSameTimestampMarkers(ladder, startPx));
    if (pair.created !== undefined) {
        appendAxisNode(lane, pair.created.axisPx - startPx, pair.created.instant, "n-disk n-created", "created at", CREATED_NODE_TITLE);
    }
    for (const commit of pair.commits) {
        appendAxisNode(lane, commit.axisPx - startPx, commit.instant, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
    }
    appendAxisNode(lane, pair.onDisk.axisPx - startPx, pair.onDisk.instant, "n-disk", "on disk");
    for (const snapshot of snapshots) {
        appendSnapshotNode(lane, snapshot.axisPx - startPx, snapshot);
    }
    for (const edit of edits) {
        appendEditNode(lane, edit.axisPx - startPx, edit);
    }
    for (const run of scriptRuns) {
        appendScriptRunNode(lane, run.axisPx - startPx, run);
    }
    return setAxisPx(el("div", { class: "filebox" }, [
        // Task 280: full path lives on `data-path` — the find box and File Nav jump read it as identity.
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
