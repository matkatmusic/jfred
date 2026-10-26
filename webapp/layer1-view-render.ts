// Draws a whole Layer 1 view and keeps the folder-selection filter state.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { rememberNavTargets } from "./layer1-diff-wash.ts";
import { showDetailViewForFiles } from "./layer1-drawer-multi.ts";
import { renderLayer1FileNav } from "./layer1-filenav.ts";
import { filterLayer1ViewByTargets } from "./layer1-filter.ts";
import { renderShowRowWithKindFilter } from "./layer1-kind-filter.ts";
import { listSessionFilterTargets, loadLayer1Sessions, renderSessionPane, setKnownProjectPaths } from "./layer1-sessions.ts";
import { renderLayer1Stage } from "./layer1-stage-render.ts";
import { closeRulerExpansion, onExpansionRelayout, readRulerExpansion } from "./layer1-tick-files.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Task 326: an idle picker doesn't filter (both idle = undefined); an empty INTERSECTION draws nothing.
export function getIntersectedFilterTargets(folders: readonly string[], sessions: readonly string[]): string[] | undefined {
  const noFolders = folders.length === 0;
  const noSessions = sessions.length === 0;
  const bothIdle = noFolders && noSessions;
  if (bothIdle) {
    return undefined;
  }
  if (noFolders) {
    return [...sessions];
  }
  if (noSessions) {
    return [...folders];
  }
  const touched = new Set(sessions);
  const shared: string[] = [];
  for (const path of folders) {
    const isShared = touched.has(path);
    if (isShared) {
      shared.push(path);
    }
  }
  return shared;
}

// Module state because the nav's redraw would wipe a selection the session pane still re-applies.
let folderTargets: string[] = [];
// Task 326: the folder selection filters the stage only while this toggle is on.
let onlySelectedIsOn = false;

// Task 326: a fresh project must never start silently filtered.
export function clearFolderFilterState(): void {
  folderTargets = [];
  rememberNavTargets([]);
  onlySelectedIsOn = false;
  getRequiredElementById("filenav-only-selected").classList.remove("current");
}

// Callbacks capture the unfiltered `view`; returns the stage render so the loadbar outlives it.
export function renderLayer1View(view: WireLayer1View): Promise<void> {
  // Task 300: the expansion's own redraw keeps the open row; any FILTER redraw closes it first.
  const renderFilteredStage = (): Promise<void> => renderLayer1Stage(filterLayer1ViewByTargets(
    view, getIntersectedFilterTargets(onlySelectedIsOn ? folderTargets : [], listSessionFilterTargets()), readRulerExpansion(),
  ));
  const closeRowAndRenderStage = (): void => {
    closeRulerExpansion();
    renderFilteredStage();
  };
  onExpansionRelayout(renderFilteredStage);
  // Task 326: wired by assignment, like the nav search box, so re-renders never stack listeners.
  const onlySelectedButton = getRequiredElementById("filenav-only-selected");
  // A re-render builds a fresh button, so its class is derived from the surviving module state.
  onlySelectedButton.classList.toggle("current", onlySelectedIsOn);
  onlySelectedButton.onclick = () => {
    onlySelectedIsOn = !onlySelectedIsOn;
    onlySelectedButton.classList.toggle("current", onlySelectedIsOn);
    closeRowAndRenderStage();
  };
  const selectFolderTargets = (targets: string[]): void => {
    folderTargets = targets;
    rememberNavTargets(targets);
    // Task 333: a multi-selection stays on the FULL timeline; the nav wash alone shows where it falls.
    closeRowAndRenderStage();
    // Task 329: any selection fills the drawer: one DiffView per file, 1..N uniformly.
    if (targets.length >= 1) {
      showDetailViewForFiles(view, targets);
    }
  };
  renderLayer1FileNav(view, selectFolderTargets);
  renderShowRowWithKindFilter(view, renderFilteredStage);
  const stageDrawn = renderLayer1Stage(view);
  // The pane keeps only transcripts that touched one of these files.
  const knownPaths: string[] = [];
  for (const pair of view.pairs) {
    knownPaths.push(pair.path);
  }
  for (const orphan of [...view.gitOrphans, ...view.diskOrphans]) {
    knownPaths.push(orphan.path);
  }
  setKnownProjectPaths(getInputById("dir").value.trim(), knownPaths);
  const renderPaneAfterSessionsLoad = (): void => renderSessionPane(closeRowAndRenderStage);
  // Fetched after the stage is up rather than delaying it: the timeline is the page.
  void loadLayer1Sessions().then(renderPaneAfterSessionsLoad);
  return stageDrawn;
}
