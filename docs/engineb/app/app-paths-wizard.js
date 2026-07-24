// ─── task 159: the Paths settings wizard state machine (plans/159-paths-wizard-mockup.md).
// The popover's faces: the summary panel (default), #wizard-screen-1…5 (wrapping the
// pre-wizard controls, ids preserved), and the Finish face reusing #project-paths-apply /
// #project-paths-store as the 137-style store prompt. Cancel/Esc abandons with nothing
// posted; screen 3 answered "no" skips 4 AND 5 (no repo ⇒ no baseline).
import { storeBaselineChoice } from "./app-choices.js";
import { getInputById } from "./app-dom.js";
import { pickFolderInto } from "./app-header.js";
import { renderFinishRows, renderPathsSummary, resolveDefaultCommitLabel } from "./app-paths-summary.js";
import { parseRouteSegments } from "./app-routes.js";
const ALL_SCREEN_NUMBERS = [1, 2, 3, 4, 5];
const PROJECT_SCREEN_NUMBERS = [2, 3, 4, 5];
// The popover faces the state machine swaps between (one visible at a time).
const FACE_ELEMENT_IDS = [
    "paths-summary", "wizard-screen-1", "wizard-screen-2", "wizard-screen-3",
    "wizard-screen-4", "wizard-screen-5", "wizard-finish",
];
let activeRun;
function getPathsPopover() {
    return document.getElementById("paths-popover");
}
function showPopoverFace(faceId) {
    for (const id of FACE_ELEMENT_IDS) {
        document.getElementById(id).hidden = id !== faceId;
    }
    document.getElementById("wizard-nav").hidden = !faceId.startsWith("wizard-screen-");
}
// ─── per-screen prefill (every screen prefills the stored/derived current value) ───
// Screen 2: the task-136 fields' visibility IS the auto-derive/custom state.
function prepareFileHistoryScreen() {
    // lib.dom types `hidden` as string | boolean (the "until-found" value); ours is boolean.
    const fieldsHidden = document.getElementById("file-history-fields").hidden !== false;
    getInputById("wizard-file-history-auto").checked = fieldsHidden;
    getInputById("wizard-file-history-custom").checked = !fieldsHidden;
}
// Screen 3: a non-empty repo field means "yes".
function prepareRepoScreen() {
    const hasRepo = getInputById("repo-dir-input").value !== "";
    getInputById("wizard-repo-yes").checked = hasRepo;
    getInputById("wizard-repo-no").checked = !hasRepo;
}
// Screen 4: a stored base commit preselects "Pick one"; the default label resolves async
// (stored/session baseline, else the repo tip — app-paths-summary.ts).
function prepareCommitScreen(projectName) {
    const hasStored = getInputById("base-commit-display").value !== "";
    getInputById("wizard-commit-pick").checked = hasStored;
    getInputById("wizard-commit-default").checked = !hasStored;
    const label = document.getElementById("wizard-commit-default-label");
    label.textContent = "Default: resolving…";
    resolveDefaultCommitLabel(projectName)
        .then((text) => { label.textContent = text; })
        .catch(() => { label.textContent = "Default: (repo unreadable)"; });
}
// Screen 5 needs no prepare: the DOM default ("No", per the mockup) stands, and the radios
// keep the last checked answer within the session until Finish stores it in the mirror.
function prepareScreen(screenNumber, projectName) {
    if (screenNumber === 2)
        prepareFileHistoryScreen();
    if (screenNumber === 3)
        prepareRepoScreen();
    if (screenNumber === 4)
        prepareCommitScreen(projectName);
}
// ─── navigation ───
function showCurrentScreen() {
    const run = activeRun;
    const screenNumber = run.screenNumbers[run.screenIndex];
    prepareScreen(screenNumber, run.projectName);
    showPopoverFace(`wizard-screen-${screenNumber}`);
    document.getElementById("wizard-back").disabled = run.screenIndex === 0;
    const isLast = run.screenIndex === run.screenNumbers.length - 1;
    document.getElementById("wizard-next").textContent = isLast ? "Finish ▸" : "Next ▸";
}
function showFinishFace() {
    renderFinishRows(activeRun.projectName);
    showPopoverFace("wizard-finish");
}
// Screen 3 answered "no": drop the repo AND base commit so the project reconstructs exactly
// as with no reveng-paths entry (mockup resolved ambiguity 4).
function clearRepoFields() {
    getInputById("repo-dir-input").value = "";
    getInputById("base-commit-display").value = "";
}
function advanceWizard() {
    if (activeRun === undefined) {
        return;
    }
    const currentScreen = activeRun.screenNumbers[activeRun.screenIndex];
    if (currentScreen === 3 && getInputById("wizard-repo-no").checked) {
        clearRepoFields();
        showFinishFace(); // skips 4 AND 5 — no repo ⇒ no baseline
        return;
    }
    if (currentScreen === 4 && getInputById("wizard-commit-default").checked) {
        // Declining the pick posts no baseCommit — the entry stays default-shaped.
        getInputById("base-commit-display").value = "";
    }
    if (activeRun.screenIndex === activeRun.screenNumbers.length - 1) {
        showFinishFace();
        return;
    }
    activeRun.screenIndex += 1;
    showCurrentScreen();
}
function retreatWizard() {
    if (activeRun === undefined || activeRun.screenIndex === 0) {
        return;
    }
    activeRun.screenIndex -= 1;
    showCurrentScreen();
}
// Cancel/Esc: abandon the run with nothing posted (same as closing the pre-wizard popover
// without Apply — the next open re-prefills from the server).
function cancelWizardRun() {
    activeRun = undefined;
    getPathsPopover().hidden = true;
    showPopoverFace("paths-summary");
}
// ─── entry points ───
function beginWizardRun(screenNumbers, projectName) {
    activeRun = { screenNumbers, screenIndex: 0, projectName, initialProjectsDir: getInputById("projects-dir-input").value };
    getPathsPopover().hidden = false;
    showCurrentScreen();
}
// "Run full wizard…" / first launch. Without a project the per-project screens 2–5 have no
// entry to edit, so the run is screen 1 only.
export function startFullWizard(projectName) {
    beginWizardRun(projectName === undefined ? [1] : ALL_SCREEN_NUMBERS, projectName);
}
// Project loaded with no reveng-paths entry: screens 2–5 (mockup trigger 1).
export function startProjectWizard(projectName) {
    beginWizardRun(PROJECT_SCREEN_NUMBERS, projectName);
}
// A summary row's [Edit]: the single screen, whose Next is Finish.
export function startSingleScreenEdit(screenNumber, projectName) {
    beginWizardRun([screenNumber], projectName);
}
// First-launch trigger: initializeHeader left the projects-dir input empty only when the
// server reported no configured folder — run the full wizard (app.ts calls this post-boot).
export function maybeStartFirstLaunchWizard() {
    if (getInputById("projects-dir-input").value !== "") {
        return;
    }
    startFullWizard(findRouteProjectName());
}
// ─── finish (the 137-style store prompt: Apply-to-session-only / Store-for-this-project) ───
// Both finish buttons complete the run. This listener registers BEFORE the buttons' onclick
// (postProjectPaths, assigned by refreshProjectPathsSection), so the baseline mirror is
// stored before the POST's collectEntryFromFields reads it.
function completeWizardRun() {
    if (activeRun === undefined) {
        return;
    }
    const run = activeRun;
    activeRun = undefined;
    if (run.screenNumbers.includes(5) && run.projectName !== undefined && getInputById("repo-dir-input").value !== "") {
        storeBaselineChoice(run.projectName, getInputById("wizard-prebaseline-yes").checked ? "1" : "0");
    }
    if (run.screenNumbers.includes(1) && getInputById("projects-dir-input").value !== run.initialProjectsDir) {
        // Reuse the pre-wizard apply button: posts /api/config, clears caches, re-renders.
        document.getElementById("projects-dir-change").click();
    }
    getPathsPopover().hidden = true;
    showPopoverFace("paths-summary");
}
// ─── wiring ───
function findRouteProjectName() {
    const segments = parseRouteSegments();
    return segments[0] === "project" ? segments[1] : undefined;
}
// Every Paths… open resets to the summary face (an abandoned mid-run face never sticks);
// refreshProjectPathsSection re-renders the rows again once its prefill fetch lands.
function handlePathsButtonOpen() {
    if (getPathsPopover().hidden) {
        return; // the click toggled the popover closed
    }
    activeRun = undefined;
    showPopoverFace("paths-summary");
    renderPathsSummary(findRouteProjectName(), startSingleScreenEdit);
}
function syncFileHistoryFieldsToRadios() {
    document.getElementById("file-history-fields").hidden = getInputById("wizard-file-history-auto").checked;
}
function handleCommitPickRadioChange() {
    if (getInputById("wizard-commit-pick").checked) {
        document.getElementById("pick-commit-btn").click(); // task-154 list: 500 newest + filter
    }
}
function handlePopoverKeydown(event) {
    if (event.key === "Escape") {
        cancelWizardRun();
    }
}
export function initializeWizard() {
    document.getElementById("wizard-back").addEventListener("click", retreatWizard);
    document.getElementById("wizard-next").addEventListener("click", advanceWizard);
    document.getElementById("wizard-cancel").addEventListener("click", cancelWizardRun);
    document.getElementById("paths-run-wizard").addEventListener("click", () => startFullWizard(findRouteProjectName()));
    document.getElementById("wizard-set-projects-dir").addEventListener("click", () => void pickFolderInto(getInputById("projects-dir-input")));
    document.getElementById("wizard-set-repo-dir").addEventListener("click", () => void pickFolderInto(getInputById("repo-dir-input")));
    getInputById("wizard-file-history-auto").addEventListener("change", syncFileHistoryFieldsToRadios);
    getInputById("wizard-file-history-custom").addEventListener("change", syncFileHistoryFieldsToRadios);
    getInputById("wizard-commit-pick").addEventListener("change", handleCommitPickRadioChange);
    document.getElementById("project-paths-apply").addEventListener("click", completeWizardRun);
    document.getElementById("project-paths-store").addEventListener("click", completeWizardRun);
    document.getElementById("paths-btn").addEventListener("click", handlePathsButtonOpen);
    getPathsPopover().addEventListener("keydown", handlePopoverKeydown);
}
