// Layer 1 run consent: asks once per page open before any script replays.

import { ConsentBlockKind, splitConsentScriptsIntoBlocks } from "../../app-consent-model.ts";
import { buildConsentScriptRow } from "../../app-consent-rows.ts";
import { createElement } from "../../app-dom.ts";
import type { WireConsentScript } from "../../app-fetch.ts";
import { WireScriptLanguage } from "../details-drawer/layer1-script-language.ts";
import type { WireScriptReplayNeeds, WireScriptReplayRunReply, WireScriptReplayTask } from "../../layer1-wire-script-replay.ts";
import type { WireScriptRun } from "../../layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../../layer1-wire.ts";

// Module scope on purpose: a page reload asks again.
let consentAnswer: "allowed" | "declined" | undefined = undefined;

export function resetRunConsent(): void {
  consentAnswer = undefined;
}

export function isRunConsentAllowed(): boolean {
  return consentAnswer === "allowed";
}

function isPythonRun(run: WireScriptRun): boolean {
  return run.language === WireScriptLanguage.python || run.language === WireScriptLanguage.python3;
}

function collectDistinctPythonRuns(view: WireLayer1View): WireScriptRun[] {
  const seenIds = new Set<string>();
  const runs: WireScriptRun[] = [];
  for (const pair of view.pairs) {
    for (const run of pair.scriptRuns ?? []) {
      const isNewPythonRun = isPythonRun(run) && !seenIds.has(run.toolUseId);
      seenIds.add(run.toolUseId);
      if (isNewPythonRun) {
        runs.push(run);
      }
    }
  }
  return runs;
}

function compareRunInstants(first: WireScriptRun, second: WireScriptRun): number {
  return Date.parse(first.instant) - Date.parse(second.instant);
}

function convertRunToConsentScript(run: WireScriptRun): WireConsentScript {
  const script: WireConsentScript = { timestamp: run.instant, code: run.code, readOnly: false };
  if (run.line !== undefined) {
    script.source = { filePath: run.sessionFile, lineNumber: run.line };
  }
  return script;
}

export function buildRunConsentScripts(view: WireLayer1View): WireConsentScript[] {
  const runs = collectDistinctPythonRuns(view);
  runs.sort(compareRunInstants);
  const scripts: WireConsentScript[] = [];
  for (const run of runs) {
    scripts.push(convertRunToConsentScript(run));
  }
  return scripts;
}

export function buildRunConsentText(): string {
  return "Replay runs saved Python scripts. Each script runs in a Docker container. The container gets copied files only. It has no network. It cannot read, change, or delete your other files. Docker must be on. If Docker is off, nothing runs. Scripts that only read files are skipped; that check is a text scan and can be wrong. A script runs only after the earlier scripts in its bubbles have run. Each script stops after 5 seconds. Bash scripts and other languages do not run.";
}

function buildConsentRows(scripts: WireConsentScript[]): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const block of splitConsentScriptsIntoBlocks(scripts)) {
    if (block.kind !== ConsentBlockKind.modifying) {
      throw new Error("run consent lists only scripts that change files");
    }
    rows.push(buildConsentScriptRow(block.script));
  }
  return rows;
}

function buildContinueWithoutRunningButton(answer: (isAllowed: boolean) => void): HTMLElement {
  return createElement("button", { class: "toolbar-btn", "data-component": "runConsentContinueWithoutRunningButton", text: "Continue without running", onclick: () => answer(false) });
}

function buildConsentButtons(answer: (isAllowed: boolean) => void): HTMLElement {
  return createElement("div", { class: "consent-header-row" }, [
    createElement("button", { class: "toolbar-btn consent-run", "data-component": "runConsentRunButton", text: "Run scripts", onclick: () => answer(true) }),
    buildContinueWithoutRunningButton(answer),
  ]);
}

function buildConsentCount(countText: string): HTMLElement {
  return createElement("div", { class: "muted consent-count", "data-component": "runConsentScriptCountText", text: countText });
}

function buildConsentOverlayShell(noteText: string, bodyChildren: HTMLElement[]): HTMLElement {
  const box = createElement("div", { class: "consent-box", "data-component": "runConsentDialog" }, [
    createElement("h2", { "data-component": "runConsentTitle", text: "Replay recorded scripts?" }),
    createElement("p", { class: "consent-note", "data-component": "runConsentNoteText", text: noteText }),
    ...bodyChildren,
  ]);
  return createElement("div", { class: "modal-wrap run-consent", "data-component": "runConsentPopup" }, [box]);
}

function buildRunConsentOverlay(scripts: WireConsentScript[], answer: (isAllowed: boolean) => void): HTMLElement {
  return buildConsentOverlayShell(buildRunConsentText(), [
    buildConsentCount(`${scripts.length} recorded script(s) can run on this page`),
    buildConsentButtons(answer),
    ...buildConsentRows(scripts),
  ]);
}

function appendConsentOverlay(overlay: HTMLElement): void {
  const page = document.querySelector(".appWindow");
  if (page === null) {
    throw new Error("run consent needs the .appWindow page element");
  }
  page.append(overlay);
}

