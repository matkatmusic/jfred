// Per-project Paths popover: the "Pick commit…" list, its filter box, and the path-match warning.

import { createElement, getInputById } from "./app-dom.ts";
import { fetchJson } from "./app-fetch.ts";
import { setBreadcrumb } from "./app-router.ts";

// The /api/repo-commits rows and the /api/repo-commit-match counts.
type WireRepoCommitRow = { hash: string; date: string; subject: string };
type WireCommitMatch = { matchedCount: number; totalCount: number };

// The project whose pick list is open (set by openCommitPickList).
let commitPickProjectName = "";

// task 154: cached commit rows for client-side filter without refetch.
let fetchedCommitRows: WireRepoCommitRow[] = [];

// task 137: soft warning only; a mismatched repo still applies.
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

// Picking a row fills the base-commit field, hides the list, and renders the match warning.
async function selectCommitRow(hash: string): Promise<void> {
  getInputById("base-commit-display").value = hash;
  document.getElementById("commit-pick-list")!.hidden = true;
  getInputById("commit-pick-filter").hidden = true;
  const repo = getInputById("repo-dir-input").value;
  const matchParams = new URLSearchParams({ project: commitPickProjectName, repo, commit: hash });
  renderMatchWarning(await fetchJson<WireCommitMatch>(`/api/repo-commit-match?${matchParams}`));
}

// One pick-list row: short hash, date, subject; clicking it picks the commit.
function buildCommitPickRow(row: WireRepoCommitRow): HTMLElement {
  return createElement("div", {
    class: "commit-pick-row",
    text: `${row.hash.slice(0, 8)}  ${row.date}  ${row.subject}`,
    onclick: () => void selectCommitRow(row.hash),
  });
}

// task 154: a row matches when its hash, date, or subject contains the filter text.
function filterCommitRows(rows: WireRepoCommitRow[], filterText: string): WireRepoCommitRow[] {
  const needle = filterText.trim().toLowerCase();
  if (needle === "") {
    return rows;
  }
  const matchedRows: WireRepoCommitRow[] = [];
  for (const row of rows) {
    const rowText = `${row.hash} ${row.date} ${row.subject}`.toLowerCase();
    const isMatch = rowText.includes(needle);
    if (isMatch) {
      matchedRows.push(row);
    }
  }
  return matchedRows;
}

// Re-render the pick list from the fetched rows through the current filter text (task 154).
function renderCommitPickList(): void {
  const filterText = getInputById("commit-pick-filter").value;
  const pickList = document.getElementById("commit-pick-list")!;
  const pickRows: HTMLElement[] = [];
  for (const row of filterCommitRows(fetchedCommitRows, filterText)) {
    pickRows.push(buildCommitPickRow(row));
  }
  pickList.replaceChildren(...pickRows);
}

// "Pick commit…": fetch the commits, show the list and a cleared filter box (oninput, so no stacked handlers).
export async function openCommitPickList(projectName: string): Promise<void> {
  commitPickProjectName = projectName;
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
  }
  catch (error) {
    // No alert(): native dialogs block headless automation. The breadcrumb carries the error.
    setBreadcrumb(`could not list commits: ${String(error)}`);
  }
}
