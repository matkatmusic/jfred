// Own page (not a hash route) so its query-string inputs make a shareable link; no time arithmetic, offsets relative.

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
import { LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE, hideLayer1Progress, readLayer1ViewStream, showLayer1Progress, waitForPaintedFrame, wireLayer1CancelButton } from "./layer1-progress.ts";
import { confirmRepoAndFillRefs, wireRefPickers } from "./layer1-refs.ts";
import { makeRulerTickClickable } from "./layer1-ruler-click.ts";
import { listRulerRows } from "./layer1-ruler-rows.ts";
import { wirePathPickers } from "./layer1-path-picker.ts";
import { renderSessionRanges } from "./layer1-ranges.ts";
import { listSelectedSessions, listSessionFilterTargets, loadLayer1Sessions, renderSessionPane, resetSessionSelection, setKnownProjectPaths } from "./layer1-sessions.ts";
import { markSettingsDirty, restoreSavedSettings, wireSettingsSave } from "./layer1-settings.ts";
import { seedSourceDefaults, syncSourceButtons } from "./layer1-source-paths.ts";
import { fillSourceBoxesFromUrl, readSourceParams, wireFolderPickers } from "./layer1-sources.ts";
import { closeRulerExpansion, markMultiEventTicks, onExpansionRelayout, readRulerExpansion, wireTickExpansion } from "./layer1-tick-files.ts";
import { wireTimeSourceToggle } from "./layer1-time-toggle.ts";
import { buildOrphanBucket, buildStagePairs, setAxisPx } from "./layer1-widgets.ts";
import type { WireInstant, WireLayer1View, WireRulerTick } from "./layer1-wire.ts";
import { wireZoomControls } from "./layer1-zoom.ts";

// Builds elements only; layer1-ruler-rows.ts decides which entries print and what each row reads.
function renderRulerTicks(ruler: WireRulerTick[]): void {
    // A row carries every offset it ABSORBED, since a merged row's click must see all their events.
    const ticks = listRulerRows(ruler).map((row) =>
        makeRulerTickClickable(setAxisPx(el("div", { class: "tick", text: row.text }), row.axisPx), row));
    getRequiredElementById("ruler").replaceChildren(el("div", { class: "rail" }), ...ticks);
}

// One shared line per ruler entry, replacing the per-bubble `.filebox::before` that drew 805 overlapping copies and was unusably slow.
function renderLeaderLines(ruler: WireInstant[]): void {
    getRequiredElementById("leaders").replaceChildren(
        ...ruler.map((entry) => makeLeaderHoverable(setAxisPx(el("div", { class: "leader" }), entry.axisPx))),
    );
}

// Task 309: chunked appends with painted counts, so a big render never reads as a hang.
const STAGE_CHUNK_WIDGETS = 100;

// Bumped by every render so a superseded chunked pass stops instead of interleaving DOM writes.
let stageRenderPass = 0;

// Exported for filter redraws; a single-chunk (test-sized) view completes synchronously, no await runs.
export async function renderLayer1Stage(view: WireLayer1View): Promise<void> {
    const pass = ++stageRenderPass;
    getRequiredElementById("crumb").textContent =
        `${view.pairs.length} pairs · ${view.gitOrphans.length} repo-only · ${view.diskOrphans.length} disk-only`;
    renderRulerTicks(view.ruler);
    renderLeaderLines(view.ruler);
    const buckets = [
        buildOrphanBucket("No on-disk match", view.gitOrphans),
        buildOrphanBucket("No repository match", view.diskOrphans),
    ];
    const widgets = [...buildStagePairs(view.pairs), ...buckets.filter((bucket) => bucket !== undefined)];
    const stage = getRequiredElementById("stage");
    stage.replaceChildren();
    for (let done = 0; done < widgets.length; done += STAGE_CHUNK_WIDGETS) {
        stage.append(...widgets.slice(done, done + STAGE_CHUNK_WIDGETS));
        // Only a multi-chunk render paints between chunks; a small one must never flash the loadbar.
        if (widgets.length <= STAGE_CHUNK_WIDGETS) {
            continue;
        }
        showLayer1Progress(LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE,
            Math.min(done + STAGE_CHUNK_WIDGETS, widgets.length), widgets.length);
        await waitForPaintedFrame();
        if (pass !== stageRenderPass) {
            return;
        }
    }
    if (widgets.length > STAGE_CHUNK_WIDGETS) {
        hideLayer1Progress();
    }
    // These three MEASURE the drawn stage, so they must run after the bubbles are in the DOM.
    markMultiEventTicks();
    renderSessionRanges(listSelectedSessions(), view.ruler);
    drawLayer1Minimap();
}

