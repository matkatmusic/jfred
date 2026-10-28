// Own page (not a hash route) so its query-string inputs make a shareable link; no time arithmetic, offsets relative.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { installNodeDrawer } from "./layer1-drawer.ts";
import { installMultiFileDrawer } from "./layer1-drawer-multi.ts";
import { initFileNavResize, initSessionPaneResize } from "./layer1-filenav-resize.ts";
import { initFindFileBox } from "./layer1-find-file.ts";
import { attachBucketJumpButtons } from "./layer1-jump-buckets.ts";
import { scrollToFirstVisibleNode } from "./layer1-first-node-scroll.ts"; // import { wireLayerToggle } from "./layer1-layer-toggle.ts";
import { openLinkedNodeAfterLoad } from "./layer1-linked-node.ts";
import { installCopyLinkButton, readNodeLinkIdentity } from "./layer1-node-link.ts";
import { wireLeaderVisibility } from "./layer1-leader-visibility.ts";
import { wireBusyShield } from "./layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress, wireLayer1CancelButton } from "./layer1-progress.ts";
import { confirmRepoAndFillRefs, wireRefPickers } from "./layer1-refs.ts";
import { wirePathPickers } from "./layer1-path-picker.ts";
import { wireBubbleFlash } from "./layer1-session-flash.ts";
import { resetSessionSelection } from "./layer1-sessions.ts";
import { applySavedSettingsForCurrentDir, markSettingsDirty, restoreSavedSettings, wireSettingsSave } from "./layer1-settings.ts";
import { resetSourcePathsOnProjectChange, seedSourceDefaults, syncSourceButtons } from "./layer1-source-paths.ts";
import { fillSourceBoxesFromUrl, readSourceParams, wireFolderPickers } from "./layer1-sources.ts";
import { closeRulerExpansion, wireTickExpansion } from "./layer1-tick-files.ts";
import { wireTimeSourceToggle } from "./layer1-time-toggle.ts";
import { installProjectSettingsToggle } from "./layer1-project-settings-toggle.ts";
import { clearFolderFilterState, renderLayer1View } from "./layer1-view-render.ts";
import type { WireLayer1View } from "./layer1-wire.ts";
import { attachZoomControls } from "./layer1-zoom.ts";

// Task 366: the project #dir named when its saved settings were last applied; a switch re-fetches the new project's.
let appliedProjectDir: string | undefined = undefined;

// replaceState, not pushState: re-loading the same page is not a navigation.
export async function loadLayer1View(): Promise<void> {
  // Task 364: a switch to a different project folder drops the previous project's source lists first.
  resetSourcePathsOnProjectChange();
  // Task 366: after the wipe and before defaults derive, load the newly-named project's saved settings.
  const currentDir = getInputById("dir").value.trim();
  const hasAppliedDir = appliedProjectDir !== undefined;
  const isNewDir = currentDir !== appliedProjectDir;
  const isProjectSwitch = hasAppliedDir && isNewDir;
  if (isProjectSwitch) {
    await applySavedSettingsForCurrentDir();
  }
  appliedProjectDir = currentDir;
  // Runs before the params are read: an untouched source list is re-derived from the project box.
  syncSourceButtons();
  const params = readSourceParams();
  history.replaceState(null, "", `?${params}`);
  const crumb = getRequiredElementById("crumb");
  const hasDir = params.has("dir");
  const hasRepo = params.has("repo");
  const isMissingSource = !hasDir || !hasRepo;
  if (isMissingSource) {
    crumb.textContent = "pick a project folder and a git repo";
    // There is no build to report, so boot's opening strip must not be left hanging.
    hideLayer1Progress();
    return;
  }
  // Clear all three before the ~10 s build: leaving the stale view up made the page read as frozen.
  crumb.textContent = "";
  getRequiredElementById("stage").replaceChildren();
  getRequiredElementById("filenav-tree").replaceChildren();
  clearFolderFilterState();
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
  }
  catch (error) {
    // The crumb is the whole error surface; no alert(), because native dialogs block headless automation.
    crumb.textContent = String(error);
  }
  finally {
    hideLayer1Progress();
  }
}

function loadViewInBackground(): void {
  void loadLayer1View();
}

function markDirtyAndLoadView(): void {
  markSettingsDirty();
  void loadLayer1View();
}

function loadViewAfterRefCheck(): void {
  void confirmRepoAndFillRefs();
  void loadLayer1View();
}

function getFailedRestoreResult(): boolean {
  return false;
}

export async function initLayer1Page(): Promise<void> {
  // BEFORE loadLayer1View, whose replaceState drops the node params from the URL.
  const linkedNode = readNodeLinkIdentity(location.search);
  // FIRST: readSourceParams reads the BOXES, so a deep link would otherwise draw nothing.
  fillSourceBoxesFromUrl();
  // Up before the awaits below, or a deep link shows an idle page for two whole round trips.
  showLayer1Progress("starting");
  // Every listener is wired before the awaits below, so a slow endpoint cannot leave a control dead.
  wirePathPickers(markDirtyAndLoadView);
  wireSettingsSave();
  initSessionPaneResize();
  // AFTER fillSourceBoxesFromUrl, which seeds the choice from ?time=. Instants resolve server-side, so flipping the toggle re-loads the view.
  wireTimeSourceToggle(loadViewInBackground);
  installProjectSettingsToggle();
  // A branch pick re-loads the whole view; the commit pick only writes into #ref.
  wireRefPickers(loadViewInBackground);
  void confirmRepoAndFillRefs();
  wireLayer1CancelButton();
  wireBusyShield();
  attachZoomControls();
  // wireLayerToggle();
  initFileNavResize();
  attachBucketJumpButtons();
  initFindFileBox();
  // All three are delegated, since every bubble, tick and leader is replaced on each render.
  installNodeDrawer();
  wireBubbleFlash();
  installMultiFileDrawer();
  installCopyLinkButton();
  wireTickExpansion();
  wireLeaderVisibility();
  wireFolderPickers(loadViewAfterRefCheck);
  getRequiredElementById("load").addEventListener("click", loadViewInBackground);
  // LAST and in this order: sources derive from server roots, saved settings only fill empty boxes.
  await seedSourceDefaults();
  await restoreSavedSettings().catch(getFailedRestoreResult);
  await loadLayer1View();
  scrollToFirstVisibleNode();
  if (linkedNode !== undefined) {
    await openLinkedNodeAfterLoad(linkedNode);
  }
}

void initLayer1Page();
