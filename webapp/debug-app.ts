// Debug viewer: lists files, deep-links each one, and renders the selected file's revision ladder.

import { createElement, getRequiredElementById } from "./app-dom.ts";

// The page's own path — every deep link routes back here.
const DEBUG_PAGE_PATH = "/app/debug.html";

// Set the one-line status text.
export function renderDebugStatus(text: string): void {
  getRequiredElementById("debug-status").textContent = text;
}

// One deep-link anchor per file, replacing the previous listing.
export function renderDebugFileList(projectName: string, files: string[]): void {
  const rows: HTMLElement[] = [];
  for (const file of files) {
    const href = `${DEBUG_PAGE_PATH}?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(file)}`;
    const anchor = createElement("a", { href, text: file });
    rows.push(createElement("div", {}, [anchor]));
  }
  getRequiredElementById("debug-file-list").replaceChildren(...rows);
}

// Fetch the project's pickable final paths and list them as deep links.
async function loadFileList(projectName: string): Promise<void> {
  const response = await fetch(`/api/file-ladder?project=${encodeURIComponent(projectName)}`);
  if (!response.ok) {
    renderDebugStatus(`file list failed: ${await response.text()}`);
    return;
  }
  const listing = await response.json() as { files: string[] };
  renderDebugFileList(projectName, listing.files);
  renderDebugStatus("select a file to load its revision ladder");
}

// Wire form of one file's ladder: plain strings and ISO text, not the engine's FileHistory.
interface WireFileRevision {
  kind: string;
  changeId: string;
  timestamp: string;
  unrecoverable?: { reason: string };
}

interface WireFileLadder {
  target: string;
  revisions: WireFileRevision[];
}

// A `gitBase:<hash>:<target>` changeId marks a base-commit seed; other changeIds have no seed.
const SEED_CHANGE_ID_PREFIX = "gitBase:";

function extractSeedHash(changeId: string): string | undefined {
  const isSeedChangeId = changeId.startsWith(SEED_CHANGE_ID_PREFIX);
  if (!isSeedChangeId) {
    return undefined;
  }
  return changeId.slice(SEED_CHANGE_ID_PREFIX.length).split(":")[0];
}

// Definition rows for one revision: source and time always, seed and conflict only when present.
function buildRevisionRows(revision: WireFileRevision): (Node | string)[] {
  const rows: (Node | string)[] = [
    createElement("dt", { text: "source" }),
    createElement("dd", { class: "debug-source", text: `${revision.kind} (${revision.changeId})` }),
    createElement("dt", { text: "time" }),
    createElement("dd", { class: "debug-time", text: revision.timestamp }),
  ];
  const seedHash = extractSeedHash(revision.changeId);
  if (seedHash !== undefined) {
    rows.push(createElement("dt", { text: "seed" }), createElement("dd", { class: "debug-seed", text: seedHash }));
  }
  if (revision.unrecoverable !== undefined) {
    rows.push(createElement("dt", { text: "conflict" }), createElement("dd", { class: "debug-conflict", text: revision.unrecoverable.reason }));
  }
  return rows;
}

// Render the ladder as an ordered list, replacing any previous ladder.
export function renderDebugLadder(ladder: WireFileLadder): void {
  const items: HTMLElement[] = [];
  for (const revision of ladder.revisions) {
    const definitionList = createElement("dl", {}, buildRevisionRows(revision));
    items.push(createElement("li", {}, [definitionList]));
  }
  getRequiredElementById("debug-ladder").replaceChildren(...items);
}

// Fetch one file's revision ladder and render it.
async function loadLadder(projectName: string, file: string): Promise<void> {
  const response = await fetch(`/api/file-ladder?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(file)}`);
  if (!response.ok) {
    renderDebugStatus(`ladder failed: ${await response.text()}`);
    return;
  }
  const ladder = await response.json() as WireFileLadder;
  renderDebugLadder(ladder);
  renderDebugStatus(`${file}: ${ladder.revisions.length} revision(s) loaded`);
}

// Start for three URL shapes: no project, project only, project plus file.
export async function initDebugApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const projectName = params.get("project");
  if (projectName === null) {
    renderDebugStatus(`no project selected — open ${DEBUG_PAGE_PATH}?project=<name>`);
    return;
  }
  const file = params.get("file");
  if (file === null) {
    await loadFileList(projectName);
    return;
  }
  await loadLadder(projectName, file);
}

void initDebugApp();
