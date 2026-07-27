// The Layer 1 View page (task 237, spec S18): what is on disk right now against what the
// repository says, rendered per plans/layer1-mockup.html. Its own page rather than a hash route
// inside the layered app, because its three inputs live in the QUERY STRING (?dir=&repo=&ref=) so
// a view is one shareable link.
//
// GET /api/layer1-view (task 235) already resolved every instant onto ONE capped-gap ruler and
// ships ABSOLUTE `axisPx` values. The S18 ruler ACCUMULATES, so an offset can never be recovered
// from its own instant — this page therefore does no time arithmetic at all. Its single
// arithmetic operation is subtracting a widget's own base offset from a node's, which is what
// turns an absolute ruler position into a widget-relative one.

import { el, getRequiredElementById } from "./app-dom.ts";
import { renderLayer1FileNav } from "./layer1-filenav.ts";
import { wireFileNavResize } from "./layer1-filenav-resize.ts";
import { filterLayer1ViewByTargets } from "./layer1-filter.ts";
import { wireFindFileBox } from "./layer1-find-file.ts";
import { wireBucketJumpButtons } from "./layer1-jump-buckets.ts";
import { makeLeaderHoverable } from "./layer1-leader-hover.ts";
import { wireLeaderVisibility } from "./layer1-leader-visibility.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import { makeRulerTickClickable } from "./layer1-ruler-click.ts";
import { formatInstantLabel, listRulerRows } from "./layer1-ruler-rows.ts";
import { fillSourceBoxesFromUrl, readSourceParams, wireFolderPickers } from "./layer1-sources.ts";
import { buildTieGroupMarkers } from "./layer1-tie-groups.ts";
import type { WireInstant, WireLayer1View, WireOrphan, WirePair, WireRulerTick } from "./layer1-wire.ts";
import { wireZoomControls } from "./layer1-zoom.ts";

// User-locked 2026-07-25: 8 characters. The full hash stays on the wire and on the node's `title`;
// only the visible label is shortened, because 40 monospace characters at 10 px is ~240 px — wider
// than a widget, which is most of the overprinting in the reported screenshot.
const SHORT_HASH_LENGTH = 8;

// Hand CSS one finished ruler offset. Every placement rule still lives in layer1.html's stylesheet
// — this is the only value JS contributes to layout.
function setAxisPx(node: HTMLElement, axisPx: number): HTMLElement {
    node.style.setProperty("--axis-px", String(axisPx));
    return node;
}

// The left gutter. Which entries get a printed row, and what each row reads, is decided once by
// layer1-ruler-rows.ts (tasks 268 and 275) — this only builds the elements. Task 260: every drawn
// row is also the navigation control for its instant; a merged row answers for the earliest of the
// instants it stands for, which is the one its `--axis-px` carries.
function renderRulerTicks(ruler: WireRulerTick[]): void {
    const ticks = listRulerRows(ruler).map((row) =>
        makeRulerTickClickable(setAxisPx(el("div", { class: "tick", text: row.text }), row.axisPx)));
    getRequiredElementById("ruler").replaceChildren(el("div", { class: "rail" }), ...ticks);
}

// One dashed line per ruler ENTRY, spanning the canvas behind the bubbles (task 264). Every bubble
// with a node at that instant shares this one line, replacing the per-bubble `.filebox::before` that
// drew an overlapping copy for each of 805 bubbles and made the page unusably slow (task 263).
//
// Every entry gets one, not just the entries whose LABEL survives renderRulerTicks' overprint skip:
// a skipped label still has bubbles sitting on it, and dropping its line would leave those bubbles
// with no connector at all. Task 268 (merging rows that display the same value) is what reduces the
// count; that is a different question from which labels happen to collide.
function renderLeaderLines(ruler: WireInstant[]): void {
    getRequiredElementById("leaders").replaceChildren(
        ...ruler.map((entry) => makeLeaderHoverable(setAxisPx(el("div", { class: "leader" }), entry.axisPx))),
    );
}

