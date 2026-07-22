// ─── the Paths popover's per-project section (task 137): repo picker + visual commit picker
// + apply/store of the project's reveng-paths.json entry. The projects/file-history fields
// above it are GLOBAL config (app-header.ts); repo/baseCommit/fileHistory are per-project
// overrides, applied to the session on "Apply" and written to reveng-paths.json only on
// "Store" (no silent writes). ───

import { el } from "./app-dom.ts";
import { documentCache, fetchJson, rawLinesCache } from "./app-fetch.ts";
import { pickFolderInto, prefillFileHistoryOverrideField } from "./app-header.ts";
import { parseRouteSegments } from "./app-routes.ts";
import { renderRoute, resetLastLoadedProject, setBreadcrumb } from "./app-router.ts";

// One project's reveng-paths.json entry on the wire (WireProjectPaths server-side).
type WireProjectPathsEntry = { cwd?: string; repo?: string; baseCommit?: string; fileHistory?: string };

// The /api/repo-commits rows and the /api/repo-commit-match counts.
type WireRepoCommitRow = { hash: string; date: string; subject: string };
type WireCommitMatch = { matchedCount: number; totalCount: number };

// The project the section currently edits (set by refreshProjectPathsSection).
let activeProjectName = "";

// task 154: the rows the last "Pick commit…" fetch returned — the filter box re-renders
// the pick list from these without refetching.
let fetchedCommitRows: WireRepoCommitRow[] = [];

function getInputById(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}

// task 137: soft warning only — a mismatched repo still applies; the counts tell the user
// whether relative paths actually line up (the s87 cwd-remap contract).
function renderMatchWarning(counts: WireCommitMatch): void {
    const warningElement = document.getElementById("commit-match-warning")!;
    if (counts.totalCount === 0) {
        warningElement.textContent = "";
        return;
    }
    if (counts.matchedCount * 2 >= counts.totalCount) {
        warningElement.textContent = "";
        return;
    }
    warningElement.textContent = `⚠ only ${counts.matchedCount} of ${counts.totalCount} recorded file paths exist in this commit's tree — is this the right repo/commit?`;
}

// Picking a row fills the base-commit field with the FULL hash, hides the list, and fetches
// the path-match counts for the soft warning.
async function pickCommitRow(hash: string): Promise<void> {
    getInputById("base-commit-display").value = hash;
    document.getElementById("commit-pick-list")!.hidden = true;
    getInputById("commit-pick-filter").hidden = true;
    const repo = getInputById("repo-dir-input").value;
    const matchParams = new URLSearchParams({ project: activeProjectName, repo, commit: hash });
    renderMatchWarning(await fetchJson<WireCommitMatch>(`/api/repo-commit-match?${matchParams}`));
}

// One pick-list row: short hash, date, subject; clicking it picks the commit.
function buildCommitPickRow(row: WireRepoCommitRow): HTMLElement {
    return el("div", {
        class: "commit-pick-row",
        text: `${row.hash.slice(0, 8)}  ${row.date}  ${row.subject}`,
        onclick: () => void pickCommitRow(row.hash),
    });
}

// task 154: one commit row matches when the typed text appears in its hash, date, or
// subject (case-insensitive); empty filter text matches every row.
function filterCommitRows(rows: WireRepoCommitRow[], filterText: string): WireRepoCommitRow[] {
    const needle = filterText.trim().toLowerCase();
    if (needle === "") {
        return rows;
    }
    return rows.filter((row) => `${row.hash} ${row.date} ${row.subject}`.toLowerCase().includes(needle));
}

// Re-render the pick list from the fetched rows through the current filter text (task 154).
function renderCommitPickList(): void {
    const filterText = getInputById("commit-pick-filter").value;
    const pickList = document.getElementById("commit-pick-list")!;
    pickList.replaceChildren(...filterCommitRows(fetchedCommitRows, filterText).map(buildCommitPickRow));
}

