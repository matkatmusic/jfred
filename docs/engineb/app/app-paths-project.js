// ─── the Paths popover's per-project section (task 137): repo picker + visual commit picker
// + apply/store of the project's reveng-paths.json entry. The projects/file-history fields
// above it are GLOBAL config (app-header.ts); repo/baseCommit/fileHistory are per-project
// overrides, applied to the session on "Apply" and written to reveng-paths.json only on
// "Store" (no silent writes). ───
import { getBaselineChoice, storeBaselineChoice } from "./app-choices.js";
import { el, getInputById } from "./app-dom.js";
import { documentCache, fetchJson, rawLinesCache } from "./app-fetch.js";
import { pickFolderInto, prefillFileHistoryOverrideField } from "./app-header.js";
import { renderPathsSummary } from "./app-paths-summary.js";
import { collectSourceRows, initializeSourcesSection, renderSourceRows } from "./app-paths-sources.js";
import { startProjectWizard, startSingleScreenEdit } from "./app-paths-wizard.js";
import { parseRouteSegments } from "./app-routes.js";
import { renderRoute, resetLastLoadedProject, setBreadcrumb } from "./app-router.js";
// The project the section currently edits (set by refreshProjectPathsSection).
let activeProjectName = "";
// task 154: the rows the last "Pick commit…" fetch returned — the filter box re-renders
// the pick list from these without refetching.
let fetchedCommitRows = [];
// task 159: getInputById moved to app-dom.ts (shared with app-paths-wizard.ts).
// function getInputById(id: string): HTMLInputElement {
//     return document.getElementById(id) as HTMLInputElement;
// }
// task 137: soft warning only — a mismatched repo still applies; the counts tell the user
// whether relative paths actually line up (the s87 cwd-remap contract).
function renderMatchWarning(counts) {
    const warningElement = document.getElementById("commit-match-warning");
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
async function pickCommitRow(hash) {
    getInputById("base-commit-display").value = hash;
    document.getElementById("commit-pick-list").hidden = true;
    getInputById("commit-pick-filter").hidden = true;
    const repo = getInputById("repo-dir-input").value;
    const matchParams = new URLSearchParams({ project: activeProjectName, repo, commit: hash });
    renderMatchWarning(await fetchJson(`/api/repo-commit-match?${matchParams}`));
}
// One pick-list row: short hash, date, subject; clicking it picks the commit.
function buildCommitPickRow(row) {
    return el("div", {
        class: "commit-pick-row",
        text: `${row.hash.slice(0, 8)}  ${row.date}  ${row.subject}`,
        onclick: () => void pickCommitRow(row.hash),
    });
}
// task 154: one commit row matches when the typed text appears in its hash, date, or
// subject (case-insensitive); empty filter text matches every row.
function filterCommitRows(rows, filterText) {
    const needle = filterText.trim().toLowerCase();
    if (needle === "") {
        return rows;
    }
    return rows.filter((row) => `${row.hash} ${row.date} ${row.subject}`.toLowerCase().includes(needle));
}
// Re-render the pick list from the fetched rows through the current filter text (task 154).
function renderCommitPickList() {
    const filterText = getInputById("commit-pick-filter").value;
    const pickList = document.getElementById("commit-pick-list");
    pickList.replaceChildren(...filterCommitRows(fetchedCommitRows, filterText).map(buildCommitPickRow));
}
// "Pick commit…": fetch the repo's commits and show the scrollable pick list plus its
// filter box (task 154), cleared on every open. oninput assignment so repeated opens
// never stack handlers (the file's convention).
async function showCommitPickList() {
    const repo = getInputById("repo-dir-input").value;
    const pickList = document.getElementById("commit-pick-list");
    try {
        fetchedCommitRows = await fetchJson(`/api/repo-commits?repo=${encodeURIComponent(repo)}`);
        const filterInput = getInputById("commit-pick-filter");
        filterInput.value = "";
        filterInput.oninput = renderCommitPickList;
        filterInput.hidden = false;
        renderCommitPickList();
        pickList.hidden = false;
    }
    catch (error) {
        // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
        setBreadcrumb(`could not list commits: ${String(error)}`);
    }
}
// The entry the apply/store buttons post: only non-empty fields ride along. fileHistory rides
// only while the task-136 fields are SHOWN — a visible field is the explicit-override gesture.
function collectEntryFromFields() {
    const entry = {};
    const repo = getInputById("repo-dir-input").value;
    if (repo !== "") {
        entry.repo = repo;
    }
    const baseCommit = getInputById("base-commit-display").value;
    if (baseCommit !== "") {
        entry.baseCommit = baseCommit;
    }
    const fileHistoryFields = document.getElementById("file-history-fields");
    if (!fileHistoryFields.hidden) {
        const fileHistory = getInputById("file-history-dir-input").value;
        if (fileHistory !== "") {
            entry.fileHistory = fileHistory;
        }
    }
    // task 177: only ride the sources list when at least one row qualifies.
    const sources = collectSourceRows();
    if (sources !== undefined) {
        entry.sources = sources;
    }
    // task 159: the wizard screen-5 answer rides from the task-56 mirror, so Store persists it.
    const preBaseline = getBaselineChoice(activeProjectName);
    if (preBaseline !== null) {
        entry.preBaseline = preBaseline;
    }
    return entry;
}
// Apply (persist=false) or Store (persist=true) the entry, then reload the open project so
// the rebuild runs under the new overrides (the folder-switch handler's invalidation).
async function postProjectPaths(persist) {
    // task 159: the Finish face is reachable from a screen-1-only run with no project loaded —
    // there is no entry to post then (the wizard's own listener posts the global config).
    if (activeProjectName === "") {
        return;
    }
    const response = await fetch("/api/project-paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: activeProjectName, entry: collectEntryFromFields(), persist }),
    });
    if (!response.ok) {
        setBreadcrumb(`could not apply project paths: ${(await response.json()).error}`);
        return;
    }
    documentCache.clear();
    rawLinesCache.clear();
    resetLastLoadedProject();
    renderRoute();
}
// Show + wire the section for `projectName` and prefill from the merged entry (stored config
// + session overrides). onclick assignment so repeated refreshes never stack handlers.
// task 159: returns the merged entry (the wizard's no-entry trigger reads it) and re-renders
// the summary panel's rows from the freshly prefilled fields.
export async function refreshProjectPathsSection(projectName) {
    activeProjectName = projectName;
    document.getElementById("project-paths-section").hidden = false;
    document.getElementById("repo-dir-open").onclick = () => void pickFolderInto(getInputById("repo-dir-input"));
    document.getElementById("pick-commit-btn").onclick = () => void showCommitPickList();
    document.getElementById("project-paths-apply").onclick = () => void postProjectPaths(false);
    document.getElementById("project-paths-store").onclick = () => void postProjectPaths(true);
    const entry = await fetchJson(`/api/project-paths?project=${encodeURIComponent(projectName)}`);
    getInputById("repo-dir-input").value = entry.repo ?? "";
    getInputById("base-commit-display").value = entry.baseCommit ?? "";
    // task 153: a stored per-project fileHistory override surfaces in the task-136 field.
    prefillFileHistoryOverrideField(entry.fileHistory);
    // task 177: the Sources section prefills from the merged entry's sources list.
    initializeSourcesSection();
    renderSourceRows(entry.sources ?? []);
    // task 159: a persisted screen-5 answer seeds the task-56 mirror (an unanswered session
    // only — a fresh in-session choice is never clobbered), then the summary rows re-render.
    if (entry.preBaseline !== undefined && getBaselineChoice(projectName) === null) {
        storeBaselineChoice(projectName, entry.preBaseline);
    }
    renderPathsSummary(projectName, startSingleScreenEdit);
    return entry;
}
// True when the merged entry carries ANY stored/overridden value — the wizard only auto-runs
// for a project with no reveng-paths entry at all (mockup trigger 1).
function checkEntryIsConfigured(entry) {
    return entry.repo !== undefined || entry.baseCommit !== undefined || entry.fileHistory !== undefined
        || entry.sources !== undefined || entry.preBaseline !== undefined;
}
// task 159: projects the wizard was already offered to this page-session — no re-nag on
// ordinary project switches back and forth.
const wizardOfferedProjects = new Set();
// Project-load trigger (called from renderRoute on a NEW project load): with no reveng-paths
// entry, open the popover on wizard screens 2–5. Fetch failures stay silent — the load itself
// surfaces them.
export async function maybeOfferProjectPathsWizard(projectName) {
    if (wizardOfferedProjects.has(projectName)) {
        return;
    }
    wizardOfferedProjects.add(projectName);
    try {
        const entry = await refreshProjectPathsSection(projectName);
        if (checkEntryIsConfigured(entry)) {
            return;
        }
        startProjectWizard(projectName);
    }
    catch {
        // no reachable /api/project-paths (or a test stub without it): no wizard offer.
    }
}
// Bootstrap hook: every Paths-popover open re-derives the current project from the route —
// no project open keeps the section hidden.
export function initializeProjectPathsSection() {
    document.getElementById("paths-btn").addEventListener("click", () => {
        const segments = parseRouteSegments();
        if (segments[0] !== "project") {
            document.getElementById("project-paths-section").hidden = true;
            return;
        }
        if (segments[1] === undefined) {
            return;
        }
        void refreshProjectPathsSection(segments[1]);
    });
}
