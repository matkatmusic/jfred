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

import { el, getInputById, getRequiredElementById } from "./app-dom.ts";
import { wireNodeDrawer } from "./layer1-drawer.ts";
import { renderLayer1FileNav } from "./layer1-filenav.ts";
import { wireFileNavResize, wireSessionPaneResize } from "./layer1-filenav-resize.ts";
import { filterLayer1ViewByTargets } from "./layer1-filter.ts";
import { wireFindFileBox } from "./layer1-find-file.ts";
import { wireBucketJumpButtons } from "./layer1-jump-buckets.ts";
import { makeLeaderHoverable } from "./layer1-leader-hover.ts";
import { wireLeaderVisibility } from "./layer1-leader-visibility.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import { confirmRepoAndFillRefs, wireRefPickers } from "./layer1-refs.ts";
import { makeRulerTickClickable } from "./layer1-ruler-click.ts";
import { listRulerRows } from "./layer1-ruler-rows.ts";
import { wirePathPickers } from "./layer1-path-picker.ts";
import { renderSessionRanges } from "./layer1-ranges.ts";
import { listSelectedSessions, listSessionFilterTargets, loadLayer1Sessions, renderSessionPane, resetSessionSelection, setKnownProjectPaths } from "./layer1-sessions.ts";
import { markSettingsDirty, restoreSavedSettings, wireSettingsSave } from "./layer1-settings.ts";
import { seedSourceDefaults, syncSourceButtons } from "./layer1-source-paths.ts";
import { fillSourceBoxesFromUrl, readSourceParams, wireFolderPickers } from "./layer1-sources.ts";
import { markMultiEventTicks, wireTickExpansion } from "./layer1-tick-files.ts";
import { wireTimeSourceToggle } from "./layer1-time-toggle.ts";
import { buildOrphanBucket, buildStagePairs, setAxisPx } from "./layer1-widgets.ts";
import type { WireInstant, WireLayer1View, WireRulerTick } from "./layer1-wire.ts";
import { wireZoomControls } from "./layer1-zoom.ts";

// The left gutter. Which entries get a printed row, and what each row reads, is decided once by
// layer1-ruler-rows.ts (tasks 268 and 275) — this only builds the elements. Task 260: every drawn
// row is also the navigation control for its instant; a merged row answers for the earliest of the
// instants it stands for, which is the one its `--axis-px` carries.
function renderRulerTicks(ruler: WireRulerTick[]): void {
    // Task 284: the row carries every offset it ABSORBED, not just its own — a merged row stands for
    // several instants, and the click has to see the events at all of them.
    const ticks = listRulerRows(ruler).map((row) =>
        makeRulerTickClickable(setAxisPx(el("div", { class: "tick", text: row.text }), row.axisPx), row.axisPxList));
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
    // Task 284: which ticks would EXPAND is measured off the drawn stage, so this runs after the
    // bubbles are in the DOM — the same reason the minimap does.
    markMultiEventTicks();
    // Task 292: the picked sessions' bands, measured against the ruler this stage was drawn with.
    renderSessionRanges(listSelectedSessions(), view.ruler);
    // Task 246: the minimap MEASURES the widgets it maps, so it is drawn after they are in the DOM.
    drawLayer1Minimap();
}

// Task 292: two pickers, one rule — a file is drawn only when BOTH admit it. An EMPTY list means
// that picker is not filtering, so it contributes nothing and the other one stands alone; two
// non-empty lists intersect.
export function intersectFilterTargets(folders: readonly string[], sessions: readonly string[]): string[] {
    if (folders.length === 0) {
        return [...sessions];
    }
    if (sessions.length === 0) {
        return [...folders];
    }
    const touched = new Set(sessions);
    return folders.filter((path) => touched.has(path));
}

// The File Nav's last folder selection. Module state because the session pane's clicks have to
// re-apply it without the nav being re-consulted — redrawing the nav would wipe its own selection.
let folderTargets: string[] = [];

