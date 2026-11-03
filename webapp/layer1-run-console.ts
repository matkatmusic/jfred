// L6 run console mockup: a static popup over the timeline, built on first open. No requests, no timers.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import {
  RUN_CONSOLE_CANCEL_STATES,
  RUN_CONSOLE_OUTPUT_LINES,
  RUN_CONSOLE_STREAMING_CAPTION,
  RUN_CONSOLE_TERMINAL_STATES,
  type RunConsoleCancelState,
  type RunConsoleTerminalState,
} from "./layer1-run-console-data.ts";

const RUN_CONSOLE_ID = "run-console";

function buildCancelFrame(state: RunConsoleCancelState): HTMLElement {
  const button = createElement("button", { class: `cancel-btn ${state.className}`, text: state.label });
  (button as HTMLButtonElement).disabled = state.disabled;
  return createElement("div", { class: "state-frame" }, [createElement("span", { class: "state-label", text: state.key }), button]);
}

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
    createElement("strong", { text: "Run output: script still executing" }),
    createElement("button", { class: "run-console-close", text: "Close", onclick: closeRunConsole }),
  ]);
}

function buildRunConsoleOutput(): HTMLElement {
  return createElement("div", { class: "console-output" }, [
    createElement("pre", { class: "console-pre", text: RUN_CONSOLE_OUTPUT_LINES.join("\n") }),
    createElement("p", { class: "console-caption", text: RUN_CONSOLE_STREAMING_CAPTION }),
  ]);
}

function buildCancelRow(): HTMLElement {
  const frames: HTMLElement[] = [];
  for (const state of RUN_CONSOLE_CANCEL_STATES)
    frames.push(buildCancelFrame(state));
  return createElement("div", { class: "cancel-state-row" }, frames);
}

function buildTerminalRow(): HTMLElement {
  const blocks: HTMLElement[] = [];
  for (const state of RUN_CONSOLE_TERMINAL_STATES)
    blocks.push(buildTerminalBlock(state));
  return createElement("div", { class: "terminal-state-row" }, blocks);
}

function buildRunConsoleBody(): HTMLElement {
  return createElement("div", { class: "run-console-body" }, [
    buildRunConsoleOutput(),
    buildCancelRow(),
    createElement("p", { class: "state-caption", text: "Terminal states, shown as discrete static frames:" }),
    buildTerminalRow(),
  ]);
}

export function buildRunConsolePopup(): HTMLElement {
  return createElement("div", { id: RUN_CONSOLE_ID, class: "run-console", hidden: "" }, [buildRunConsoleHead(), buildRunConsoleBody()]);
}

export function openRunConsole(): void {
  const isBuilt = document.getElementById(RUN_CONSOLE_ID) !== null;
  if (!isBuilt)
    getRequiredElementById("stagewrap").append(buildRunConsolePopup());
  getRequiredElementById(RUN_CONSOLE_ID).hidden = false;
}

export function buildRunConsoleTrigger(): HTMLElement {
  const openButton = createElement("button", { class: "run-console-open", text: "Open run console", onclick: openRunConsole });
  return createElement("div", { class: "run-console-row" }, [openButton]);
}
