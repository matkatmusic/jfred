// Task 356: the shared script-run drawer, keyed by toolUseId rather than (node, path).

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { DiffPaneMode } from "./layer1-diff-pane.ts";
import { buildDiffView, renderDetailView } from "./layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "./layer1-drawer-diff.ts";
import { appendRawJsonRevealForLine } from "./layer1-drawer-node-detail.ts";
import { computeRunBracket,listDiffableSteps } from "./layer1-drawer-steps.ts";
import { readDrawnView } from "./layer1-diff-wash.ts";
import { renderCellCode } from "./diff-render.ts";
import { computeScriptHighlightLanguage, formatScriptRunLabel } from "./layer1-script-language.ts";
import { buildRunConsoleTrigger } from "./layer1-run-console.ts";
import { buildScriptRunFileFold, buildScriptRunFold } from "./layer1-script-run-folds.ts";
import { storeOpenedNode } from "./layer1-node-link.ts";
import { flashSession } from "./layer1-session-flash.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Task 356: every pair path carrying a scriptRuns entry for `toolUseId` — the shared-drawer lookup.
function isRunCarriedBy(pair: WireLayer1View["pairs"][number], toolUseId: string): boolean {
  let carriesRun = false;
  for (const run of pair.scriptRuns ?? []) {
    const isMatch = run.toolUseId === toolUseId;
    if (isMatch) {
      carriesRun = true;
    }
  }
  return carriesRun;
}

export function listScriptRunPaths(view: WireLayer1View, toolUseId: string): string[] {
  const paths: string[] = [];
  for (const pair of view.pairs) {
    const carriesRun = isRunCarriedBy(pair, toolUseId);
    if (carriesRun) {
      paths.push(pair.path);
    }
  }
  return paths;
}

// Task 356: one before/after DiffView pane per affected path, bracketed on the run's own instant.
function buildScriptRunDiffPaneForPath(view: WireLayer1View, runInstant: string, path: string): HTMLElement {
  const bracket = computeRunBracket(view, path, runInstant);
  if (bracket === undefined) {
    return buildDiffView(path, [], {
      revisionControlsShown: false, mode: DiffPaneMode.inline, fullContents: false,
      baseIndex: 0, targetIndex: 0, emptyText: "No verified state to diff against.",
    });
  }
  return buildDiffView(path, listDiffableSteps(view, path), {
    revisionControlsShown: true, mode: DiffPaneMode.inline, fullContents: false,
    baseIndex: bracket.baseIndex, targetIndex: bracket.targetIndex,
  });
}

export function buildScriptRunDiffPanes(
  view: WireLayer1View, runInstant: string, affectedPaths: string[],
): HTMLElement[] {
  const panes: HTMLElement[] = [];
  for (const path of affectedPaths) {
    panes.push(buildScriptRunDiffPaneForPath(view, runInstant, path));
  }
  return panes;
}

// const SCRIPT_RUN_STATUSES: [string, string][] = [["🚫", "not verified"], ["📍", "located"], ["⏸️", "not replayed"]];

// No wire field carries a run's status yet, so every run reads the same.
const SCRIPT_RUN_STATUS = { verified: false, located: true, replayed: false };

// Task 356: the #dpath status groups; a verified run needs no other check.
// export function buildScriptRunStatusBadges(): HTMLElement[] {
//     return SCRIPT_RUN_STATUSES.map(([text, title]) => createElement("span", { class: "run-status", text, title }));
// }
export function buildScriptRunStatusBadges(): (string | HTMLElement)[] {
  const checks: (keyof typeof SCRIPT_RUN_STATUS)[] = SCRIPT_RUN_STATUS.verified ? ["verified"] : ["verified", "located", "replayed"];
  const badges: (string | HTMLElement)[] = [];
  for (const check of checks) {
    const passed = SCRIPT_RUN_STATUS[check];
    // dpath collapses normal spaces, so each | is padded with two non-breaking spaces.
    // badges.push(`  ${check[0]!.toUpperCase()}${check.slice(1)}: `,
    //   createElement("span", { class: "run-status", text: passed ? "✅" : "❌", title: passed ? check : `not ${check}` }));
    badges.push("  |  ", createElement("span", { class: "run-check", text: `${check[0]!.toUpperCase()}${check.slice(1)}: ` }),
      createElement("span", { class: "run-status", text: passed ? "✅" : "❌", title: passed ? check : `not ${check}` }));
  }
  return badges;
}

