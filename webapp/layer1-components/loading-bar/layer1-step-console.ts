// Task 893: the step console. One row per server step; hosts are `[data-step-console]` elements.

import { createElement } from "../../app-dom.ts";

export enum StepState { waiting = "waiting", running = "running", done = "done" }
export enum StepConsoleScope { view = "view", popup = "popup" }
export interface StepLine { label: string; current?: number; total?: number; steps?: string[] }
export interface StepRow { label: string; state: StepState; current?: number; total?: number }

let rows: StepRow[] = [];
let currentScope: StepConsoleScope = StepConsoleScope.popup;

export function resetStepConsole(scope: StepConsoleScope): void {
  rows = [];
  currentScope = scope;
  paintStepConsoleHosts();
}

export function listStepRows(): readonly StepRow[] {
  return rows;
}

function findStepRow(label: string): StepRow | undefined {
  return rows.find((row) => row.label === label);
}

function appendWaitingRowsForPlan(plannedLabels: readonly string[]): void {
  for (const plannedLabel of plannedLabels) {
    if (findStepRow(plannedLabel) === undefined)
      rows.push({ label: plannedLabel, state: StepState.waiting });
  }
}

function finishRunningRowsExcept(keptRow: StepRow | undefined): void {
  for (const row of rows) {
    if (row !== keptRow) {
      if (row.state === StepState.running)
        row.state = StepState.done;
    }
  }
}

function recordStepLine(line: StepLine): void {
  if (line.steps !== undefined)
    appendWaitingRowsForPlan(line.steps);
  let lineRow = findStepRow(line.label);
  if (lineRow === undefined) {
    lineRow = { label: line.label, state: StepState.waiting };
    rows.push(lineRow);
  }
  finishRunningRowsExcept(lineRow);
  lineRow.state = StepState.running;
  if (line.current !== undefined)
    lineRow.current = line.current;
  if (line.total !== undefined)
    lineRow.total = line.total;
}

export function recordStepLines(lines: readonly StepLine[]): void {
  for (const line of lines)
    recordStepLine(line);
}

export function finishStepConsole(): void {
  finishRunningRowsExcept(undefined);
}

export function formatStepStatus(row: StepRow): string {
  if (row.state === StepState.waiting)
    return "waiting";
  if (row.state === StepState.running) {
    if (row.total !== undefined) {
      if (row.total > 0) {
        if (row.current !== undefined)
          return `${row.current} of ${row.total}`;
      }
    }
    return "working";
  }
  if (row.total !== undefined)
    return `done (${row.total})`;
  return "done";
}

function buildStepRowElement(row: StepRow): HTMLElement {
  const label = createElement("span", { class: "step-label", "data-component": "stepConsoleLabelText", text: row.label });
  const status = createElement("span", { class: "step-status", "data-component": "stepConsoleStatusText", text: formatStepStatus(row) });
  const rowClass = row.state === StepState.done ? "step-row step-done" : "step-row";
  return createElement("div", { class: rowClass, "data-component": "stepConsoleRow" }, [label, status]);
}

export function paintStepConsoleHosts(): void {
  const hosts = document.querySelectorAll("[data-step-console]");
  for (const host of hosts) {
    if (host.getAttribute("data-step-console") === currentScope)
      host.replaceChildren(...rows.map(buildStepRowElement));
    else
      host.replaceChildren();
  }
}
