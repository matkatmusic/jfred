// Tasks 295/296: the two lists of source folders the Layer 1 page reads from — the JSONL transcripts and the file-history snapshots. State only; webapp/layer1-path-picker.ts owns the dialog that edits them and webapp/layer1-page.ts owns when they are re-read.
//
// A project folder IMPLIES where its transcripts and snapshots normally live, and that derived folder is what a first-time list holds. `touched` is what stops a re-derive from throwing away a list the user has since edited (plans/layer1-mockup.html:1495-1512).

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
    // False while the list is still whatever the project folder derives; true once the user has committed a list of their own, from the picker, the URL or the saved settings.
    touched: boolean;
}

const listsByKind: Record<SourceKind, SourceList> = {
    [SourceKind.jsonl]: { paths: [], touched: false },
    [SourceKind.fileHistory]: { paths: [], touched: false },
};

// The server's own two roots, from GET /api/config. Empty until seedSourceDefaults answers — the real page's stand-in for the mockup's hardcoded deriveFor.
let serverProjectsDir = "";
let serverFileHistoryDir = "";

export function readSourcePaths(kind: SourceKind): readonly string[] {
    return listsByKind[kind].paths;
}

// Store a list and report whether it actually changed, so a picker that was opened and closed without an edit does not arm the Save button.
export function writeSourcePaths(kind: SourceKind, paths: string[]): boolean {
    const changed = paths.join("\n") !== listsByKind[kind].paths.join("\n");
    listsByKind[kind] = { paths, touched: true };
    return changed;
}

// Read the server's roots ONCE, so the derived defaults below are real paths rather than guesses.  A failure is not fatal: the lists stay empty, the buttons print (0), and the user can still pick folders by hand.
export async function seedSourceDefaults(): Promise<void> {
    try {
        const response = await fetch("/api/config");
        if (!response.ok) {
            return;
        }
        const config = await response.json() as { projectsDir?: string; fileHistoryDir?: string };
        serverProjectsDir = config.projectsDir ?? "";
        serverFileHistoryDir = config.fileHistoryDir ?? "";
    } catch {
        // Same outcome as a refusal: no defaults, and the page still draws.
    }
}

// Claude Code's own project-folder name for a working directory: EVERY non-alphanumeric character becomes "-", not just the separators. Verified against all 42 folders under ~/.claude/projects by re-deriving each from the `cwd` its own transcripts record — 42 matches, 0 misses. A "/"-only rule is what left the spaces in "claude code src" intact and named a folder that does not exist.
function encodeProjectFolderName(projectFolder: string): string {
    return projectFolder.replace(/[^a-zA-Z0-9]/g, "-");
}

// Where Claude Code keeps a project folder's transcripts, under the server's projects root.
function deriveDefaultPaths(kind: SourceKind, projectFolder: string): string[] {
    if (kind === SourceKind.fileHistory) {
        return serverFileHistoryDir === "" ? [] : [serverFileHistoryDir];
    }
    if (serverProjectsDir === "" || projectFolder === "") {
        return [];
    }
    return [`${serverProjectsDir}/${encodeProjectFolderName(projectFolder)}`];
}

// Re-derive every untouched list from the CURRENT project folder, then print each list's size on its button — so a new project folder brings its own defaults with it and both counts are legible without the dialog having to be opened.
export function syncSourceButtons(): void {
    const projectFolder = getInputById("dir").value.trim().replace(/\/$/, "");
    for (const kind of Object.values(SourceKind)) {
        if (!listsByKind[kind].touched) {
            listsByKind[kind].paths = deriveDefaultPaths(kind, projectFolder);
        }
        getRequiredElementById(BUTTON_ID_BY_KIND[kind]).textContent =
            `${BUTTON_LABEL_BY_KIND[kind]} (${listsByKind[kind].paths.length})`;
    }
}