// Task 326: an idle picker doesn't filter (both idle = undefined); an empty INTERSECTION draws nothing.
export function intersectFilterTargets(folders: readonly string[], sessions: readonly string[]): string[] | undefined {
    if (folders.length === 0 && sessions.length === 0) {
        return undefined;
    }
    if (folders.length === 0) {
        return [...sessions];
    }
    if (sessions.length === 0) {
        return [...folders];
    }
    const touched = new Set(sessions);
    return folders.filter((path) => touched.has(path));
}

// Module state because the nav's redraw would wipe a selection the session pane still re-applies.
let folderTargets: string[] = [];
// Task 326: the folder selection filters the stage only while this toggle is on.
let onlySelectedIsOn = false;

// Callbacks capture the unfiltered `view`; returns the stage render so the loadbar outlives it.
export function renderLayer1View(view: WireLayer1View): Promise<void> {
    // Task 300: the expansion's own redraw keeps the open row; any FILTER redraw closes it first.
    const redrawStage = (): void => void renderLayer1Stage(filterLayer1ViewByTargets(
        view, intersectFilterTargets(onlySelectedIsOn ? folderTargets : [], listSessionFilterTargets()), readRulerExpansion(),
    ));
    const redrawFiltered = (): void => {
        closeRulerExpansion();
        redrawStage();
    };
    onExpansionRelayout(redrawStage);
    renderLayer1FileNav(view, (targets) => {
        folderTargets = targets;
        redrawFiltered();
    });
    // Task 326: wired by assignment, like the nav search box, so re-renders never stack listeners.
    const onlySelectedButton = getRequiredElementById("filenav-only-selected");
    onlySelectedButton.onclick = () => {
        onlySelectedIsOn = !onlySelectedIsOn;
        onlySelectedButton.classList.toggle("current", onlySelectedIsOn);
        redrawFiltered();
    };
    const stageDrawn = renderLayer1Stage(view);
    // The pane keeps only transcripts that touched one of these files.
    setKnownProjectPaths(getInputById("dir").value.trim(), [
        ...view.pairs.map((pair) => pair.path),
        ...view.gitOrphans.map((orphan) => orphan.path),
        ...view.diskOrphans.map((orphan) => orphan.path),
    ]);
    // Fetched after the stage is up rather than delaying it: the timeline is the page.
    void loadLayer1Sessions().then(() => renderSessionPane(redrawFiltered));
    return stageDrawn;
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
        // There is no build to report, so boot's opening strip must not be left hanging.
        hideLayer1Progress();
        return;
    }
    // Clear all three before the ~10 s build: leaving the stale view up made the page read as frozen.
    crumb.textContent = "";
    getRequiredElementById("stage").replaceChildren();
    getRequiredElementById("filenav-tree").replaceChildren();
    folderTargets = [];
    // Task 326: a fresh project must never start silently filtered.
    onlySelectedIsOn = false;
    getRequiredElementById("filenav-only-selected").classList.remove("current");
    closeRulerExpansion();
    resetSessionSelection();
    showLayer1Progress("starting");
    try {
        const view = await readLayer1ViewStream<WireLayer1View>(`/api/layer1-view?${params}&progress=1`);
        if (view === undefined) {
            // Task 302: an aborted stream is a clean stop, reported plainly rather than as an error.
            crumb.textContent = "load cancelled";
            return;
        }
        await renderLayer1View(view);
    } catch (error) {
        // The crumb is the whole error surface; no alert(), because native dialogs block headless automation.
        crumb.textContent = String(error);
    } finally {
        hideLayer1Progress();
    }
}

export async function bootLayer1Page(): Promise<void> {
    // FIRST: readSourceParams reads the BOXES, so a deep link would otherwise draw nothing.
    fillSourceBoxesFromUrl();
    // Up before the awaits below, or a deep link shows an idle page for two whole round trips.
    showLayer1Progress("starting");
    // Every listener is wired before the awaits below, so a slow endpoint cannot leave a control dead.
    wirePathPickers(() => {
        markSettingsDirty();
        void loadLayer1View();
    });
    wireSettingsSave();
    wireSessionPaneResize();
    // AFTER fillSourceBoxesFromUrl, which seeds the choice from ?time=. Instants resolve server-side, so flipping the toggle re-loads the view.
    wireTimeSourceToggle(() => {
        void loadLayer1View();
    });
    // A branch pick re-loads the whole view; the commit pick only writes into #ref.
    wireRefPickers(() => {
        void loadLayer1View();
    });
    void confirmRepoAndFillRefs();
    wireLayer1CancelButton();
    wireZoomControls();
    wireFileNavResize();
    wireBucketJumpButtons();
    wireFindFileBox();
    // All three are delegated, since every bubble, tick and leader is replaced on each render.
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
    // LAST and in this order: sources derive from server roots, saved settings only fill empty boxes.
    await seedSourceDefaults();
    await restoreSavedSettings().catch(() => false);
    void loadLayer1View();
}

void bootLayer1Page();
