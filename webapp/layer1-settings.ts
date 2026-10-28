// Task 297: saved Layer 1 project settings, written on demand, read once at boot.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { readSourcePaths } from "./layer1-source-paths.ts";
import { SourceKind } from "./layer1-wire.ts";

// One saved project; `dir` is its storage key, so projects never collide.
export interface Layer1ProjectSettings {
  dir: string;
  repo: string;
  branch: string;
  ref: string;
  jsonl: string[];
  fileHistory: string[];
  collapsedFolders?: string[];
  hiddenKinds?: string[];
}

let settingsDirty = false;

// Every saved project from the boot GET, so an earlier-visited project needs no second fetch.
let cachedProjectSettings: Record<string, Layer1ProjectSettings> = {};

export function setCachedProjectSettings(projects: Record<string, Layer1ProjectSettings>): void {
  cachedProjectSettings = projects;
}

export function getCollapsedFoldersForProject(dir: string): string[] {
  return cachedProjectSettings[dir]?.collapsedFolders ?? [];
}

function blockSaveFailure(): void {}

// Folder-collapse state auto-saves outside the dirty/Save-button flow: it is navigation state.
export function saveFolderCollapseState(collapsedFolders: string[]): void {
  const dir = getInputById("dir").value.trim();
  if (dir === "") {
    return;
  }
  cachedProjectSettings[dir] = { ...cachedProjectSettings[dir], dir, collapsedFolders } as Layer1ProjectSettings;
  void fetch("/api/layer1-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dir, collapsedFolders }),
  }).catch(blockSaveFailure);
}

export function getHiddenKindsForProject(dir: string): string[] {
  return cachedProjectSettings[dir]?.hiddenKinds ?? [];
}

// Kind-filter state auto-saves on each toggle, like folder collapse: it is view state.
export function saveHiddenKinds(hiddenKinds: string[]): void {
  const dir = getInputById("dir").value.trim();
  if (dir === "") {
    return;
  }
  cachedProjectSettings[dir] = { ...cachedProjectSettings[dir], dir, hiddenKinds } as Layer1ProjectSettings;
  void fetch("/api/layer1-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dir, hiddenKinds }),
  });
}

// The saved record is now stale: arm the button and clear the "saved" note.
export function markSettingsDirty(): void {
  settingsDirty = true;
  (getRequiredElementById("save-settings") as HTMLButtonElement).disabled = false;
  getRequiredElementById("saved-note").textContent = "";
}

// An unpopulated <select> reads "", the right value to save; getInputById would refuse it.
function readSelectValue(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement | null)?.value ?? "";
}

function readCurrentSettings(): Layer1ProjectSettings {
  return {
    dir: getInputById("dir").value.trim(),
    repo: getInputById("repo").value.trim(),
    branch: readSelectValue("branch"),
    ref: getInputById("ref").value.trim(),
    jsonl: [...readSourcePaths(SourceKind.jsonl)],
    fileHistory: [...readSourcePaths(SourceKind.fileHistory)],
  };
}

async function saveSettings(): Promise<void> {
  const note = getRequiredElementById("saved-note");
  const response = await fetch("/api/layer1-settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(readCurrentSettings()),
  });
  // A failed save leaves the button ARMED: nothing was written.
  if (!response.ok) {
    note.textContent = `save failed: ${await response.text()}`;
    return;
  }
  settingsDirty = false;
  (getRequiredElementById("save-settings") as HTMLButtonElement).disabled = true;
  note.textContent = "saved";
}

// The sources-row boxes are part of the saved record, so editing one arms the button.
const DIRTYING_INPUT_IDS = ["dir", "repo", "ref"];
const DIRTYING_SELECT_IDS = ["branch", "commit"];

function triggerSaveSettings(): void {
  void saveSettings();
}

function blockUnloadWhenDirty(event: BeforeUnloadEvent): void {
  if (settingsDirty) {
    event.preventDefault();
  }
}

export function attachSettingsSave(): void {
  getRequiredElementById("save-settings").addEventListener("click", triggerSaveSettings);
  for (const id of DIRTYING_INPUT_IDS) {
    getInputById(id).addEventListener("input", markSettingsDirty);
  }
  for (const id of DIRTYING_SELECT_IDS) {
    document.getElementById(id)?.addEventListener("change", markSettingsDirty);
  }
  window.addEventListener("beforeunload", blockUnloadWhenDirty);
}