// "Pick commit…": fetch the repo's commits and show the scrollable pick list plus its
// filter box (task 154), cleared on every open. oninput assignment so repeated opens
// never stack handlers (the file's convention).
async function showCommitPickList(): Promise<void> {
    const repo = getInputById("repo-dir-input").value;
    const pickList = document.getElementById("commit-pick-list")!;
    try {
        fetchedCommitRows = await fetchJson<WireRepoCommitRow[]>(`/api/repo-commits?repo=${encodeURIComponent(repo)}`);
        const filterInput = getInputById("commit-pick-filter");
        filterInput.value = "";
        filterInput.oninput = renderCommitPickList;
        filterInput.hidden = false;
        renderCommitPickList();
        pickList.hidden = false;
    } catch (error) {
        // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
        setBreadcrumb(`could not list commits: ${String(error)}`);
    }
}

// The entry the apply/store buttons post: only non-empty fields ride along. fileHistory rides
// only while the task-136 fields are SHOWN — a visible field is the explicit-override gesture.
function collectEntryFromFields(): WireProjectPathsEntry {
    const entry: WireProjectPathsEntry = {};
    const repo = getInputById("repo-dir-input").value;
    if (repo !== "") {
        entry.repo = repo;
    }
    const baseCommit = getInputById("base-commit-display").value;
    if (baseCommit !== "") {
        entry.baseCommit = baseCommit;
    }
    const fileHistoryFields = document.getElementById("file-history-fields")!;
    if (!fileHistoryFields.hidden) {
        const fileHistory = getInputById("file-history-dir-input").value;
        if (fileHistory !== "") {
            entry.fileHistory = fileHistory;
        }
    }
    return entry;
}

// Apply (persist=false) or Store (persist=true) the entry, then reload the open project so
// the rebuild runs under the new overrides (the folder-switch handler's invalidation).
async function postProjectPaths(persist: boolean): Promise<void> {
    const response = await fetch("/api/project-paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: activeProjectName, entry: collectEntryFromFields(), persist }),
    });
    if (!response.ok) {
        setBreadcrumb(`could not apply project paths: ${(await response.json() as { error: string }).error}`);
        return;
    }
    documentCache.clear();
    rawLinesCache.clear();
    resetLastLoadedProject();
    renderRoute();
}

// Show + wire the section for `projectName` and prefill from the merged entry (stored config
// + session overrides). onclick assignment so repeated refreshes never stack handlers.
export async function refreshProjectPathsSection(projectName: string): Promise<void> {
    activeProjectName = projectName;
    document.getElementById("project-paths-section")!.hidden = false;
    (document.getElementById("repo-dir-open") as HTMLButtonElement).onclick = () => void pickFolderInto(getInputById("repo-dir-input"));
    (document.getElementById("pick-commit-btn") as HTMLButtonElement).onclick = () => void showCommitPickList();
    (document.getElementById("project-paths-apply") as HTMLButtonElement).onclick = () => void postProjectPaths(false);
    (document.getElementById("project-paths-store") as HTMLButtonElement).onclick = () => void postProjectPaths(true);
    const entry = await fetchJson<WireProjectPathsEntry>(`/api/project-paths?project=${encodeURIComponent(projectName)}`);
    getInputById("repo-dir-input").value = entry.repo ?? "";
    getInputById("base-commit-display").value = entry.baseCommit ?? "";
    // task 153: a stored per-project fileHistory override surfaces in the task-136 field.
    prefillFileHistoryOverrideField(entry.fileHistory);
}

// Bootstrap hook: every Paths-popover open re-derives the current project from the route —
// no project open keeps the section hidden.
export function initializeProjectPathsSection(): void {
    document.getElementById("paths-btn")!.addEventListener("click", () => {
        const segments = parseRouteSegments();
        if (segments[0] !== "project") {
            document.getElementById("project-paths-section")!.hidden = true;
            return;
        }
        if (segments[1] === undefined) {
            return;
        }
        void refreshProjectPathsSection(segments[1]);
    });
}
