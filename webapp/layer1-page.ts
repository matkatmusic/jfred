// The Layer 1 View page: on-disk state against what the repository says. Its own page, not a hash
// route, because its three inputs live in the query string so a view is one shareable link.
//
// The ruler ACCUMULATES, so an offset can never be recovered from its own instant — this page does
// no time arithmetic, only subtracting a widget's base offset to make a node's offset relative.

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

// Builds elements only; layer1-ruler-rows.ts decides which entries print and what each row reads.
function renderRulerTicks(ruler: WireRulerTick[]): void {
    // A row carries every offset it ABSORBED, since a merged row's click must see all their events.
    const ticks = listRulerRows(ruler).map((row) =>
        makeRulerTickClickable(setAxisPx(el("div", { class: "tick", text: row.text }), row.axisPx), row.axisPxList));
    getRequiredElementById("ruler").replaceChildren(el("div", { class: "rail" }), ...ticks);
}

// One shared line per ruler ENTRY: the per-bubble `.filebox::before` it replaced drew an
// overlapping copy for each of 805 bubbles and made the page unusably slow. Every entry gets one,
// including labels the overprint skip drops, or their bubbles would have no connector at all.
function renderLeaderLines(ruler: WireInstant[]): void {
    getRequiredElementById("leaders").replaceChildren(
        ...ruler.map((entry) => makeLeaderHoverable(setAxisPx(el("div", { class: "leader" }), entry.axisPx))),
    );
}

// Exported so a folder filter can redraw the timeline while leaving the File Nav standing —
// redrawing the nav that SET the filter would shrink it and wipe its selection and expanded state.
export function renderLayer1Stage(view: WireLayer1View): void {
    getRequiredElementById("crumb").textContent =
        `${view.pairs.length} pairs · ${view.gitOrphans.length} repo-only · ${view.diskOrphans.length} disk-only`;
    renderRulerTicks(view.ruler);
    renderLeaderLines(view.ruler);
    const buckets = [
        buildOrphanBucket("No on-disk match", view.gitOrphans),
        buildOrphanBucket("No repository match", view.diskOrphans),
    ];
    getRequiredElementById("stage").replaceChildren(
        ...buildStagePairs(view.pairs),
        ...buckets.filter((bucket) => bucket !== undefined),
    );
    // These three MEASURE the drawn stage, so they must run after the bubbles are in the DOM.
    markMultiEventTicks();
    renderSessionRanges(listSelectedSessions(), view.ruler);
    drawLayer1Minimap();
}

// A file is drawn only when both pickers admit it; an EMPTY list means that picker is not
// filtering, so the other stands alone.
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

// Module state because the session pane's clicks re-apply the folder selection without re-consulting
// the nav, whose redraw would wipe it.
let folderTargets: string[] = [];

// Both callbacks capture the unfiltered `view`, so every later click re-filters from the full
// payload rather than from what the previous filter left, and clearing needs no refetch.
export function renderLayer1View(view: WireLayer1View): void {
    const redrawFiltered = (): void => renderLayer1Stage(
        filterLayer1ViewByTargets(view, intersectFilterTargets(folderTargets, listSessionFilterTargets())),
    );
    renderLayer1FileNav(view, (targets) => {
        folderTargets = targets;
        redrawFiltered();
    });
    renderLayer1Stage(view);
    // The pane keeps only transcripts that touched one of these files; a JSONL from an unrelated
    // project under the same source folder says nothing about this timeline.
    setKnownProjectPaths(getInputById("dir").value.trim(), [
        ...view.pairs.map((pair) => pair.path),
        ...view.gitOrphans.map((orphan) => orphan.path),
        ...view.diskOrphans.map((orphan) => orphan.path),
    ]);
    // Fetched after the stage is up rather than delaying it: the timeline is the page.
    void loadLayer1Sessions().then(() => renderSessionPane(redrawFiltered));
}

// replaceState, not pushState: re-loading the same page is not a navigation.
export async function loadLayer1View(): Promise<void> {
    // Runs before the params are read: an untouched source list is re-derived from the project box.
    syncSourceButtons();
    const params = readSourceParams();
    history.replaceState(null, "", `?${params}`);
    const crumb = getRequiredElementById("crumb");
    if (!params.has("dir") || !params.has("repo")) {
        crumb.textContent = "pick a project folder and a git repo";
        return;
    }
    // Clear all three before the ~10 s build: leaving the stale view up made the page read as frozen.
    crumb.textContent = "";
    getRequiredElementById("stage").replaceChildren();
    getRequiredElementById("filenav-tree").replaceChildren();
    folderTargets = [];
    resetSessionSelection();
    showLayer1Progress("starting");
    try {
        renderLayer1View(await readLayer1ViewStream<WireLayer1View>(`/api/layer1-view?${params}&progress=1`));
    } catch (error) {
        // The crumb is the whole error surface; no alert(), because native dialogs block headless
        // automation.
        crumb.textContent = String(error);
    } finally {
        hideLayer1Progress();
    }
}

export async function bootLayer1Page(): Promise<void> {
    // FIRST: readSourceParams reads the BOXES, so a deep link would otherwise draw nothing.
    fillSourceBoxesFromUrl();
    // Every listener is wired before the awaits below, so a slow endpoint cannot leave a control dead.
    wirePathPickers(() => {
        markSettingsDirty();
        void loadLayer1View();
    });
    wireSettingsSave();
    wireSessionPaneResize();
    // AFTER fillSourceBoxesFromUrl, which seeds the choice from ?time=. Instants resolve
    // server-side, so flipping the toggle re-loads the view.
    wireTimeSourceToggle(() => {
        void loadLayer1View();
    });
    // A branch pick re-loads the whole view; the commit pick only writes into #ref.
    wireRefPickers(() => {
        void loadLayer1View();
    });
    void confirmRepoAndFillRefs();
    wireZoomControls();
    wireFileNavResize();
    wireBucketJumpButtons();
    wireFindFileBox();
    // All three are delegated: every bubble, tick and leader is replaced on each render, so
    // per-element listeners would need re-attaching every time.
    wireNodeDrawer();
    wireTickExpansion();
    wireLeaderVisibility();
    wireFolderPickers(() => {
        void confirmRepoAndFillRefs();
        void loadLayer1View();
    });
    getRequiredElementById("load").addEventListener("click", () => {
        void loadLayer1View();
    });
    // LAST, and in this order: default source lists derive from the server's roots, and saved
    // settings only fill boxes the URL left empty. Both best-effort — the page draws without them.
    await seedSourceDefaults();
    await restoreSavedSettings().catch(() => false);
    void loadLayer1View();
}

void bootLayer1Page();