// Draw a FETCHED view: the File Nav over every file it holds, then the stage.
// The nav is drawn only here, and `view` is captured by both callbacks — so every later click
// re-filters from the unfiltered payload rather than from whatever the previous filter left on
// screen, and an empty selection restores the whole view without another fetch.
export function renderLayer1View(view: WireLayer1View): void {
    const redrawFiltered = (): void => renderLayer1Stage(
        filterLayer1ViewByTargets(view, intersectFilterTargets(folderTargets, listSessionFilterTargets())),
    );
    renderLayer1FileNav(view, (targets) => {
        folderTargets = targets;
        redrawFiltered();
    });
    renderLayer1Stage(view);
    // Every file this view draws, in the view's own relative spelling. The pane keeps only the
    // transcripts that touched one of them (user, 2026-07-27) — a JSONL from an unrelated project
    // under the same source folder has nothing to say about this timeline.
    setKnownProjectPaths(getInputById("dir").value.trim(), [
        ...view.pairs.map((pair) => pair.path),
        ...view.gitOrphans.map((orphan) => orphan.path),
        ...view.diskOrphans.map((orphan) => orphan.path),
    ]);
    // The session pane fills from its OWN endpoint, so it is fetched after the stage is up rather
    // than delaying it — the timeline is the page, this pane is an accessory to it.
    void loadLayer1Sessions().then(() => renderSessionPane(redrawFiltered));
}

// Fetch and draw the view for whatever the boxes currently hold, mirroring them into the URL
// first (replaceState, not pushState: re-loading the same page is not a navigation).
export async function loadLayer1View(): Promise<void> {
    // Tasks 295/296: the source lists travel in the URL too, and an untouched list is re-derived
    // from whatever project folder the box now holds — so this runs before the params are read.
    syncSourceButtons();
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
    // A filter from the previous project must not survive into the next one's render.
    folderTargets = [];
    resetSessionSelection();
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
export async function bootLayer1Page(): Promise<void> {
    // FIRST: readSourceParams reads the BOXES, so without this a ?dir=&repo=&ref= link would open
    // an empty form and draw nothing — half of S18's "one shareable link".
    fillSourceBoxesFromUrl();
    // Tasks 295/296/297. Wired here with every other listener; the two AWAITS they depend on come
    // after the whole page is wired, so a slow or refusing endpoint can never leave a control dead.
    wirePathPickers(() => {
        markSettingsDirty();
        void loadLayer1View();
    });
    wireSettingsSave();
    wireSessionPaneResize();
    // AFTER fillSourceBoxesFromUrl: it seeds the choice from ?time=, and this syncs the buttons'
    // `.current` class to whatever is now selected (task 282). The instants are resolved
    // server-side, so flipping the toggle re-loads the view.
    wireTimeSourceToggle(() => {
        void loadLayer1View();
    });
    // Task 286: a branch pick re-loads the whole view; the commit pick only writes into #ref.
    wireRefPickers(() => {
        void loadLayer1View();
    });
    void confirmRepoAndFillRefs();
    wireZoomControls();
    wireFileNavResize();
    wireBucketJumpButtons();
    wireFindFileBox();
    // Delegated like wireLeaderVisibility below: every bubble and every tick is replaced on each
    // render, so a per-element listener would have to be re-attached every time (tasks 257/284).
    wireNodeDrawer();
    wireTickExpansion();
    // Delegated, so it is wired ONCE here rather than per line: the leader lines themselves are
    // replaced on every render, and so is every bubble the pointer resolves against.
    wireLeaderVisibility();
    wireFolderPickers(() => {
        void confirmRepoAndFillRefs();
        void loadLayer1View();
    });
    getRequiredElementById("load").addEventListener("click", () => {
        void loadLayer1View();
    });
    // LAST, and in this order: the server's roots are what the default source lists are derived
    // from, and a saved project can only fill boxes the URL left empty (restoreSavedSettings stands
    // down when the URL names a project). Both are best-effort — the page still draws without them.
    await seedSourceDefaults();
    await restoreSavedSettings().catch(() => false);
    void loadLayer1View();
}

void bootLayer1Page();