// A script run's title: its script file's label, else its language's.
export function getScriptRunTitle(run: WireScriptRun): string {
  return run.label ?? formatScriptRunLabel(run.language);
}

// Task 356: the meta fold and the script body fold of a script-run drawer.
function collectScriptRunMeta(run: WireScriptRun): { metaRows: [string, string][]; provenanceParts: string[] } {
  const metaRows: [string, string][] = [
    ["kind", "script run (layer 4)"], ["executor", formatScriptRunLabel(run.language)], ["instant", run.instant],
    ["session", run.sessionFile],
  ];
  const provenanceParts = ["resolved body", run.sessionFile];
  if (run.line !== undefined) {
    metaRows.push(["line", String(run.line)]);
    provenanceParts.push(`line ${run.line}`);
  }
  metaRows.push(["tool use id", run.toolUseId]);
  provenanceParts.push(run.toolUseId, run.instant);
  return { metaRows, provenanceParts };
}

export function buildScriptRunDetail(run: WireScriptRun): HTMLElement[] {
  const { metaRows, provenanceParts } = collectScriptRunMeta(run);
  const scriptMeta = createElement("dl", { class: "script-meta" });
  for (const [term, value] of metaRows) {
    scriptMeta.append(createElement("dt", { text: term }), createElement("dd", { text: value }));
  }
  const pre = createElement("pre");
  renderCellCode(pre, run.code, computeScriptHighlightLanguage(run.language));
  const head = createElement("summary", { class: "sbhead" }, [createElement("b", { text: getScriptRunTitle(run) }), createElement("span", { class: "prov", text: provenanceParts.join(" · ") })]);
  const metaSummary = createElement("summary", { text: "kind, executor, instant, session, line, tool use id" });
  const folds = [buildScriptRunFold("script-meta-fold", metaSummary, [scriptMeta], false), buildScriptRunFold("scriptbody", head, [pre], true)];
  const hasRunState = run.confidence !== undefined;
  return hasRunState ? [buildRunConsoleTrigger(), ...folds] : folds;
}

// Task 356: identity is toolUseId, not (node, path) — one shared drawer for every bubble the run touches.
function findScriptRunById(view: WireLayer1View, toolUseId: string): WireScriptRun | undefined {
  let run: WireScriptRun | undefined;
  for (const pair of view.pairs) {
    for (const entry of pair.scriptRuns ?? []) {
      const isMatch = entry.toolUseId === toolUseId;
      const isRunUnset = run === undefined;
      const isFirstMatch = isMatch && isRunUnset;
      if (isFirstMatch) {
        run = entry;
      }
    }
  }
  return run;
}

function hideDrawerStepButtons(): void {
  for (const id of ["dprev", "dnext"] as const) {
    getRequiredElementById(id).hidden = true;
  }
}

function renderScriptRunHeader(run: WireScriptRun, paths: string[]): void {
  const header = getRequiredElementById("dpath");
  header.replaceChildren(getScriptRunTitle(run), ...buildScriptRunStatusBadges());
  header.title = paths.join("\n");
  getRequiredElementById("dmeta").replaceChildren(buildScriptRunFileFold(getScriptRunTitle(run), paths));
}

export async function openScriptRunDrawer(toolUseId: string | undefined): Promise<void> {
  const view = readDrawnView();
  const isViewMissing = view === undefined;
  const isToolUseIdMissing = toolUseId === undefined;
  const isNothingToOpen = isViewMissing || isToolUseIdMissing;
  if (isNothingToOpen) {
    return;
  }
  const run = findScriptRunById(view, toolUseId);
  if (run === undefined) {
    return;
  }
  renderScriptRunDrawer(view, run);
}

function renderScriptRunDrawer(view: WireLayer1View, run: WireScriptRun): void {
  const paths = listScriptRunPaths(view, run.toolUseId);
  clearDiffPair();
  storeOpenedNode({ instant: run.instant, sessionFile: run.sessionFile, line: run.line });
  hideDrawerStepButtons();
  renderScriptRunHeader(run, paths);
  getRequiredElementById("drawer").classList.add("open");
  setDrawerTools("none");
  renderDetailView([...buildScriptRunDetail(run), ...buildScriptRunDiffPanes(view, run.instant, paths)]);
  if (run.line !== undefined) {
    appendRawJsonRevealForLine(run.sessionFile, run.line);
  }
  flashSession(run.sessionFile.split("/").pop() ?? run.sessionFile);
}