// One dot plus its label, both pinned to the same widget-relative offset. `titleText` is optional so
// the "on disk" node, which has nothing longer to reveal, is unaffected; el() omits an undefined
// attribute, so a hover title costs one key and no new code path.
function appendAxisNode(lane: HTMLElement, axisPx: number, nodeClass: string, text: string, titleText?: string): void {
    lane.append(
        setAxisPx(el("i", { class: `node ${nodeClass}` }), axisPx),
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
    const ladder = [...pair.commits, pair.onDisk];
    const nodePx = ladder.map((node) => node.axisPx);
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    // Task 259's markers go in BEFORE the nodes: neither carries a z-index, so DOM order is what
    // keeps the rectangle behind the dots and their labels (`.node`'s own z-index: 6 is above both).
    lane.append(el("div", { class: "lrail" }), ...buildTieGroupMarkers(ladder, startPx));
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
// EARLIEST member's instant. `title` and `rows` are supplied together by the single caller below
// so a bucket's direction is never inferred from its contents — gitOrphans and diskOrphans are
// mirror images and a swap would be invisible (spec S18 "Output contract"). The endpoint already
// sorts rows ascending, so rows[0] IS the earliest member and no Math.min is needed here.
// Undefined for an empty bucket: S18 omits those entirely.
function buildOrphanBucket(title: string, rows: WireOrphan[]): HTMLElement | undefined {
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
function buildStagePairs(pairs: WirePair[]): HTMLElement[] {
    if (pairs.length === 0) {
        return [el("div", { class: "nopairs", text: "No git ↔ on-disk pairs." })];
    }
    return pairs.map(buildPairWidget);
}

// Everything the crumb, the ruler gutter and the stage draw for ONE view. Exported for task 253:
// a folder filter redraws the timeline from its own filtered, re-laid-out view while the File Nav
// is left standing — the nav is the control that SET the filter, so redrawing it would both shrink
// it to the filtered set and wipe the folder's selected class and expanded state.
//
// The crumb's counts are inside, so a filter reports how many records survived it — the only
// on-screen reading of how much the filter removed, and it costs nothing.
export function renderLayer1Stage(view: WireLayer1View): void {
    getRequiredElementById("crumb").textContent =
        `${view.pairs.length} pairs · ${view.gitOrphans.length} repo-only · ${view.diskOrphans.length} disk-only`;
    renderRulerTicks(view.ruler);
    renderLeaderLines(view.ruler);
    const buckets = [
        // gitOrphans = in the repo, absent from disk. diskOrphans = on disk, absent from the repo.
        buildOrphanBucket("No on-disk match", view.gitOrphans),
        buildOrphanBucket("No repository match", view.diskOrphans),
    ];
    getRequiredElementById("stage").replaceChildren(
        ...buildStagePairs(view.pairs),
        ...buckets.filter((bucket) => bucket !== undefined),
    );
    // Task 246: the minimap MEASURES the widgets it maps, so it is drawn after they are in the DOM.
    drawLayer1Minimap();
}

// Draw a FETCHED view: the File Nav over every file it holds, then the stage.
// The nav is drawn only here, and `view` is captured by the folder callback — so every later folder
// click re-filters from the unfiltered payload rather than from whatever the previous filter left on
// screen, and an empty selection restores the whole view without another fetch.
export function renderLayer1View(view: WireLayer1View): void {
    renderLayer1FileNav(view, (targets) => renderLayer1Stage(filterLayer1ViewByTargets(view, targets)));
    renderLayer1Stage(view);
}

// Fetch and draw the view for whatever the boxes currently hold, mirroring them into the URL
// first (replaceState, not pushState: re-loading the same page is not a navigation).
export async function loadLayer1View(): Promise<void> {
    const params = readSourceParams();
    history.replaceState(null, "", `?${params}`);
    const crumb = getRequiredElementById("crumb");
    if (!params.has("dir") || !params.has("repo")) {
        crumb.textContent = "pick a project folder and a git repo";
        return;
    }
    // Clear ALL THREE before the ~10 s build: the previous view's counts, widgets and File Nav are
    // stale the moment a new load starts, and leaving them up is what made the page read as frozen.
    crumb.textContent = "";
    getRequiredElementById("stage").replaceChildren();
    getRequiredElementById("filenav-tree").replaceChildren();
    showLayer1Progress("starting");
    try {
        renderLayer1View(await readLayer1ViewStream<WireLayer1View>(`/api/layer1-view?${params}&progress=1`));
    } catch (error) {
        // The route's refusals carry the message and no stack — as a 400 body for a bad dir/repo, or
        // as the stream's terminal error line for a bad ref — so the crumb is the whole error
        // surface. No alert(): native dialogs block headless automation.
        crumb.textContent = String(error);
    } finally {
        hideLayer1Progress();
    }
}

// Wire the pickers and the Load button, then draw whatever the URL already asked for.
export function bootLayer1Page(): void {
    // FIRST: readSourceParams reads the BOXES, so without this a ?dir=&repo=&ref= link would open
    // an empty form and draw nothing — half of S18's "one shareable link".
    fillSourceBoxesFromUrl();
    wireZoomControls();
    wireFileNavResize();
    wireBucketJumpButtons();
    wireFindFileBox();
    // Delegated, so it is wired ONCE here rather than per line: the leader lines themselves are
    // replaced on every render, and so is every bubble the pointer resolves against.
    wireLeaderVisibility();
    wireFolderPickers(() => {
        void loadLayer1View();
    });
    getRequiredElementById("load").addEventListener("click", () => {
        void loadLayer1View();
    });
    void loadLayer1View();
}

bootLayer1Page();
