// Tasks 295/296: one source-folder dialog serves both lists; it edits a COPY, so [cancel] drops the draft.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { readSourcePaths, writeSourcePaths } from "./layer1-source-paths.ts";
import { SourceKind } from "./layer1-wire.ts";

const PICKER_TITLE_BY_KIND: Record<SourceKind, string> = {
  [SourceKind.jsonl]: "JSONL Source Paths",
  [SourceKind.fileHistory]: "File History Snapshot Paths",
};
// What the folder held none of, named per kind so the message matches the list.
const EMPTY_ALERT_BY_KIND: Record<SourceKind, string> = {
  [SourceKind.jsonl]: "no JSONL files found",
  [SourceKind.fileHistory]: "no snapshots found",
};
const ALERT_VISIBLE_MS = 2600;

let draftKind: SourceKind = SourceKind.jsonl;
let draftPaths: string[] = [];
// -1 = nothing selected, which is also what disables [−].
let draftPick = -1;
let alertTimer = 0;

function createRowPicker(index: number): () => void {
  return () => {
    draftPick = index;
    renderPicker();
  };
}

function renderPicker(): void {
  const rows: HTMLElement[] = [];
  for (const [index, path] of draftPaths.entries()) {
    const row = createElement("div", { class: index === draftPick ? "picked" : undefined, text: path });
    row.addEventListener("click", createRowPicker(index));
    rows.push(row);
  }
  getRequiredElementById("pp-list").replaceChildren(
    ...(rows.length > 0 ? rows : [createElement("div", { class: "mempty", text: "no source folders" })]),
  );
  (getRequiredElementById("pp-remove") as HTMLButtonElement).disabled = draftPick < 0;
}

export function openPicker(kind: SourceKind): void {
  draftKind = kind;
  draftPaths = [...readSourcePaths(kind)];
  draftPick = -1;
  getRequiredElementById("pp-title").textContent = PICKER_TITLE_BY_KIND[kind];
  // A warning about the LAST list is not about this one.
  getRequiredElementById("pp-alert").hidden = true;
  getRequiredElementById("pathpicker").hidden = false;
  renderPicker();
}

// Shown briefly above the list, then auto-clears — the folder is refused, not the user.
function hidePickerAlert(): void {
  getRequiredElementById("pp-alert").hidden = true;
}

function reportEmptyFolder(kind: SourceKind): void {
  const alert = getRequiredElementById("pp-alert");
  alert.textContent = EMPTY_ALERT_BY_KIND[kind];
  alert.hidden = false;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(hidePickerAlert, ALERT_VISIBLE_MS) as unknown as number;
}

// Count the files this list wants at ANY depth; zero refuses the folder, as does an unreachable server.
async function countFilesUnder(path: string, kind: SourceKind): Promise<number> {
  const query = new URLSearchParams({ path, kind });
  const response = await fetch(`/api/scan-source?${query}`);
  if (!response.ok) {
    return 0;
  }
  return (await response.json() as { found: number }).found;
}

// [+] opens the OS folder chooser, then scans; an empty or known path is skipped.
async function addPickedFolder(): Promise<void> {
  const response = await fetch(`/api/pick-folder?current=${encodeURIComponent(draftPaths[draftPick] ?? "")}`);
  if (!response.ok) {
    return;
  }
  const { paths } = await response.json() as { paths: string[] };
  let lastAddedIndex = -1;
  for (const path of paths) {
    const isSkipped = path === "" || draftPaths.includes(path);
    if (isSkipped) {
      continue;
    }
    const fileCount = await countFilesUnder(path, draftKind);
    if (fileCount === 0) {
      reportEmptyFolder(draftKind);
      continue;
    }
    draftPaths.push(path);
    lastAddedIndex = draftPaths.length - 1;
  }
  if (lastAddedIndex >= 0) {
    draftPick = lastAddedIndex;
    renderPicker();
  }
}

function removePickedFolder(): void {
  if (draftPick < 0) {
    return;
  }
  draftPaths.splice(draftPick, 1);
  draftPick = Math.min(draftPick, draftPaths.length - 1);
  renderPicker();
}

// `onChanged` is passed in, not imported from layer1-page.ts, because an import would make the modules circular.
function openJsonlPicker(): void {
  openPicker(SourceKind.jsonl);
}

function openFileHistoryPicker(): void {
  openPicker(SourceKind.fileHistory);
}

function triggerAddPickedFolder(): void {
  void addPickedFolder();
}

function hidePicker(): void {
  getRequiredElementById("pathpicker").hidden = true;
}

function createPickerCommitter(onChanged: () => void): () => void {
  return () => {
    const changed = writeSourcePaths(draftKind, draftPaths);
    hidePicker();
    // Only a real edit rebuilds: committing an unchanged list is the same view.
    if (changed) {
      onChanged();
    }
  };
}

export function registerPathPickers(onChanged: () => void): void {
  getRequiredElementById("pick-jsonl").addEventListener("click", openJsonlPicker);
  getRequiredElementById("pick-fh").addEventListener("click", openFileHistoryPicker);
  getRequiredElementById("pp-add").addEventListener("click", triggerAddPickedFolder);
  getRequiredElementById("pp-remove").addEventListener("click", removePickedFolder);
  getRequiredElementById("pp-cancel").addEventListener("click", hidePicker);
  getRequiredElementById("pp-ok").addEventListener("click", createPickerCommitter(onChanged));
}
