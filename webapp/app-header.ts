// Runtime-switchable folders (item 46), split from app-router.ts (task 115); header depends on router.

import { reconcileServerBootId } from "./app-choices.ts";
import { documentCache, fetchJson, rawLinesCache } from "./app-fetch.ts";
import { initToolbarPopovers } from "./app-header-popovers.ts";
import { renderRoute, resetLastLoadedProject, setBreadcrumb } from "./app-router.ts";

// The /api/config payload as plain strings; bootId stamps the server launch (item 82).
type WireConfig = { projectsDir: string; fileHistoryDir: string; bootId: string };

// Native folder picker fills the input; empty path means cancelled. Reused by app-paths-project.ts.
export async function selectFolderInto(target: HTMLInputElement): Promise<void> {
  const response = await fetch(`/api/pick-folder?current=${encodeURIComponent(target.value)}`);
  if (!response.ok) {
    // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
    setBreadcrumb(`folder picker failed: ${await response.text()}`);
    return;
  }
  const { path } = await response.json() as { path: string };
  if (path !== "") {
    target.value = path;
  }
}

// Last server-reported file-history dir; an unedited field posts "" so the server re-derives (item 46).
let reportedFileHistoryDir = "";

// task 153: the prefilled per-project override ("" = none); treated as unedited when posting.
let prefilledProjectOverrideDir = "";

// task 153: show a stored per-project override on popover open; never clobber a manual override.
export function fillFileHistoryOverrideField(overrideDir: string | undefined): void {
  const fileHistoryFields = document.getElementById("file-history-fields")!;
  const fileHistoryInput = document.getElementById("file-history-dir-input") as HTMLInputElement;
  if (overrideDir !== undefined) {
    fileHistoryFields.hidden = false;
    fileHistoryInput.value = overrideDir;
    prefilledProjectOverrideDir = overrideDir;
    return;
  }
  if (prefilledProjectOverrideDir === "") {
    return;
  }
  fileHistoryFields.hidden = true;
  fileHistoryInput.value = reportedFileHistoryDir;
  prefilledProjectOverrideDir = "";
}

// task 136: the file-history field hides behind a toggle; showing it is the explicit-override gesture.
function toggleFileHistoryFields(): void {
  const fileHistoryFields = document.getElementById("file-history-fields")!;
  fileHistoryFields.hidden = !fileHistoryFields.hidden;
}

function applyConfig(config: WireConfig): void {
  const input = document.getElementById("projects-dir-input") as HTMLInputElement;
  const fileHistoryInput = document.getElementById("file-history-dir-input") as HTMLInputElement;
  input.value = config.projectsDir;
  fileHistoryInput.value = config.fileHistoryDir;
  reportedFileHistoryDir = config.fileHistoryDir;
}

// task 136: hidden file-history fields mean the dir is derived, so post "" (item 46).
function computeFileHistoryDirToPost(): string {
  const fileHistoryFields = document.getElementById("file-history-fields")!;
  const fileHistoryInput = document.getElementById("file-history-dir-input") as HTMLInputElement;
  if (fileHistoryFields.hidden) {
    return "";
  }
  if (fileHistoryInput.value === reportedFileHistoryDir) {
    return "";
  }
  // task 153: an unedited prefilled per-project override is not a global-override gesture.
  if (fileHistoryInput.value === prefilledProjectOverrideDir) {
    return "";
  }
  return fileHistoryInput.value;
}

async function sendConfigChange(): Promise<void> {
  const input = document.getElementById("projects-dir-input") as HTMLInputElement;
  const fileHistoryDir = computeFileHistoryDirToPost();
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectsDir: input.value, fileHistoryDir }),
  });
  if (!response.ok) {
    // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
    setBreadcrumb(`could not switch folder: ${(await response.json()).error}`);
    return;
  }
  // The server echoes the effective dirs; the file-history field takes the newly derived value.
  applyConfig(await response.json() as WireConfig);
  documentCache.clear();
  rawLinesCache.clear();
  // Every project is a fresh load from the new folder, even under an identical name.
  resetLastLoadedProject();
  location.hash = "#/";
  renderRoute();
}

function selectProjectsFolder(): void {
  void selectFolderInto(document.getElementById("projects-dir-input") as HTMLInputElement);
}

function selectFileHistoryFolder(): void {
  void selectFolderInto(document.getElementById("file-history-dir-input") as HTMLInputElement);
}

export async function initHeader(): Promise<void> {
  initToolbarPopovers();
  document.getElementById("file-history-toggle")!.addEventListener("click", toggleFileHistoryFields);
  const config = await fetchJson<WireConfig>("/api/config");
  // Runs before the first renderRoute, so a relaunched server drops stale consent choices (item 82).
  reconcileServerBootId(config.bootId);
  applyConfig(config);
  document.getElementById("projects-dir-change")!.addEventListener("click", sendConfigChange);
  document.getElementById("projects-dir-open")!.addEventListener("click", selectProjectsFolder);
  document.getElementById("file-history-dir-open")!.addEventListener("click", selectFileHistoryFolder);
}
