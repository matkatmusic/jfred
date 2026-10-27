// ─── task 159: the Paths wizard's popover faces and per-screen prefill (state-free half of app-paths-wizard.ts).

import { getInputById } from "./app-dom.ts";
import { pickFolderInto } from "./app-header.ts";
import { resolveDefaultCommitLabel } from "./app-paths-summary.ts";
import { parseRouteSegments } from "./app-routes.ts";

// The popover faces the state machine swaps between (one visible at a time).
const FACE_ELEMENT_IDS = [
  "paths-summary", "wizard-screen-1", "wizard-screen-2", "wizard-screen-3",
  "wizard-screen-4", "wizard-screen-5", "wizard-finish",
];

export function getPathsPopover(): HTMLElement {
  return document.getElementById("paths-popover")!;
}

export function selectPopoverFace(faceId: string): void {
  for (const id of FACE_ELEMENT_IDS) {
    document.getElementById(id)!.hidden = id !== faceId;
  }
  document.getElementById("wizard-nav")!.hidden = !faceId.startsWith("wizard-screen-");
}

export function findRouteProjectName(): string | undefined {
  const segments = parseRouteSegments();
  return segments[0] === "project" ? segments[1] : undefined;
}

// ─── per-screen prefill (every screen prefills the stored/derived current value) ───

// Screen 2: the task-136 fields' visibility IS the auto-derive/custom state.
function fillFileHistoryScreen(): void {
  // lib.dom types `hidden` as string | boolean (the "until-found" value); ours is boolean.
  const fieldsHidden = document.getElementById("file-history-fields")!.hidden !== false;
  getInputById("wizard-file-history-auto").checked = fieldsHidden;
  getInputById("wizard-file-history-custom").checked = !fieldsHidden;
}

// Screen 3: a non-empty repo field means "yes".
function fillRepoScreen(): void {
  const hasRepo = getInputById("repo-dir-input").value !== "";
  getInputById("wizard-repo-yes").checked = hasRepo;
  getInputById("wizard-repo-no").checked = !hasRepo;
}

// Screen 4: a stored base commit preselects "Pick one"; the default label resolves async.
function fillCommitScreen(projectName: string | undefined): void {
  const hasStored = getInputById("base-commit-display").value !== "";
  getInputById("wizard-commit-pick").checked = hasStored;
  getInputById("wizard-commit-default").checked = !hasStored;
  const label = document.getElementById("wizard-commit-default-label")!;
  label.textContent = "Default: resolving…";
  function writeResolvedLabel(text: string): void {
    label.textContent = text;
  }
  function writeUnreadableLabel(): void {
    label.textContent = "Default: (repo unreadable)";
  }
  const labelPromise = resolveDefaultCommitLabel(projectName);
  const resolvedPromise = labelPromise.then(writeResolvedLabel);
  resolvedPromise.catch(writeUnreadableLabel);
}

// Screen 5 needs no fill: the DOM default "No" stands.
export function fillScreen(screenNumber: number, projectName: string | undefined): void {
  if (screenNumber === 2)
    fillFileHistoryScreen();
  if (screenNumber === 3)
    fillRepoScreen();
  if (screenNumber === 4)
    fillCommitScreen(projectName);
}

// Screen 3 answered "no": drop the repo AND the base commit.
export function clearRepoFields(): void {
  getInputById("repo-dir-input").value = "";
  getInputById("base-commit-display").value = "";
}

// ─── state-free listeners ───

export function syncFileHistoryFieldsToRadios(): void {
  document.getElementById("file-history-fields")!.hidden = getInputById("wizard-file-history-auto").checked;
}

export function triggerCommitPicker(): void {
  const isPickChecked = getInputById("wizard-commit-pick").checked;
  if (isPickChecked) {
    document.getElementById("pick-commit-btn")!.click();   // task-154 list: 500 newest + filter
  }
}

export function selectProjectsDir(): void {
  void pickFolderInto(getInputById("projects-dir-input"));
}

export function selectRepoDir(): void {
  void pickFolderInto(getInputById("repo-dir-input"));
}
