// Tasks 295/296: the source-folder dialog. ONE widget serves both lists — same rules, different title and different array — because the two differ only in what they count (plans/layer1-mockup.html:577-592, 1519-1572).
//
// It edits a COPY: [cancel] drops the draft, [set and close] is what commits and rebuilds. That is what makes a mis-click on [−] recoverable without an undo stack.

import { el, getRequiredElementById } from "./app-dom.ts";
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

function renderPicker(): void {
    const rows = draftPaths.map((path, index) => {
        const row = el("div", { class: index === draftPick ? "picked" : undefined, text: path });
        row.addEventListener("click", () => {
            draftPick = index;
            renderPicker();
        });
        return row;
    });
    getRequiredElementById("pp-list").replaceChildren(
        ...(rows.length > 0 ? rows : [el("div", { class: "mempty", text: "no source folders" })]),
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
function flashEmptyAlert(kind: SourceKind): void {
    const alert = getRequiredElementById("pp-alert");
    alert.textContent = EMPTY_ALERT_BY_KIND[kind];
    alert.hidden = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => { alert.hidden = true; }, ALERT_VISIBLE_MS) as unknown as number;
}

// Does the chosen folder hold what this list is for, at ANY nesting depth? A folder that does not is refused rather than added — a source path that contributes nothing is a lie about the build's inputs. An unreachable server reads as "nothing found", which refuses rather than admits.
async function countFilesUnder(path: string, kind: SourceKind): Promise<number> {
    const query = new URLSearchParams({ path, kind });
    const response = await fetch(`/api/scan-source?${query}`);
    if (!response.ok) {
        return 0;
    }
    return (await response.json() as { found: number }).found;
}

// [+] — the OS folder chooser (GET /api/pick-folder, the existing osascript picker), then the scan.  An empty path is the user cancelling; a path already in the list is a no-op rather than a duplicate row.
async function addPickedFolder(): Promise<void> {
    const response = await fetch(`/api/pick-folder?current=${encodeURIComponent(draftPaths[draftPick] ?? "")}`);
    if (!response.ok) {
        return;
    }
    const { paths } = await response.json() as { paths: string[] };
    let lastAddedIndex = -1;
    for (const path of paths) {
        if (path === "" || draftPaths.includes(path)) {
            continue;
        }
        if (await countFilesUnder(path, draftKind) === 0) {
            flashEmptyAlert(draftKind);
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

// `onChanged` is passed in rather than imported, for the same no-cycle reason wireFolderPickers takes `afterPick`: the only caller is layer1-page.ts's boot, and reaching back for its loadLayer1View would make the two modules circular.
export function wirePathPickers(onChanged: () => void): void {
    getRequiredElementById("pick-jsonl").addEventListener("click", () => openPicker(SourceKind.jsonl));
    getRequiredElementById("pick-fh").addEventListener("click", () => openPicker(SourceKind.fileHistory));
    getRequiredElementById("pp-add").addEventListener("click", () => { void addPickedFolder(); });
    getRequiredElementById("pp-remove").addEventListener("click", removePickedFolder);
    getRequiredElementById("pp-cancel").addEventListener("click", () => {
        getRequiredElementById("pathpicker").hidden = true;
    });
    getRequiredElementById("pp-ok").addEventListener("click", () => {
        const changed = writeSourcePaths(draftKind, draftPaths);
        getRequiredElementById("pathpicker").hidden = true;
        // Only a real edit rebuilds: committing an unchanged list is the same view.
        if (changed) {
            onChanged();
        }
    });
}
