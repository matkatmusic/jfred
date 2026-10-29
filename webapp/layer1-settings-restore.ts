// Task 297: fill the Layer 1 page from the saved project file or the debugConfig defaults.

import { getInputById } from "./app-dom.ts";
import { type Layer1ProjectSettings, setCachedProjectSettings } from "./layer1-settings.ts";
import { writeSourcePaths } from "./layer1-source-paths.ts";
import { SourceKind } from "./layer1-wire.ts";

// The URL wins for the fields it names; an absent value leaves the box alone.
function fillBoxUnlessUrlNamesIt(url: URLSearchParams, id: string, value: string | undefined): void {
  const urlNamesBox = url.has(id);
  const hasValue = value !== undefined;
  const shouldFill = hasValue && !urlNamesBox;
  if (shouldFill) {
    getInputById(id).value = value;
  }
}

// Fill the page from the saved project or config defaults, per field; report whether anything filled.
export async function loadSavedSettings(): Promise<boolean> {
  const url = new URLSearchParams(location.search);
  const response = await fetch("/api/layer1-settings");
  if (!response.ok) {
    return false;
  }
  const saved = await response.json() as {
    lastDir?: string | null;
    projects?: Record<string, Layer1ProjectSettings>;
    defaults?: Partial<Layer1ProjectSettings>;
  };
  setCachedProjectSettings(saved.projects ?? {});
  // A saved project beats the config defaults; each field falls back independently.
  const project = saved.lastDir == null ? undefined : saved.projects?.[saved.lastDir];
  const chosen = project ?? saved.defaults;
  if (chosen === undefined) {
    return false;
  }
  fillBoxUnlessUrlNamesIt(url, "dir", chosen.dir);
  fillBoxUnlessUrlNamesIt(url, "repo", chosen.repo);
  fillBoxUnlessUrlNamesIt(url, "ref", chosen.ref);
  // A restored list is deliberate: it must NOT be re-derived from the project folder (`touched`).
  const savedJsonl = chosen.jsonl;
  const savedFileHistory = chosen.fileHistory;
  const urlNamesJsonl = url.has("jsonl");
  const urlNamesSnapshots = url.has("snapshots");
  const shouldWriteJsonl = savedJsonl !== undefined && !urlNamesJsonl;
  const shouldWriteFileHistory = savedFileHistory !== undefined && !urlNamesSnapshots;
  if (shouldWriteJsonl) {
    writeSourcePaths(SourceKind.jsonl, [...savedJsonl]);
  }
  if (shouldWriteFileHistory) {
    writeSourcePaths(SourceKind.fileHistory, [...savedFileHistory]);
  }
  return true;
}

// Task 366: apply the saved settings for the project #dir now names, keyed by #dir not lastDir.
export async function applySavedSettingsForCurrentDir(): Promise<void> {
  const dir = getInputById("dir").value.trim();
  if (dir === "") {
    return;
  }
  const response = await fetch("/api/layer1-settings");
  if (!response.ok) {
    return;
  }
  const saved = await response.json() as {
    projects?: Record<string, Layer1ProjectSettings>;
  };
  setCachedProjectSettings(saved.projects ?? {});
  const project = saved.projects?.[dir];
  if (project === undefined) {
    return;
  }
  if (project.repo !== undefined) {
    getInputById("repo").value = project.repo;
  }
  if (project.ref !== undefined) {
    getInputById("ref").value = project.ref;
  }
  if (project.jsonl !== undefined) {
    writeSourcePaths(SourceKind.jsonl, [...project.jsonl]);
  }
  if (project.fileHistory !== undefined) {
    writeSourcePaths(SourceKind.fileHistory, [...project.fileHistory]);
  }
}
