// Tasks 295/296: source folder lists for JSONL transcripts and file-history snapshots, derived from the project folder until edited.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { SourceKind } from "./layer1-wire.ts";

// The button each list reports its count on, and the URL param each list travels as.
const BUTTON_ID_BY_KIND: Record<SourceKind, string> = {
  [SourceKind.jsonl]: "pick-jsonl",
  [SourceKind.fileHistory]: "pick-fh",
};
const BUTTON_LABEL_BY_KIND: Record<SourceKind, string> = {
  [SourceKind.jsonl]: "JSONL sources",
  [SourceKind.fileHistory]: "File History Snapshots",
};

interface SourceList {
  paths: string[];
  // True once the user sets their own list; false while it is only derived from the project folder.
  touched: boolean;
}

const listsByKind: Record<SourceKind, SourceList> = {
  [SourceKind.jsonl]: { paths: [], touched: false },
  [SourceKind.fileHistory]: { paths: [], touched: false },
};

// The server's two roots from GET /api/config; empty until loadSourceDefaults answers.
let serverProjectsDir = "";
let serverFileHistoryDir = "";

export function readSourcePaths(kind: SourceKind): readonly string[] {
  return listsByKind[kind].paths;
}

// Store a list and report whether it changed, so an unedited picker does not arm Save.
export function writeSourcePaths(kind: SourceKind, paths: string[]): boolean {
  const changed = paths.join("\n") !== listsByKind[kind].paths.join("\n");
  listsByKind[kind] = { paths, touched: true };
  return changed;
}

// Read the server's roots once; on failure the lists stay empty and the user picks by hand.
export async function loadSourceDefaults(): Promise<void> {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }
    const config = await response.json() as { projectsDir?: string; fileHistoryDir?: string };
    serverProjectsDir = config.projectsDir ?? "";
    serverFileHistoryDir = config.fileHistoryDir ?? "";
  }
  catch {
    // Same outcome as a refusal: no defaults, and the page still draws.
  }
}

// Claude Code's project-folder name: every non-alphanumeric character becomes "-", not only "/".
function encodeProjectFolderName(projectFolder: string): string {
  return projectFolder.replace(/[^a-zA-Z0-9]/g, "-");
}

// Where Claude Code keeps a project folder's transcripts, under the server's projects root.
function computeDefaultPaths(kind: SourceKind, projectFolder: string): string[] {
  if (kind === SourceKind.fileHistory) {
    return serverFileHistoryDir === "" ? [] : [serverFileHistoryDir];
  }
  const isProjectsDirMissing = serverProjectsDir === "";
  const isProjectFolderMissing = projectFolder === "";
  const isUnderivable = isProjectsDirMissing || isProjectFolderMissing;
  if (isUnderivable) {
    return [];
  }
  return [`${serverProjectsDir}/${encodeProjectFolderName(projectFolder)}`];
}

// Re-derive each untouched list from the current project folder, then print its size on its button.
export function syncSourceButtons(): void {
  const projectFolder = getInputById("dir").value.trim().replace(/\/$/, "");
  for (const kind of Object.values(SourceKind)) {
    if (!listsByKind[kind].touched) {
      listsByKind[kind].paths = computeDefaultPaths(kind, projectFolder);
    }
    getRequiredElementById(BUTTON_ID_BY_KIND[kind]).textContent =
      `${BUTTON_LABEL_BY_KIND[kind]} (${listsByKind[kind].paths.length})`;
  }
}

// Task 364: the project folder listsByKind currently describes, so a switch to another folder drops the previous project's lists.
let listsProjectFolder: string | undefined = undefined;

export function resetSourcePathsOnProjectChange(): void {
  const projectFolder = getInputById("dir").value.trim().replace(/\/$/, "");
  if (listsProjectFolder === undefined) {
    listsProjectFolder = projectFolder;
    return;
  }
  if (projectFolder === listsProjectFolder) {
    return;
  }
  listsProjectFolder = projectFolder;
  for (const kind of Object.values(SourceKind)) {
    listsByKind[kind] = { paths: [], touched: false };
  }
}
