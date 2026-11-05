// Layer 1 run consent: asks once per page open before any script replays.

import { ConsentBlockKind, splitConsentScriptsIntoBlocks } from "./app-consent-model.ts";
import { buildConsentScriptRow } from "./app-consent-rows.ts";
import { createElement } from "./app-dom.ts";
import type { WireConsentScript } from "./app-fetch.ts";
import { WireScriptLanguage } from "./layer1-script-language.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Module scope on purpose: a page reload asks again.
let consentAnswer: "allowed" | "declined" | undefined = undefined;

export function resetRunConsent(): void {
  consentAnswer = undefined;
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

function buildConsentButtons(answer: (isAllowed: boolean) => void): HTMLElement {
  return createElement("div", { class: "consent-header-row" }, [
    createElement("button", { class: "toolbar-btn consent-run", text: "Run scripts", onclick: () => answer(true) }),
    createElement("button", { class: "toolbar-btn", text: "Continue without running", onclick: () => answer(false) }),
  ]);
}

function buildRunConsentOverlay(scripts: WireConsentScript[], answer: (isAllowed: boolean) => void): HTMLElement {
  const box = createElement("div", { class: "consent-box" }, [
    createElement("h2", { text: "Replay recorded scripts?" }),
    createElement("p", { class: "consent-note", text: buildRunConsentText() }),
    createElement("div", { class: "muted consent-count", text: `${scripts.length} recorded script(s) can run on this page` }),
    buildConsentButtons(answer),
    ...buildConsentRows(scripts),
  ]);
  return createElement("div", { class: "modal-wrap run-consent" }, [box]);
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
    document.body.append(overlay);
  };
  return new Promise(openConsentOverlay);
}
