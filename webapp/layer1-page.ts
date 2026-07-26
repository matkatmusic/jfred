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
import { wireFindFileBox } from "./layer1-find-file.ts";
import { wireBucketJumpButtons } from "./layer1-jump-buckets.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import { makeRulerTickClickable } from "./layer1-ruler-click.ts";
import { fillSourceBoxesFromUrl, readSourceParams, wireFolderPickers } from "./layer1-sources.ts";
import { wireZoomControls } from "./layer1-zoom.ts";

// What JSON.parse yields from /api/layer1-view: `Path` arrives as a plain string and `Instant` as
// ISO text, so these are NOT src/viewer_api_layer1.ts's Layer1Wire* types (same naming convention
// as webapp/layered-app.ts's Wire* mirrors).
interface WireInstant {
    instant: string;
    axisPx: number;
}

interface WireCommit extends WireInstant {
    hash: string;
}

interface WirePair {
    path: string;
    // Oldest first, as the endpoint emits them.
    commits: WireCommit[];
    onDisk: WireInstant;
}

interface WireOrphan extends WireInstant {
    path: string;
}

interface WireLayer1View {
    pairs: WirePair[];
    gitOrphans: WireOrphan[];
    diskOrphans: WireOrphan[];
    // Every distinct instant the view draws, ascending.
    ruler: WireInstant[];
}

// Minimum vertical distance between two tick LABELS, in px (the mockup's collision skip). At the
// locked 2.5 px/hour two commits minutes apart resolve under 1 px, so without this the ruler
// gutter renders as overlapping text.
const TICK_LABEL_MIN_GAP_PX = 13;

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

// The mockup's tick/row label: "MM-DD HH:MM" in UTC.
function formatInstantLabel(instant: string): string {
    return new Date(instant).toISOString().slice(5, 16).replace("T", " ");
}

// The left gutter's ticks. `ruler` arrives ascending, so one running "last drawn" position is
// enough to drop a label that would collide with the one above it.
function renderRulerTicks(ruler: WireInstant[]): void {
    const ticks: HTMLElement[] = [];
    let lastDrawnPx = Number.NEGATIVE_INFINITY;
    for (const tick of ruler) {
        if (tick.axisPx - lastDrawnPx < TICK_LABEL_MIN_GAP_PX) {
            continue;
        }
        lastDrawnPx = tick.axisPx;
        const drawn = setAxisPx(el("div", { class: "tick", text: formatInstantLabel(tick.instant) }), tick.axisPx);
        // Task 260: a drawn tick is also the navigation control for its instant. Only DRAWN ticks
        // get one — the collision skip above means not every instant has a row to click.
        ticks.push(makeRulerTickClickable(drawn));
    }
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
        ...ruler.map((entry) => setAxisPx(el("div", { class: "leader" }), entry.axisPx)),
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

// One pair's widget: named by its BASENAME, full path on hover (task 245 — a path is unbounded but
// the bubble is 168 px), offset to its EARLIEST node, a node per commit, on-disk node last.
function buildPairWidget(pair: WirePair): HTMLElement {
    // Spans EARLIEST to LATEST whichever KIND each is: an on-disk mtime predating the first commit
    // gave a negative offset, drawing the disk node over the header (247-249). Empty ladder: free.
    const nodePx = [...pair.commits.map((commit) => commit.axisPx), pair.onDisk.axisPx];
    const startPx = Math.min(...nodePx);
    const lane = setAxisPx(el("div", { class: "lane" }), 0);
    lane.style.setProperty("--span-px", String(Math.max(...nodePx) - startPx));
    lane.append(el("div", { class: "lrail" }));
    for (const commit of pair.commits) {
        // Short label, full hash on hover — see SHORT_HASH_LENGTH.
        appendAxisNode(lane, commit.axisPx - startPx, "n-commit", commit.hash.slice(0, SHORT_HASH_LENGTH), commit.hash);
    }
    appendAxisNode(lane, pair.onDisk.axisPx - startPx, "n-disk", "on disk");
    return setAxisPx(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: pair.path.split("/").pop() ?? pair.path, title: pair.path }),
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
    const list = el("ul", {}, rows.map((row) => el("li", {}, [
        el("span", { text: row.path }),
        el("em", { text: formatInstantLabel(row.instant) }),
    ])));
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

// Draw a fetched view: the crumb, the ruler gutter, the pair widgets and the two buckets.
export function renderLayer1View(view: WireLayer1View): void {
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
    // Clear BOTH before the ~10 s build: the previous view's counts and widgets are stale the moment
    // a new load starts, and leaving them up is what made the page read as frozen.
    crumb.textContent = "";
    getRequiredElementById("stage").replaceChildren();
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
    wireBucketJumpButtons();
    wireFindFileBox();
    wireFolderPickers(() => {
        void loadLayer1View();
    });
    getRequiredElementById("load").addEventListener("click", () => {
        void loadLayer1View();
    });
    void loadLayer1View();
}

bootLayer1Page();