export function openRunConsent(view: WireLayer1View): Promise<boolean> {
  if (consentAnswer !== undefined) {
    return Promise.resolve(consentAnswer === "allowed");
  }
  const openConsentOverlay = (resolve: (isAllowed: boolean) => void): void => {
    const storeConsentAnswer = (isAllowed: boolean): void => {
      consentAnswer = isAllowed ? "allowed" : "declined";
      overlay.remove();
      resolve(isAllowed);
    };
    const overlay = buildRunConsentOverlay(buildRunConsentScripts(view), storeConsentAnswer);
    appendConsentOverlay(overlay);
  };
  return new Promise(openConsentOverlay);
}

const SCRIPT_REPLAY_NOTE_TEXT = "Replay runs saved scripts (Python and shell). Each script runs in a Docker container. The container gets copies of your project files only. It has no network. It cannot read, change, or delete your other files.";
const EARLIER_SCRIPT_TEXT = "earlier script, needed as input";

function convertTaskToConsentScript(task: WireScriptReplayTask): WireConsentScript {
  return { timestamp: task.instant, code: task.code, readOnly: false, source: task.source };
}

function buildReplayTaskRow(task: WireScriptReplayTask): HTMLElement {
  const row = buildConsentScriptRow(convertTaskToConsentScript(task));
  const waitingPaths: string[] = [];
  for (const file of task.waitingFiles) {
    waitingPaths.push(file.path);
  }
  row.append(createElement("div", { class: "muted", "data-component": "runConsentWaitingFilesText", text: `waiting files: ${waitingPaths.join(", ")}` }));
  if (!task.isInSpan) {
    row.append(createElement("div", { class: "muted", "data-component": "runConsentEarlierScriptText", text: EARLIER_SCRIPT_TEXT }));
  }
  return row;
}

function buildScriptReplayProblemChildren(needs: WireScriptReplayNeeds, answer: (isAllowed: boolean) => void): HTMLElement[] {
  if (needs.problemText === undefined) {
    throw new Error("a script replay problem needs its problem text");
  }
  return [
    createElement("p", { class: "consent-note", "data-component": "runConsentProblemText", text: needs.problemText }),
    createElement("div", { class: "consent-header-row" }, [buildContinueWithoutRunningButton(answer)]),
  ];
}

function buildScriptReplayTaskChildren(needs: WireScriptReplayNeeds, answer: (isAllowed: boolean) => void): HTMLElement[] {
  const children: HTMLElement[] = [
    buildConsentCount(`${needs.tasks.length} recorded script(s) are needed for this commit`),
    buildConsentButtons(answer),
  ];
  for (const task of needs.tasks) {
    children.push(buildReplayTaskRow(task));
  }
  return children;
}

function buildScriptReplayOverlay(needs: WireScriptReplayNeeds, answer: (isAllowed: boolean) => void): HTMLElement {
  const children: HTMLElement[] = [];
  if (needs.problem !== undefined) {
    children.push(...buildScriptReplayProblemChildren(needs, answer));
  }
  if (needs.problem === undefined) {
    children.push(...buildScriptReplayTaskChildren(needs, answer));
  }
  return buildConsentOverlayShell(SCRIPT_REPLAY_NOTE_TEXT, children);
}

// No module-scope answer: every commit asks again.
export function openScriptReplayConsent(needs: WireScriptReplayNeeds): Promise<boolean> {
  const openConsentOverlay = (resolve: (isAllowed: boolean) => void): void => {
    const closeAndAnswer = (isAllowed: boolean): void => {
      overlay.remove();
      resolve(isAllowed);
    };
    const overlay = buildScriptReplayOverlay(needs, closeAndAnswer);
    appendConsentOverlay(overlay);
  };
  return new Promise(openConsentOverlay);
}

function collectMissingExecutableNames(reply: WireScriptReplayRunReply): string[] {
  const names: string[] = [];
  for (const result of reply.results) {
    if (result.missingExecutable !== undefined) {
      if (!names.includes(result.missingExecutable)) {
        names.push(result.missingExecutable);
      }
    }
  }
  return names;
}

function buildMissingExecutablesOverlay(names: string[], close: () => void): HTMLElement {
  const lines: HTMLElement[] = [];
  for (const name of names) {
    lines.push(createElement("p", { "data-component": "missingExecutableLineText", text: `missing executable or Python module ${name} in reveng-sandbox:1: add it to sandbox-image/Dockerfile` }));
  }
  const box = createElement("div", { class: "consent-box", "data-component": "missingExecutablesDialog" }, [
    createElement("h2", { "data-component": "missingExecutablesTitle", text: "Programs missing from the script image" }),
    ...lines,
    createElement("div", { class: "consent-header-row" }, [
      createElement("button", { class: "toolbar-btn", "data-component": "missingExecutablesCloseButton", text: "Close", onclick: close }),
    ]),
  ]);
  return createElement("div", { class: "modal-wrap run-consent", "data-component": "missingExecutablesPopup" }, [box]);
}

export function openMissingExecutablesNotice(reply: WireScriptReplayRunReply): Promise<void> {
  const names = collectMissingExecutableNames(reply);
  if (names.length === 0) {
    return Promise.resolve();
  }
  const openNoticeOverlay = (resolve: () => void): void => {
    const closeAndResolve = (): void => {
      overlay.remove();
      resolve();
    };
    const overlay = buildMissingExecutablesOverlay(names, closeAndResolve);
    appendConsentOverlay(overlay);
  };
  return new Promise(openNoticeOverlay);
}
