// The Layer 1 header source boxes (?dir=&repo=&ref=) and their folder pickers; reads, seeds and picks only.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { readSourcePaths, writeSourcePaths } from "./layer1-source-paths.ts";
import { CommitTimeSource, SourceKind } from "./layer1-wire.ts";

// Task 312: both source lists travel as repeated params, keeping a Layer 2 view one shareable link.
const LIST_PARAM_BY_KIND = {
  [SourceKind.jsonl]: "jsonl",
  [SourceKind.fileHistory]: "snapshots",
} as const;

// The three header boxes; the ids match layer1.html and the names match the endpoint's params.
const SOURCE_PARAM_IDS = ["dir", "repo", "ref"] as const;

// Which git stamp places a bubble (task 282); derived from the single-sourced CommitTimeSource.
export const TIME_SOURCE_VALUES = Object.values(CommitTimeSource);
let selectedTimeSource: string = TIME_SOURCE_VALUES[0]!;

export function readTimeSource(): string {
  return selectedTimeSource;
}

export function selectTimeSource(value: string): void {
  selectedTimeSource = value;
}

// The header boxes as endpoint/URL params; a blank box contributes nothing.
export function readSourceParams(): URLSearchParams {
  const params = new URLSearchParams();
  for (const id of SOURCE_PARAM_IDS) {
    const value = getInputById(id).value.trim();
    if (value !== "") {
      params.set(id, value);
    }
  }
  // Only the non-default reading is written, so default view URLs stay unchanged.
  if (selectedTimeSource !== TIME_SOURCE_VALUES[0]!) {
    params.set("time", selectedTimeSource);
  }
  // append, never set: both lists are repeatable.
  for (const kind of Object.values(SourceKind)) {
    for (const path of readSourcePaths(kind)) {
      params.append(LIST_PARAM_BY_KIND[kind], path);
    }
  }
  return params;
}

// Seed the boxes from the page URL so ?dir=&repo=&ref= is a working shareable link.
export function fillSourceBoxesFromUrl(): void {
  const params = new URLSearchParams(location.search);
  for (const id of SOURCE_PARAM_IDS) {
    const value = params.get(id);
    if (value !== null) {
      getInputById(id).value = value;
    }
  }
  // An unknown ?time= is ignored: git would not understand it as a stamp name.
  const time = params.get("time");
  if (time !== null) {
    const isKnownTimeSource = (TIME_SOURCE_VALUES as readonly string[]).includes(time);
    if (isKnownTimeSource) {
      selectTimeSource(time);
    }
  }
  // An EMPTY list is never written: writeSourcePaths sets `touched`, killing the derived default.
  for (const kind of Object.values(SourceKind)) {
    const listed = params.getAll(LIST_PARAM_BY_KIND[kind]);
    if (listed.length > 0) {
      writeSourcePaths(kind, listed);
    }
  }
}

// GET /api/pick-folder: an empty path means the user cancelled, so leave the box alone.
async function selectFolderInto(target: HTMLInputElement): Promise<void> {
  const response = await fetch(`/api/pick-folder?current=${encodeURIComponent(target.value)}`);
  if (!response.ok) {
    getRequiredElementById("crumb").textContent = `folder picker failed: ${await response.text()}`;
    return;
  }
  const { path } = await response.json() as { path: string };
  if (path !== "") {
    target.value = path;
  }
}

// Bind each `button.pick` to its `data-for` box; `afterPick` is passed in to avoid a cycle.
export function attachFolderPickers(afterPick: () => void): void {
  for (const button of document.querySelectorAll("button.pick")) {
    const target = getInputById((button as HTMLElement).dataset.for ?? "");
    const selectFolderThenRedraw = (): void => {
      void selectFolderInto(target).then(afterPick);
    };
    button.addEventListener("click", selectFolderThenRedraw);
  }
}
