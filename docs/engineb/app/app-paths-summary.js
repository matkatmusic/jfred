// ─── task 159: the Paths popover's summary rows + the wizard's screen-4 default-commit label.
// The summary panel is the popover's default face (plans/159-paths-wizard-mockup.md §b); the
// same rows (minus the Edit buttons) fill the Finish face. The state machine that the Edit
// buttons jump into lives in app-paths-wizard.ts — passed in as a callback so the import
// direction stays wizard → summary.
import { getBaselineChoice } from "./app-choices.js";
import { el, getInputById } from "./app-dom.js";
import { fetchJson, peekCachedDocument } from "./app-fetch.js";
import { formatShortCommitHash } from "./app-baseline-question.js";
import { extractGitBaseCommitHash, GIT_BASE_CHANGE_ID_PREFIX } from "./views/timeline-changes.js";
// The pre-baseline row's display text, from the task-56 sessionStorage mirror.
function describeBaselineChoice(projectName) {
    const choice = getBaselineChoice(projectName);
    if (choice === "1") {
        return "yes";
    }
    return choice === "0" ? "no" : "(not set)";
}
// The two GLOBAL rows (screens 1–2): projects folder + file-history derivation state.
function computeGlobalSummaryRows() {
    const fileHistoryValue = document.getElementById("file-history-fields").hidden
        ? "auto-derived"
        : getInputById("file-history-dir-input").value;
    return [
        { label: "Projects folder", value: getInputById("projects-dir-input").value, screenNumber: 1 },
        { label: "File history", value: fileHistoryValue, screenNumber: 2 },
    ];
}
// The three per-project rows (screens 3–5): repo, base commit, pre-baseline answer.
function computeProjectSummaryRows(projectName) {
    const repo = getInputById("repo-dir-input").value;
    const baseCommit = getInputById("base-commit-display").value;
    return [
        { label: "Git repo", value: repo === "" ? "(none)" : repo, screenNumber: 3 },
        { label: "Base commit", value: baseCommit === "" ? "(default)" : formatShortCommitHash(baseCommit), screenNumber: 4 },
        { label: "Pre-baseline", value: describeBaselineChoice(projectName), screenNumber: 5 },
    ];
}
function computeSummaryRows(projectName) {
    if (projectName === undefined) {
        return computeGlobalSummaryRows();
    }
    return [...computeGlobalSummaryRows(), ...computeProjectSummaryRows(projectName)];
}
function buildSummaryRow(row, projectName, startEdit) {
    const children = [
        el("span", { class: "summary-label", text: row.label }),
        el("span", { class: "summary-value", text: row.value }),
    ];
    if (startEdit !== undefined) {
        children.push(el("button", {
            class: "toolbar-btn summary-edit",
            text: "Edit",
            onclick: () => startEdit(row.screenNumber, projectName),
        }));
    }
    return el("div", { class: "summary-row" }, children);
}
// Rebuild the summary panel's rows from the popover's CURRENT field values. Rows 3–5 render
// only with a project; each Edit jumps to its single wizard screen via `startEdit`.
export function renderPathsSummary(projectName, startEdit) {
    const rows = computeSummaryRows(projectName).map((row) => buildSummaryRow(row, projectName, startEdit));
    document.getElementById("paths-summary-rows").replaceChildren(...rows);
}
// The Finish face's value recap — the same rows without Edit buttons (mockup's Apply box).
export function renderFinishRows(projectName) {
    const rows = computeSummaryRows(projectName).map((row) => buildSummaryRow(row, projectName, undefined));
    document.getElementById("wizard-finish-rows").replaceChildren(...rows);
}
// The gitBase:<hash> beacon inside the already-loaded document, when the session recorded a
// baseline commit (s85-style). Never triggers a build — peeks the cache only.
function findSessionRecordedBaselineHash(projectName) {
    if (projectName === undefined) {
        return undefined;
    }
    const cached = peekCachedDocument(projectName);
    const changeIds = (cached?.steps ?? []).flatMap((step) => step.changeIds ?? []);
    const beacon = changeIds.find((changeId) => changeId.startsWith(GIT_BASE_CHANGE_ID_PREFIX));
    return beacon === undefined ? undefined : extractGitBaseCommitHash(beacon);
}
// The repo's tip described from /api/repo-commits' newest row — the resolved default-branch
// tip, never a hardcoded branch name (mockup resolved ambiguity 3).
async function describeRepoTip() {
    const repo = getInputById("repo-dir-input").value;
    const rows = await fetchJson(`/api/repo-commits?repo=${encodeURIComponent(repo)}`);
    const tip = rows[0];
    if (tip === undefined) {
        return "Default: (no commits found)";
    }
    return `Default: ${formatShortCommitHash(tip.hash)} "${tip.subject}" (repo tip)`;
}
// Screen 4's default-radio label: the stored/session-recorded baseline when one exists, else
// the repo tip (fetched). The wizard stamps the resolving placeholder before awaiting this.
export async function resolveDefaultCommitLabel(projectName) {
    const stored = getInputById("base-commit-display").value;
    if (stored !== "") {
        return `Default: ${formatShortCommitHash(stored)} (session baseline)`;
    }
    const recorded = findSessionRecordedBaselineHash(projectName);
    if (recorded !== undefined) {
        return `Default: ${formatShortCommitHash(recorded)} (session-recorded baseline)`;
    }
    return describeRepoTip();
}
