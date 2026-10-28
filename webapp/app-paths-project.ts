// Per-project Paths popover: repo/commit/fileHistory overrides applied on Apply, persisted on Store.

import { getBaselineChoice, storeBaselineChoice } from "./app-choices.ts";
import { getInputById } from "./app-dom.ts";
import { documentCache, fetchJson, rawLinesCache } from "./app-fetch.ts";
import { selectFolderInto, fillFileHistoryOverrideField } from "./app-header.ts";
import { openCommitPickList } from "./app-paths-project-commits.ts";
import { renderPathsSummary } from "./app-paths-summary.ts";
import { collectSourceRows, initializeSourcesSection, renderSourceRows, type WireSourceEntryClient } from "./app-paths-sources.ts";
import { startProjectWizard, startSingleScreenEdit } from "./app-paths-wizard.ts";
import { parseRouteSegments } from "./app-routes.ts";
import { renderRoute, resetLastLoadedProject, setBreadcrumb } from "./app-router.ts";

// One project's reveng-paths.json entry on the wire (WireProjectPaths server-side).
// task 177: gains an optional multi-source list — the Sources section's own entries.
// task 159: gains preBaseline — the wizard screen-5 answer, persisted on Store.
// type WireProjectPathsEntry = { cwd?: string; repo?: string; baseCommit?: string; fileHistory?: string };
type WireProjectPathsEntry = { cwd?: string; repo?: string; baseCommit?: string; fileHistory?: string; sources?: WireSourceEntryClient[]; preBaseline?: string };

// The project the section currently edits (set by refreshProjectPathsSection).
let activeProjectName = "";

// task 159: getInputById moved to app-dom.ts (shared with app-paths-wizard.ts).
// function getInputById(id: string): HTMLInputElement {
//     return document.getElementById(id) as HTMLInputElement;
// }

// The entry Apply/Store post: only non-empty fields; fileHistory only while its fields are shown.
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

// Apply (persist=false) or Store (persist=true) the entry, then reload the open project.
async function sendProjectPaths(persist: boolean): Promise<void> {
  // task 159: a screen-1-only run has no project loaded, so there is no entry to post.
  if (activeProjectName === "") {
    return;
  }
  const response = await fetch("/api/project-paths", {
    method: "POST", headers: { "Content-Type": "application/json" },
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

// Show the section, prefill it from the merged entry, and return that entry (onclick, so no stacked handlers).
export async function refreshProjectPathsSection(projectName: string): Promise<WireProjectPathsEntry> {
  activeProjectName = projectName;
  document.getElementById("project-paths-section")!.hidden = false;
  (document.getElementById("repo-dir-open") as HTMLButtonElement).onclick = () => void selectFolderInto(getInputById("repo-dir-input"));
  (document.getElementById("pick-commit-btn") as HTMLButtonElement).onclick = () => void openCommitPickList(projectName);
  (document.getElementById("project-paths-apply") as HTMLButtonElement).onclick = () => void sendProjectPaths(false);
  (document.getElementById("project-paths-store") as HTMLButtonElement).onclick = () => void sendProjectPaths(true);
  const entry = await fetchJson<WireProjectPathsEntry>(`/api/project-paths?project=${encodeURIComponent(projectName)}`);
  getInputById("repo-dir-input").value = entry.repo ?? "";
  getInputById("base-commit-display").value = entry.baseCommit ?? "";
  // task 153: a stored per-project fileHistory override surfaces in the task-136 field.
  fillFileHistoryOverrideField(entry.fileHistory);
  // task 177: the Sources section prefills from the merged entry's sources list.
  initializeSourcesSection();
  renderSourceRows(entry.sources ?? []);
  // task 159: a stored screen-5 answer seeds the mirror only when the session has no answer.
  const storedPreBaseline = entry.preBaseline;
  const hasStoredAnswer = storedPreBaseline !== undefined;
  const isSessionUnanswered = getBaselineChoice(projectName) === null;
  const shouldSeedChoice = hasStoredAnswer && isSessionUnanswered;
  if (shouldSeedChoice) {
    storeBaselineChoice(projectName, storedPreBaseline);
  }
  renderPathsSummary(projectName, startSingleScreenEdit);
  return entry;
}

// True when the merged entry carries any stored or overridden value.
function isEntryConfigured(entry: WireProjectPathsEntry): boolean {
  return entry.repo !== undefined || entry.baseCommit !== undefined || entry.fileHistory !== undefined || entry.sources !== undefined || entry.preBaseline !== undefined;
}

// task 159: projects already offered the wizard this page-session, so switching back never re-asks.
const wizardOfferedProjects = new Set<string>();

// Project-load trigger: with no reveng-paths entry, open the wizard on screens 2–5; fetch failures stay silent.
export async function triggerProjectPathsWizardOffer(projectName: string): Promise<void> {
  const isAlreadyOffered = wizardOfferedProjects.has(projectName);
  if (isAlreadyOffered) {
    return;
  }
  wizardOfferedProjects.add(projectName);
  try {
    const entry = await refreshProjectPathsSection(projectName);
    const isConfigured = isEntryConfigured(entry);
    if (isConfigured) {
      return;
    }
    startProjectWizard(projectName);
  }
  catch {
    // no reachable /api/project-paths (or a test stub without it): no wizard offer.
  }
}

// Every Paths-popover open re-derives the current project from the route — no project open keeps the section hidden.
function refreshSectionFromRoute(): void {
  const segments = parseRouteSegments();
  if (segments[0] !== "project") {
    document.getElementById("project-paths-section")!.hidden = true;
    return;
  }
  if (segments[1] === undefined) {
    return;
  }
  void refreshProjectPathsSection(segments[1]);
}

export function initProjectPathsSection(): void {
  document.getElementById("paths-btn")!.addEventListener("click", refreshSectionFromRoute);
}
