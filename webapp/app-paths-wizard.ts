// ─── task 159: the Paths settings wizard entry points and listener wiring (plans/159-paths-wizard-mockup.md).

import { getInputById } from "./app-dom.ts";
import { renderPathsSummary } from "./app-paths-summary.ts";
import { clearActiveRun, launchWizardRun, moveWizardBack, moveWizardForward, stopWizardRun, storeWizardRun } from "./app-paths-wizard-run.ts";
import {
  findRouteProjectName, getPathsPopover, selectPopoverFace, selectProjectsDir, selectRepoDir,
  syncFileHistoryFieldsToRadios, triggerCommitPicker,
} from "./app-paths-wizard-screens.ts";

const ALL_SCREEN_NUMBERS = [1, 2, 3, 4, 5];
const PROJECT_SCREEN_NUMBERS = [2, 3, 4, 5];

// Without a project there are no per-project screens, so the run is screen 1 only.
function launchFullWizard(projectName: string | undefined): void {
  launchWizardRun(projectName === undefined ? [1] : ALL_SCREEN_NUMBERS, projectName);
}

// Project loaded with no reveng-paths entry: screens 2–5.
function launchProjectWizard(projectName: string): void {
  launchWizardRun(PROJECT_SCREEN_NUMBERS, projectName);
}

// A summary row's [Edit]: the single screen, whose Next is Finish.
function launchSingleScreenEdit(screenNumber: number, projectName: string | undefined): void {
  launchWizardRun([screenNumber], projectName);
}

// First launch: the projects-dir input is empty only when the server reports no configured folder.
function launchFirstLaunchWizard(): void {
  const projectsDirValue = getInputById("projects-dir-input").value;
  if (projectsDirValue !== "") {
    return;
  }
  launchFullWizard(findRouteProjectName());
}

// Every Paths… open resets to the summary face.
function resetPathsPopoverOnOpen(): void {
  const isPopoverHidden = getPathsPopover().hidden;
  if (isPopoverHidden) {
    return;   // the click toggled the popover closed
  }
  clearActiveRun();
  selectPopoverFace("paths-summary");
  renderPathsSummary(findRouteProjectName(), launchSingleScreenEdit);
}

function closeWizardOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    stopWizardRun();
  }
}

function launchFullWizardForRoute(): void {
  launchFullWizard(findRouteProjectName());
}

function initWizard(): void {
  document.getElementById("wizard-back")!.addEventListener("click", moveWizardBack);
  document.getElementById("wizard-next")!.addEventListener("click", moveWizardForward);
  document.getElementById("wizard-cancel")!.addEventListener("click", stopWizardRun);
  document.getElementById("paths-run-wizard")!.addEventListener("click", launchFullWizardForRoute);
  document.getElementById("wizard-set-projects-dir")!.addEventListener("click", selectProjectsDir);
  document.getElementById("wizard-set-repo-dir")!.addEventListener("click", selectRepoDir);
  getInputById("wizard-file-history-auto").addEventListener("change", syncFileHistoryFieldsToRadios);
  getInputById("wizard-file-history-custom").addEventListener("change", syncFileHistoryFieldsToRadios);
  getInputById("wizard-commit-pick").addEventListener("change", triggerCommitPicker);
  document.getElementById("project-paths-apply")!.addEventListener("click", storeWizardRun);
  document.getElementById("project-paths-store")!.addEventListener("click", storeWizardRun);
  document.getElementById("paths-btn")!.addEventListener("click", resetPathsPopoverOnOpen);
  getPathsPopover().addEventListener("keydown", closeWizardOnEscape as EventListener);
}

export {
  launchFullWizard as startFullWizard,
  launchProjectWizard as startProjectWizard,
  launchSingleScreenEdit as startSingleScreenEdit,
  launchFirstLaunchWizard as maybeStartFirstLaunchWizard,
  initWizard as initializeWizard,
};
