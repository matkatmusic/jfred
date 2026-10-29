// ─── task 159: the Paths wizard's active-run state, navigation, and finish.

import { storeBaselineChoice } from "./app-choices.ts";
import { getInputById } from "./app-dom.ts";
import { renderFinishRows } from "./app-paths-summary.ts";
import { clearRepoFields, fillScreen, getPathsPopover, selectPopoverFace } from "./app-paths-wizard-screens.ts";

type WizardRun = {
  screenNumbers: number[];
  screenIndex: number;
  projectName: string | undefined;
  // Screen 1's entry value: Finish posts /api/config only when the folder changed.
  initialProjectsDir: string;
};

let activeRun: WizardRun | undefined;

export function clearActiveRun(): void {
  activeRun = undefined;
}

function renderCurrentScreen(): void {
  const run = activeRun!;
  const screenNumber = run.screenNumbers[run.screenIndex]!;
  fillScreen(screenNumber, run.projectName);
  selectPopoverFace(`wizard-screen-${screenNumber}`);
  (document.getElementById("wizard-back") as HTMLButtonElement).disabled = run.screenIndex === 0;
  const isLast = run.screenIndex === run.screenNumbers.length - 1;
  document.getElementById("wizard-next")!.textContent = isLast ? "Finish ▸" : "Next ▸";
}

function renderFinishFace(): void {
  renderFinishRows(activeRun!.projectName);
  selectPopoverFace("wizard-finish");
}

export function moveWizardForward(): void {
  if (activeRun === undefined) {
    return;
  }
  const currentScreen = activeRun.screenNumbers[activeRun.screenIndex]!;
  const isRepoScreen = currentScreen === 3;
  const isCommitScreen = currentScreen === 4;
  const repoAnsweredNo = getInputById("wizard-repo-no").checked;
  const commitAnsweredDefault = getInputById("wizard-commit-default").checked;
  const skipsBaseline = isRepoScreen && repoAnsweredNo;
  const declinesCommitPick = isCommitScreen && commitAnsweredDefault;
  if (skipsBaseline) {
    clearRepoFields();
    renderFinishFace();   // skips 4 AND 5: no repo means no baseline
    return;
  }
  if (declinesCommitPick) {
    // Declining the pick posts no baseCommit.
    getInputById("base-commit-display").value = "";
  }
  if (activeRun.screenIndex === activeRun.screenNumbers.length - 1) {
    renderFinishFace();
    return;
  }
  activeRun.screenIndex += 1;
  renderCurrentScreen();
}

export function moveWizardBack(): void {
  const hasNoRun = activeRun === undefined;
  if (hasNoRun) {
    return;
  }
  if (activeRun!.screenIndex === 0) {
    return;
  }
  activeRun!.screenIndex -= 1;
  renderCurrentScreen();
}

// Cancel/Esc: abandon the run with nothing posted.
export function stopWizardRun(): void {
  activeRun = undefined;
  getPathsPopover().hidden = true;
  selectPopoverFace("paths-summary");
}

export function launchWizardRun(screenNumbers: number[], projectName: string | undefined): void {
  const initialProjectsDir = getInputById("projects-dir-input").value;
  activeRun = { screenNumbers, screenIndex: 0, projectName, initialProjectsDir };
  getPathsPopover().hidden = false;
  renderCurrentScreen();
}

// Registers BEFORE the buttons' onclick, so the baseline mirror is stored before the POST reads it.
export function storeWizardRun(): void {
  if (activeRun === undefined) {
    return;
  }
  const run = activeRun;
  activeRun = undefined;
  const hasBaselineScreen = run.screenNumbers.includes(5);
  const hasProjectName = run.projectName !== undefined;
  const repoDirValue = getInputById("repo-dir-input").value;
  const storesBaseline = hasBaselineScreen && hasProjectName && repoDirValue !== "";
  if (storesBaseline) {
    storeBaselineChoice(run.projectName!, getInputById("wizard-prebaseline-yes").checked ? "1" : "0");
  }
  const hasFolderScreen = run.screenNumbers.includes(1);
  const projectsDirValue = getInputById("projects-dir-input").value;
  const changesProjectsDir = hasFolderScreen && projectsDirValue !== run.initialProjectsDir;
  if (changesProjectsDir) {
    // Reuse the pre-wizard apply button: posts /api/config, clears caches, re-renders.
    document.getElementById("projects-dir-change")!.click();
  }
  getPathsPopover().hidden = true;
  selectPopoverFace("paths-summary");
}
