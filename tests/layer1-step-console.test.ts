// Task 893: the step console keeps one row per server step and paints it into matching hosts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StepConsoleScope,
  StepState,
  finishStepConsole,
  formatStepStatus,
  listStepRows,
  paintStepConsoleHosts,
  recordStepLines,
  resetStepConsole,
} from "../webapp/layer1-components/loading-bar/layer1-step-console.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function readRowStates(): StepState[] {
  return listStepRows().map((row) => row.state);
}

function addHost(scope: StepConsoleScope): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-step-console", scope);
  document.body.append(host);
  return host;
}

test("test_plan_line_makes_waiting_rows_in_plan_order", () => {
  initLayer1Dom();
  // Start from an empty console.
  resetStepConsole(StepConsoleScope.view);
  // A line with a plan and no label row yet.
  recordStepLines([{ label: "read git commits", steps: ["read git commits", "read chat logs", "build timeline"] }]);
  // All three plan labels exist in plan order.
  assert.deepEqual(listStepRows().map((row) => row.label), ["read git commits", "read chat logs", "build timeline"]);
  // Only the first one is running; the rest wait.
  assert.deepEqual(readRowStates(), [StepState.running, StepState.waiting, StepState.waiting]);
});

test("test_line_for_waiting_row_makes_it_running_with_its_count", () => {
  initLayer1Dom();
  resetStepConsole(StepConsoleScope.view);
  // Plan has two steps.
  recordStepLines([{ label: "read git commits", steps: ["read git commits", "read chat logs"] }]);
  // A line arrives for the second step with a count.
  recordStepLines([{ label: "read chat logs", current: 183, total: 950 }]);
  // That row is running and holds the count.
  const chatLogsRow = listStepRows()[1]!;
  assert.equal(chatLogsRow.state, StepState.running);
  assert.equal(chatLogsRow.current, 183);
  assert.equal(chatLogsRow.total, 950);
});

test("test_new_label_turns_earlier_running_row_done", () => {
  initLayer1Dom();
  resetStepConsole(StepConsoleScope.view);
  // Two steps run one after the other.
  recordStepLines([{ label: "read git commits", current: 1, total: 2 }]);
  recordStepLines([{ label: "read chat logs", current: 1, total: 5 }]);
  // The first row is done; the second is running.
  assert.deepEqual(readRowStates(), [StepState.done, StepState.running]);
});

test("test_line_without_counts_keeps_old_counts", () => {
  initLayer1Dom();
  resetStepConsole(StepConsoleScope.view);
  recordStepLines([{ label: "read chat logs", current: 4, total: 9 }]);
  // A second line for the same label has no counts.
  recordStepLines([{ label: "read chat logs" }]);
  // The old counts stay.
  const chatLogsRow = listStepRows()[0]!;
  assert.equal(chatLogsRow.current, 4);
  assert.equal(chatLogsRow.total, 9);
});

test("test_finish_turns_running_rows_done_and_leaves_waiting_rows", () => {
  initLayer1Dom();
  resetStepConsole(StepConsoleScope.view);
  recordStepLines([{ label: "read git commits", steps: ["read git commits", "read chat logs"] }]);
  finishStepConsole();
  assert.deepEqual(readRowStates(), [StepState.done, StepState.waiting]);
});

test("test_format_status_for_waiting_row", () => {
  assert.equal(formatStepStatus({ label: "a", state: StepState.waiting }), "waiting");
});

test("test_format_status_for_running_row_with_total", () => {
  assert.equal(formatStepStatus({ label: "a", state: StepState.running, current: 183, total: 950 }), "183 of 950");
});

test("test_format_status_for_running_row_without_count", () => {
  assert.equal(formatStepStatus({ label: "a", state: StepState.running }), "working");
});

test("test_format_status_for_done_row_with_total", () => {
  assert.equal(formatStepStatus({ label: "a", state: StepState.done, current: 412, total: 412 }), "done (412)");
});

test("test_format_status_for_done_row_without_total", () => {
  assert.equal(formatStepStatus({ label: "a", state: StepState.done }), "done");
});

test("test_paint_fills_only_the_host_whose_scope_matches", () => {
  initLayer1Dom();
  const viewHost = addHost(StepConsoleScope.view);
  const popupHost = addHost(StepConsoleScope.popup);
  // Scope is view; one running row.
  resetStepConsole(StepConsoleScope.view);
  recordStepLines([{ label: "read chat logs", current: 183, total: 950 }]);
  paintStepConsoleHosts();
  // The view host shows the row text; the popup host stays empty.
  assert.equal(viewHost.querySelectorAll(".step-row").length, 1);
  assert.equal(viewHost.querySelector(".step-label")!.textContent, "read chat logs");
  assert.equal(viewHost.querySelector(".step-status")!.textContent, "183 of 950");
  assert.equal(popupHost.children.length, 0);
});

test("test_paint_empties_a_host_when_the_scope_changes", () => {
  initLayer1Dom();
  const viewHost = addHost(StepConsoleScope.view);
  resetStepConsole(StepConsoleScope.view);
  recordStepLines([{ label: "read chat logs" }]);
  paintStepConsoleHosts();
  assert.equal(viewHost.children.length, 1);
  // The scope moves to popup, so the view host must empty.
  resetStepConsole(StepConsoleScope.popup);
  assert.equal(viewHost.children.length, 0);
});

test("test_paint_with_no_hosts_does_not_throw", () => {
  initLayer1Dom();
  resetStepConsole(StepConsoleScope.view);
  assert.doesNotThrow(() => paintStepConsoleHosts());
});

test("test_reset_empties_rows_and_repaints", () => {
  initLayer1Dom();
  const viewHost = addHost(StepConsoleScope.view);
  resetStepConsole(StepConsoleScope.view);
  recordStepLines([{ label: "read chat logs" }]);
  paintStepConsoleHosts();
  assert.equal(viewHost.children.length, 1);
  resetStepConsole(StepConsoleScope.view);
  assert.equal(listStepRows().length, 0);
  assert.equal(viewHost.children.length, 0);
});
