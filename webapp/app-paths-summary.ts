// ─── task 159: the Paths popover's summary rows and the wizard's screen-4 default-commit label.

import { getBaselineChoice } from "./app-choices.ts";
import { createElement, getInputById } from "./app-dom.ts";
import { fetchJson, getCachedDocument } from "./app-fetch.ts";
import { formatShortCommitHash } from "./app-baseline-question.ts";
import { extractGitBaseCommitHash, GIT_BASE_CHANGE_ID_PREFIX } from "./views/timeline-changes.ts";

// One summary/finish row: a label, the current value, and the wizard screen its Edit opens.
type SummaryRow = { label: string; value: string; screenNumber: number };

// The Edit-button jump the wizard supplies (startSingleScreenEdit).
export type StartScreenEdit = (screenNumber: number, projectName: string | undefined) => void;

// The two /api/repo-commits row fields the tip label needs (client copy, the app-paths-sources.ts precedent).
type WireRepoCommitTip = { hash: string; subject: string };

// The pre-baseline row's display text, from the task-56 sessionStorage mirror.
function getBaselineChoiceLabel(projectName: string): string {
  const choice = getBaselineChoice(projectName);
  if (choice === "1") {
    return "yes";
  }
  return choice === "0" ? "no" : "(not set)";
}

// The two GLOBAL rows (screens 1–2): projects folder + file-history derivation state.
function computeGlobalSummaryRows(): SummaryRow[] {
  const fileHistoryValue = document.getElementById("file-history-fields")!.hidden
    ? "auto-derived"
    : getInputById("file-history-dir-input").value;
  return [
    { label: "Projects folder", value: getInputById("projects-dir-input").value, screenNumber: 1 },
    { label: "File history", value: fileHistoryValue, screenNumber: 2 },
  ];
}

// The three per-project rows (screens 3–5): repo, base commit, pre-baseline answer.
function computeProjectSummaryRows(projectName: string): SummaryRow[] {
  const repo = getInputById("repo-dir-input").value;
  const baseCommit = getInputById("base-commit-display").value;
  return [
    { label: "Git repo", value: repo === "" ? "(none)" : repo, screenNumber: 3 },
    { label: "Base commit", value: baseCommit === "" ? "(default)" : formatShortCommitHash(baseCommit), screenNumber: 4 },
    { label: "Pre-baseline", value: getBaselineChoiceLabel(projectName), screenNumber: 5 },
  ];
}

function computeSummaryRows(projectName: string | undefined): SummaryRow[] {
  if (projectName === undefined) {
    return computeGlobalSummaryRows();
  }
  return [...computeGlobalSummaryRows(), ...computeProjectSummaryRows(projectName)];
}

function buildSummaryRow(row: SummaryRow, projectName: string | undefined, startEdit: StartScreenEdit | undefined): HTMLElement {
  const children: (Node | string)[] = [
    createElement("span", { class: "summary-label", text: row.label }),
    createElement("span", { class: "summary-value", text: row.value }),
  ];
  if (startEdit !== undefined) {
    children.push(createElement("button", {
      class: "toolbar-btn summary-edit",
      text: "Edit",
      onclick: () => startEdit(row.screenNumber, projectName),
    }));
  }
  return createElement("div", { class: "summary-row" }, children);
}

// Rebuild the summary rows from the popover's CURRENT field values; rows 3–5 need a project.
export function renderPathsSummary(projectName: string | undefined, startEdit: StartScreenEdit): void {
  const rows: HTMLElement[] = [];
  for (const row of computeSummaryRows(projectName)) {
    rows.push(buildSummaryRow(row, projectName, startEdit));
  }
  document.getElementById("paths-summary-rows")!.replaceChildren(...rows);
}

// The Finish face's value recap — the same rows without Edit buttons (mockup's Apply box).
export function renderFinishRows(projectName: string | undefined): void {
  const rows: HTMLElement[] = [];
  for (const row of computeSummaryRows(projectName)) {
    rows.push(buildSummaryRow(row, projectName, undefined));
  }
  document.getElementById("wizard-finish-rows")!.replaceChildren(...rows);
}

// The gitBase:<hash> beacon in the already-loaded document, if any; reads the cache only, never builds.
function findSessionRecordedBaselineHash(projectName: string | undefined): string | undefined {
  if (projectName === undefined) {
    return undefined;
  }
  const cached = getCachedDocument<{ steps?: { changeIds?: string[] }[] }>(projectName);
  const changeIds: string[] = [];
  for (const step of cached?.steps ?? []) {
    changeIds.push(...(step.changeIds ?? []));
  }
  let beacon: string | undefined;
  for (const changeId of changeIds) {
    const isBeacon = changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX);
    if (isBeacon) {
      beacon = changeId;
      break;
    }
  }
  return beacon === undefined ? undefined : extractGitBaseCommitHash(beacon);
}

// The repo tip from /api/repo-commits' newest row, never a hardcoded branch name.
async function fetchRepoTipLabel(): Promise<string> {
  const repo = getInputById("repo-dir-input").value;
  const rows = await fetchJson<WireRepoCommitTip[]>(`/api/repo-commits?repo=${encodeURIComponent(repo)}`);
  const tip = rows[0];
  if (tip === undefined) {
    return "Default: (no commits found)";
  }
  return `Default: ${formatShortCommitHash(tip.hash)} "${tip.subject}" (repo tip)`;
}

// Screen 4's default-radio label: the recorded baseline when one exists, else the fetched repo tip.
export async function getDefaultCommitLabel(projectName: string | undefined): Promise<string> {
  const stored = getInputById("base-commit-display").value;
  if (stored !== "") {
    return `Default: ${formatShortCommitHash(stored)} (session baseline)`;
  }
  const recorded = findSessionRecordedBaselineHash(projectName);
  if (recorded !== undefined) {
    return `Default: ${formatShortCommitHash(recorded)} (session-recorded baseline)`;
  }
  return fetchRepoTipLabel();
}
