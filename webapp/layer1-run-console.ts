// L6 run console: a popup over the timeline, built on first open and filled from the results store.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import {
  findRunConsoleCancelState, findRunConsoleTerminalState, listRunConsoleNotes, selectRunConsoleCancelKey, selectRunConsoleTerminalKey,
  type RunConsoleTerminalState,
} from "./layer1-run-console-data.ts";
import { getCancelledRunIds, getRunOutput, getRunResult, isRunStarted } from "./layer1-run-results.ts";
import type { WireScriptResult } from "./layer1-wire-script-results.ts";

export type CancelRun = (toolUseId: string) => void;

const RUN_CONSOLE_ID = "run-console";

// The run on show, and the cancel function the drawer passed in.
let shown: { toolUseId: string; cancelRun: CancelRun } | undefined;

function buildTerminalBlock(state: RunConsoleTerminalState): HTMLElement {
  return createElement("div", { class: `terminal-block ${state.className}` }, [
    createElement("strong", { class: "terminal-title", text: state.label }),
    createElement("p", { class: "terminal-desc", text: state.description }),
  ]);
}

function closeRunConsole(): void {
  getRequiredElementById(RUN_CONSOLE_ID).hidden = true;
}

function buildRunConsoleHead(): HTMLElement {
  return createElement("div", { class: "run-console-head" }, [
    createElement("strong", { text: "Run output" }),
    createElement("button", { class: "run-console-close", text: "Close", onclick: closeRunConsole }),
  ]);
}

function getConsolePart(selector: string): HTMLElement {
  const part = getRequiredElementById(RUN_CONSOLE_ID).querySelector<HTMLElement>(selector);
  if (part === null) {
    throw new Error(`run console is missing ${selector}`);
  }
  return part;
}

function buildOutputPre(toolUseId: string, result: WireScriptResult | undefined): HTMLElement {
  const pre = createElement("pre", { class: "console-pre" });
  if (result === undefined) {
    pre.textContent = getRunOutput(toolUseId);
    return pre;
  }
  pre.append(result.stdout);
  if (result.stderr.length > 0) {
    pre.append(createElement("span", { class: "stderr", text: result.stderr }));
  }
  return pre;
}

function buildConsoleNotes(result: WireScriptResult | undefined): HTMLElement[] {
  const paragraphs: HTMLElement[] = [];
  for (const note of listRunConsoleNotes(result)) {
    paragraphs.push(createElement("p", { class: "run-console-note", text: note }));
  }
  return paragraphs;
}

function triggerConsoleCancel(toolUseId: string, cancelRun: CancelRun): void {
  cancelRun(toolUseId);
  refreshRunConsole(toolUseId);
}

function buildCancelButton(toolUseId: string, cancelRun: CancelRun, result: WireScriptResult | undefined): HTMLElement {
  const isCancelled = getCancelledRunIds().has(toolUseId);
  const isRunning = isRunStarted(toolUseId) && result === undefined && !isCancelled;
  const state = findRunConsoleCancelState(selectRunConsoleCancelKey(isCancelled, isRunning));
  const button = createElement("button", { class: `cancel-btn ${state.className}`, text: state.label, onclick: () => triggerConsoleCancel(toolUseId, cancelRun) });
  (button as HTMLButtonElement).disabled = state.disabled;
  return button;
}

function buildTerminalBlocks(toolUseId: string, result: WireScriptResult | undefined): HTMLElement[] {
  const isCancelled = getCancelledRunIds().has(toolUseId);
  const state = findRunConsoleTerminalState(selectRunConsoleTerminalKey(isCancelled, result));
  return state === undefined ? [] : [buildTerminalBlock(state)];
}

function fillRunConsole(toolUseId: string, cancelRun: CancelRun): void {
  const result = getRunResult(toolUseId);
  getConsolePart(".console-output").replaceChildren(buildOutputPre(toolUseId, result), ...buildConsoleNotes(result));
  getConsolePart(".cancel-state-row").replaceChildren(buildCancelButton(toolUseId, cancelRun, result));
  getConsolePart(".terminal-state-row").replaceChildren(...buildTerminalBlocks(toolUseId, result));
}

export function buildRunConsolePopup(): HTMLElement {
  const body = createElement("div", { class: "run-console-body" }, [
    createElement("div", { class: "console-output" }),
    createElement("div", { class: "cancel-state-row" }),
    createElement("div", { class: "terminal-state-row" }),
  ]);
  return createElement("div", { id: RUN_CONSOLE_ID, class: "run-console", hidden: "" }, [buildRunConsoleHead(), body]);
}

export function openRunConsole(toolUseId: string, cancelRun: CancelRun): void {
  const isBuilt = document.getElementById(RUN_CONSOLE_ID) !== null;
  if (!isBuilt) {
    getRequiredElementById("stagewrap").append(buildRunConsolePopup());
  }
  shown = { toolUseId, cancelRun };
  fillRunConsole(toolUseId, cancelRun);
  getRequiredElementById(RUN_CONSOLE_ID).hidden = false;
}

// The queue calls this after each output line, result and cancel; it repaints only the run on show.
export function refreshRunConsole(toolUseId: string): void {
  if (shown === undefined) {
    return;
  }
  const popup = document.getElementById(RUN_CONSOLE_ID);
  const isOpenOnRun = shown.toolUseId === toolUseId && popup !== null && !popup.hidden;
  if (isOpenOnRun) {
    fillRunConsole(toolUseId, shown.cancelRun);
  }
}

export function buildRunConsoleTrigger(toolUseId: string, cancelRun: CancelRun): HTMLElement {
  const openButton = createElement("button", { class: "run-console-open", text: "Open run console", onclick: () => openRunConsole(toolUseId, cancelRun) });
  return createElement("div", { class: "run-console-row" }, [openButton]);
}
