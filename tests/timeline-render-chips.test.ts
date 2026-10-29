// DOM tests for webapp/views/timeline-render-chips.ts: chip letters, active-chip state, and the button row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import type { FileChange } from "../webapp/views/timeline-node-types.ts";
import type { TimelineRenderContext } from "../webapp/views/timeline-render-context.ts";

async function importChipsInFreshDom(): Promise<typeof import("../webapp/views/timeline-render-chips.ts")> {
  initWebappDom();
  return import("../webapp/views/timeline-render-chips.ts");
}

function buildChange(overrides: Partial<FileChange>): FileChange {
  return { path: "/a/b.ts", displayPath: "/a/b.ts", eventKind: "edit", renamedFrom: undefined, isFirstRevision: false, changeId: undefined, when: "2026-01-01T00:00:00Z", ...overrides };
}

function buildContext(): TimelineRenderContext {
  return { activeChip: null, chipLineLocations: new Map() } as unknown as TimelineRenderContext;
}

function readBadgeLetter(row: HTMLElement): string {
  return row.querySelector(".op-badge")!.textContent!;
}

test("test_renderFileButtonRow_letters_a_first_write_and_m_a_later_edit", async () => {
  // Scenario: a first-revision write shows badge A; any other edit shows M.
  const { renderFileButtonRow } = await importChipsInFreshDom();
  const pane = document.createElement("div");
  const firstWrite = renderFileButtonRow(buildContext(), {} as never, 0, buildChange({ eventKind: "write", isFirstRevision: true }), pane);
  const laterWrite = renderFileButtonRow(buildContext(), {} as never, 0, buildChange({ eventKind: "write" }), pane);
  assert.equal(readBadgeLetter(firstWrite), "A");
  assert.equal(readBadgeLetter(laterWrite), "M");
});

test("test_renderFileButtonRow_shows_old_to_new_name_for_a_rename", async () => {
  // Scenario: a rename chip names the file as "old → new" using base names.
  const { renderFileButtonRow } = await importChipsInFreshDom();
  const row = renderFileButtonRow(buildContext(), {} as never, 0, buildChange({ eventKind: "rename", renamedFrom: "/a/old.ts", displayPath: "/a/new.ts" }), document.createElement("div"));
  assert.equal(readBadgeLetter(row), "R");
  assert.equal(row.querySelector(".timeline-chip")!.textContent, "Rold.ts → new.ts");
});

test("test_renderFileButtonRow_without_changeId_has_only_chip_and_time", async () => {
  // Scenario: a change with no changeId gets no action buttons.
  const { renderFileButtonRow } = await importChipsInFreshDom();
  const row = renderFileButtonRow(buildContext(), {} as never, 0, buildChange({}), document.createElement("div"));
  assert.equal(row.querySelectorAll(".timeline-chip").length, 1);
  assert.equal(row.querySelectorAll(".timeline-time").length, 1);
});

test("test_markChipActive_moves_the_active_class_and_clearActiveChip_removes_it", async () => {
  // Scenario: marking a second chip clears the first; clearing leaves none active.
  const { markChipActive, clearActiveChip } = await importChipsInFreshDom();
  const context = buildContext();
  const firstChip = document.createElement("span");
  const secondChip = document.createElement("span");
  markChipActive(context, firstChip);
  markChipActive(context, secondChip);
  assert.ok(!firstChip.classList.contains("active"));
  assert.ok(secondChip.classList.contains("active"));
  clearActiveChip(context);
  assert.ok(!secondChip.classList.contains("active"));
  assert.equal(context.activeChip, null);
});
