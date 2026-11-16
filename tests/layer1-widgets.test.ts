// Layer 1 pair bubble: a pair with no created-at node says so at the top of the bubble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { clearFileBubbles } from "../webapp/layer1-components/bubbles/layer1-file-bubbles-clear.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-components/bubbles/layer1-created-reason.ts";
import { ShowRowKind } from "../webapp/layer1-components/show-row/layer1-show-row.ts";
import { WireRecordKind }from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireOrphan, WirePair, WireSnapshot } from "../webapp/layer1-wire.ts";
import { WireScriptExecutorKind, type WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import { WireScriptLanguage } from "../webapp/layer1-components/details-drawer/layer1-script-language.ts";

initLayer1Dom();
const { buildStagePairs, buildOrphanBucket } = await import("../webapp/layer1-widgets.ts");
const { collectStageBubbles } = await import("../webapp/layer1-components/ruler/layer1-ruler-click.ts");
const { listAllEventsAtRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");

function buildPairWidget(pair: WirePair): HTMLElement {
  return buildStagePairs([pair])[0]!;
}

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };

function buildPair(overrides: Partial<WirePair>): WirePair {
  return { path: "src/run.ts", commits: [], onDisk: INSTANT, ...overrides };
}

test("test_a_pair_with_createdNotTrusted_shows_the_note_first_with_the_reason_as_title", () => {
  // Scenario: no created node, reason birthAfterFirstCommit: the note leads the filebox and its title is that reason's sentence.
  const filebox = buildPairWidget(buildPair({ createdNotTrusted: CreatedNotTrustedReason.birthAfterFirstCommit }));
  const note = filebox.querySelector(".created-untrusted");
  assert.equal(filebox.firstElementChild, note);
  assert.equal(note?.textContent, "creation time not trusted");
  assert.equal(note?.getAttribute("title"), "The birth time is later than the file's first commit.");
});

test("test_each_reason_has_its_own_title_sentence", () => {
  // Scenario: the three reasons give three different sentences.
  const titles = new Set<string | null | undefined>();
  for (const reason of Object.values(CreatedNotTrustedReason)) {
    const filebox = buildPairWidget(buildPair({ createdNotTrusted: reason }));
    titles.add(filebox.querySelector(".created-untrusted")?.getAttribute("title"));
  }
  assert.equal(titles.size, 3);
  assert.equal(titles.has(undefined), false);
});

const TOOL_USE = { id: "l7-tool-0", kind: WireRecordKind.toolUse, pairId: "toolu_fixture_l7_grep", label: "Grep", instant: "2026-06-02T08:00:00.000Z", axisPx: 10 };
const TOOL_RESULT = { ...TOOL_USE, id: "l7-tool-1", kind: WireRecordKind.toolResult, instant: "2026-06-02T08:30:00.000Z", axisPx: 20 };

test("test_a_pair_with_tool_nodes_draws_them_in_the_lane_and_startPx_includes_them", () => {
  // Scenario: tool nodes at 10 and 20 precede the disk node at 30, so the bubble starts at 10.
  const filebox = buildPairWidget(buildPair({ toolNodes: [TOOL_USE, TOOL_RESULT] }));
  assert.equal(filebox.style.getPropertyValue("--axis-px"), "10");
  const dots = filebox.querySelectorAll<HTMLElement>(".lane .tnode");
  assert.equal(dots.length, 2);
  assert.equal(dots[0]!.style.getPropertyValue("--axis-px"), "0");
  assert.equal(dots[1]!.style.getPropertyValue("--axis-px"), "10");
  assert.equal(filebox.querySelectorAll(".lane .tbracket").length, 1);
});

test("test_a_pair_without_tool_nodes_draws_none", () => {
  // Scenario: real data never sets toolNodes, so the lane holds no tool pieces.
  const filebox = buildPairWidget(buildPair({}));
  assert.equal(filebox.querySelector(".tnode, .tlabel, .tbracket"), null);
});

test("test_a_pair_with_a_created_node_shows_no_note", () => {
  // Scenario: created is set, so the bubble has no created-untrusted note.
  const filebox = buildPairWidget(buildPair({ created: INSTANT }));
  assert.equal(filebox.querySelector(".created-untrusted"), null);
});

const EARLY_ORPHAN = { path: "a/early.py", instant: "2026-06-02T08:00:00.000Z", axisPx: 100 };
const LATE_ORPHAN = { path: "b/late.py", instant: "2026-06-02T09:00:00.000Z", axisPx: 400 };
const SHARED_FIRST = { path: "c/first.py", instant: "2026-06-02T10:00:00.000Z", axisPx: 700 };
const SHARED_SECOND = { ...SHARED_FIRST, path: "c/second.py" };
const SHARED_THIRD = { ...SHARED_FIRST, path: "c/third.py" };

function listRowLines(bucket: HTMLElement): HTMLElement[] {
  return [...bucket.querySelectorAll<HTMLElement>(":scope > .orphan-rows > li")];
}

test("test_each_orphan_row_sits_at_its_own_instant_offset_from_the_bucket_start", () => {
  // Scenario: two files 300 px apart; the bucket starts at the first, the second row is 300 px below it.
  const bucket = buildOrphanBucket("No on-disk match", [EARLY_ORPHAN, LATE_ORPHAN])!;
  const lines = listRowLines(bucket);
  assert.deepEqual(lines.map((line) => line.style.getPropertyValue("--axis-px")), ["0", "300"]);
});

test("test_orphan_bucket_spans_from_its_earliest_row_to_its_latest_row", () => {
  // Scenario: absolutely placed rows add no height, so the row holder carries the span, as a pair's lane does.
  const bucket = buildOrphanBucket("No on-disk match", [EARLY_ORPHAN, LATE_ORPHAN])!;
  const rowHolder = bucket.querySelector<HTMLElement>(".orphan-rows")!;
  assert.equal(rowHolder.style.getPropertyValue("--span-px"), "300");
});

test("test_files_sharing_one_instant_draw_one_line_with_the_first_name_and_a_more_count", () => {
  // Scenario: three files at one instant make one line: first name, then "+2 more".
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, SHARED_SECOND, SHARED_THIRD])!;
  const lines = listRowLines(bucket);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.querySelector("span")?.textContent, "c/first.py");
  assert.equal(lines[0]!.querySelector("button")?.textContent, "+2 more");
});

test("test_a_file_alone_at_its_instant_has_no_more_button", () => {
  // Scenario: one file at an instant needs no "+N more".
  const bucket = buildOrphanBucket("No on-disk match", [EARLY_ORPHAN, LATE_ORPHAN])!;
  assert.equal(bucket.querySelector("button"), null);
});

test("test_clicking_more_shows_the_other_names_and_a_second_click_hides_them", () => {
  // Scenario: the other two names appear after one click and disappear after the next.
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, SHARED_SECOND, SHARED_THIRD])!;
  const moreButton = bucket.querySelector<HTMLElement>("button")!;
  const popup = bucket.querySelector<HTMLElement>(".more-files")!;
  assert.equal(popup.classList.contains("open"), false);
  moreButton.click();
  assert.equal(popup.classList.contains("open"), true);
  assert.deepEqual([...popup.querySelectorAll("li span")].map((name) => name.textContent), ["c/second.py", "c/third.py"]);
  moreButton.click();
  assert.equal(popup.classList.contains("open"), false);
});

test("test_every_file_at_a_shared_instant_is_found_by_the_ruler_row_lookup", () => {
  // Scenario: the ruler click lists the files drawn at 700 px; all three names must come back.
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, SHARED_SECOND, SHARED_THIRD])!;
  const container = document.getElementById("fileBubbleContainer")!;
  clearFileBubbles(container);
  container.append(bucket);
  const events = listAllEventsAtRow([SHARED_FIRST.axisPx], collectStageBubbles());
  assert.deepEqual(events.map((event) => event.path), ["c/first.py", "c/second.py", "c/third.py"]);
});

const NINE_AM = { instant: "2026-06-02T09:00:00.000Z", axisPx: 400 };
const TEN_AM = { instant: "2026-06-02T10:00:00.000Z", axisPx: 700 };
const EIGHT_AM = { instant: "2026-06-02T08:00:00.000Z", axisPx: 100 };

function buildSnapshot(when: { instant: string; axisPx: number }, version: number): WireSnapshot {
  return { ...when, version, sessionId: "session-a", sessionFile: "session-a.jsonl" };
}

function buildSnapshotOrphan(path: string, mtime: { instant: string; axisPx: number }, snapshots: WireSnapshot[]): WireOrphan {
  return { path, ...mtime, snapshots };
}

test("test_a_file_with_two_snapshots_draws_three_lines_at_their_offsets_each_showing_the_name", () => {
  // Scenario: mtime at 100 px, snapshots at 400 and 700 px; the bucket has one line per instant, 0/300/600 px below the start.
  const orphan = buildSnapshotOrphan("d/snap.py", EIGHT_AM, [buildSnapshot(NINE_AM, 1), buildSnapshot(TEN_AM, 2)]);
  const lines = listRowLines(buildOrphanBucket("No repository match", [orphan])!);
  assert.deepEqual(lines.map((line) => line.style.getPropertyValue("--axis-px")), ["0", "300", "600"]);
  assert.deepEqual(lines.map((line) => line.querySelector("span")?.textContent), ["d/snap.py", "d/snap.py", "d/snap.py"]);
});

test("test_a_snapshot_line_has_the_snapshot_class_and_dot_and_the_mtime_line_has_neither", () => {
  // Scenario: the snapshot line is hideable (n-snap) and shows a dot that is not a .node; the mtime line has neither.
  const orphan = buildSnapshotOrphan("d/snap.py", EIGHT_AM, [buildSnapshot(NINE_AM, 1)]);
  const [mtimeLine, snapshotLine] = listRowLines(buildOrphanBucket("No repository match", [orphan])!);
  assert.equal(snapshotLine!.classList.contains("n-snap"), true);
  assert.equal(snapshotLine!.querySelectorAll(".snap-dot").length, 1);
  assert.equal(snapshotLine!.querySelector(".node"), null);
  assert.equal(mtimeLine!.classList.contains("n-snap"), false);
  assert.equal(mtimeLine!.querySelector(".snap-dot"), null);
});

test("test_snapshots_of_two_files_at_one_instant_draw_one_line_with_a_more_count", () => {
  // Scenario: two files each have a snapshot at 700 px; those two make one line "+1 more", the two mtime lines stay single.
  const fileA = buildSnapshotOrphan("d/a.py", EIGHT_AM, [buildSnapshot(TEN_AM, 1)]);
  const fileB = buildSnapshotOrphan("d/b.py", NINE_AM, [buildSnapshot(TEN_AM, 1)]);
  const lines = listRowLines(buildOrphanBucket("No repository match", [fileA, fileB])!);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]!.querySelector("button"), null);
  assert.equal(lines[2]!.querySelector("button")?.textContent, "+1 more");
});

test("test_a_snapshot_before_the_earliest_mtime_moves_the_bucket_start_and_keeps_offsets_positive", () => {
  // Scenario: mtime at 400 px, snapshot at 100 px; the bucket starts at 100 and the mtime line is 300 below it.
  const orphan = buildSnapshotOrphan("d/snap.py", NINE_AM, [buildSnapshot(EIGHT_AM, 1)]);
  const bucket = buildOrphanBucket("No repository match", [orphan])!;
  assert.equal(bucket.style.getPropertyValue("--axis-px"), "100");
  const offsets = listRowLines(bucket).map((line) => Number(line.style.getPropertyValue("--axis-px")));
  assert.deepEqual(offsets, [0, 300]);
});

test("test_a_snapshot_after_the_latest_mtime_widens_the_bucket_span", () => {
  // Scenario: mtime at 400 px, snapshot at 700 px; the span is 300 px, not 0.
  const orphan = buildSnapshotOrphan("d/snap.py", NINE_AM, [buildSnapshot(TEN_AM, 1)]);
  const rowHolder = buildOrphanBucket("No repository match", [orphan])!.querySelector<HTMLElement>(".orphan-rows")!;
  assert.equal(rowHolder.style.getPropertyValue("--span-px"), "300");
});

test("test_the_file_count_text_counts_files_not_snapshots", () => {
  // Scenario: one file with two snapshots still says "1 files".
  const orphan = buildSnapshotOrphan("d/snap.py", EIGHT_AM, [buildSnapshot(NINE_AM, 1), buildSnapshot(TEN_AM, 2)]);
  const bucket = buildOrphanBucket("No repository match", [orphan])!;
  assert.equal(bucket.querySelector(".sub")?.textContent, "1 files");
});

test("test_a_snapshot_sharing_an_instant_with_an_mtime_shows_the_mtime_name_first_on_a_line_that_is_not_hideable", () => {
  // Scenario: a/snap.py has a snapshot at 700 px where c/first.py has its mtime; one line, c/first.py first, no n-snap on the line, n-snap inside the popup.
  const snapFile = buildSnapshotOrphan("a/snap.py", EIGHT_AM, [buildSnapshot(SHARED_FIRST, 1)]);
  const lines = listRowLines(buildOrphanBucket("No repository match", [snapFile, SHARED_FIRST])!);
  assert.equal(lines.length, 2);
  const sharedLine = lines[1]!;
  assert.equal(sharedLine.querySelector("span")?.textContent, "c/first.py");
  assert.equal(sharedLine.classList.contains("n-snap"), false);
  assert.equal(sharedLine.querySelector("button")?.textContent, "+1 more");
  const popupLine = sharedLine.querySelector<HTMLElement>(".more-files li")!;
  assert.equal(popupLine.querySelector("span")?.textContent, "a/snap.py");
  assert.equal(popupLine.classList.contains("n-snap"), true);
});

test("test_the_ruler_row_lookup_reports_a_snapshot_line_as_the_snapshot_kind", () => {
  // Scenario: the ruler click at 400 px finds the snapshot line, and its kind is snapshot so the show-row checkbox can hide it.
  const orphan = buildSnapshotOrphan("d/snap.py", EIGHT_AM, [buildSnapshot(NINE_AM, 1)]);
  const bucket = buildOrphanBucket("No repository match", [orphan])!;
  const container = document.getElementById("fileBubbleContainer")!;
  clearFileBubbles(container);
  container.append(bucket);
  const events = listAllEventsAtRow([NINE_AM.axisPx], collectStageBubbles());
  assert.deepEqual(events.map((event) => event.nodeKind), [ShowRowKind.snapshot]);
});

const ORPHAN_RUN_PATH = "scratch/disk_only_example.py";
const ORPHAN_RUN_HOLDER = "[data-component='bubbleOrphanScriptRunDots']";

function buildOrphanRun(toolUseId: string): WireScriptRun {
  return {
    toolUseId,
    executorKind: WireScriptExecutorKind.python,
    language: WireScriptLanguage.python,
    code: "print('fixture')",
    sessionId: "session-a",
    sessionFile: "session-a.jsonl",
    instant: "2026-06-02T09:30:00.000Z",
    axisPx: 550,
  };
}

function buildOrphanWithRuns(path: string, when: { instant: string; axisPx: number }, scriptRuns: WireScriptRun[]): WireOrphan {
  return { path, ...when, scriptRuns };
}

function countScriptDotsAtRow(axisPxList: number[], snapshot: ReturnType<typeof collectStageBubbles>): number {
  return listAllEventsAtRow(axisPxList, snapshot).filter((event) => event.element.matches("i.n-script")).length;
}

function collectBucketSnapshot(bucket: HTMLElement): ReturnType<typeof collectStageBubbles> {
  const container = document.getElementById("fileBubbleContainer")!;
  clearFileBubbles(container);
  container.append(bucket);
  return collectStageBubbles();
}

test("test_a_disk_orphan_row_shows_one_script_dot_per_run", () => {
  // Scenario: an orphan with two runs draws two script dots inside one holder that follows the instant text.
  // Steps:
  // build a bucket whose one orphan holds two runs.
  const orphan = buildOrphanWithRuns(ORPHAN_RUN_PATH, EIGHT_AM, [buildOrphanRun("toolu_fixture_orphan_1"), buildOrphanRun("toolu_fixture_orphan_2")]);
  const [row] = listRowLines(buildOrphanBucket("No repository match", [orphan])!);
  // the row holds two script dots.
  // RED: Expected values to be strictly equal: 0 !== 2
  assert.equal(row!.querySelectorAll("i.n-script").length, 2);
  // the dots sit in one holder with the holder class, and the holder comes right after the em.
  const holder = row!.querySelector<HTMLElement>(ORPHAN_RUN_HOLDER);
  assert.notEqual(holder, null);
  assert.equal(holder!.classList.contains("orphan-run-dots"), true);
  assert.equal(holder!.previousElementSibling, row!.querySelector("em"));
  assert.equal(holder!.querySelectorAll("i.n-script[data-component='laneScriptRunNode']").length, 2);
});

test("test_an_orphan_run_dot_has_the_run_end_class_of_its_run", () => {
  // Scenario: no result is stored for the run, so its dot carries the not-run end class right after the build.
  // Steps:
  // build a bucket whose orphan holds one run with no stored result.
  const orphan = buildOrphanWithRuns(ORPHAN_RUN_PATH, EIGHT_AM, [buildOrphanRun("toolu_fixture_orphan_run_end")]);
  const dot = buildOrphanBucket("No repository match", [orphan])!.querySelector<HTMLElement>("i.n-script");
  // the dot exists.
  // RED: the dot is missing, so notEqual fails with null !== null
  assert.notEqual(dot, null);
  // the dot has the class run-end-not-run.
  assert.equal(dot!.classList.contains("run-end-not-run"), true);
});

test("test_the_dot_keeps_the_data_attributes_the_connectors_read", () => {
  // Scenario: the connector code groups dots by data-tool-use-id; the dot and its label keep it and lose data-instant.
  // Steps:
  // build a bucket whose orphan holds one run.
  const orphan = buildOrphanWithRuns(ORPHAN_RUN_PATH, EIGHT_AM, [buildOrphanRun("toolu_fixture_orphan_attributes")]);
  const dot = buildOrphanBucket("No repository match", [orphan])!.querySelector<HTMLElement>("i.n-script");
  // the dot exists.
  // RED: the dot is missing, so notEqual fails with null !== null
  assert.notEqual(dot, null);
  // the dot keeps data-tool-use-id, which layer1-script-connectors.ts reads as dataset.toolUseId.
  assert.equal(dot!.getAttribute("data-tool-use-id"), "toolu_fixture_orphan_attributes");
  // the dot has no data-instant.
  assert.equal(dot!.hasAttribute("data-instant"), false);
  // the label beside the dot keeps data-tool-use-id and has no data-instant.
  const label = dot!.nextElementSibling!;
  assert.equal(label.matches("span.nlabel.n-script"), true);
  assert.equal(label.getAttribute("data-tool-use-id"), "toolu_fixture_orphan_attributes");
  assert.equal(label.hasAttribute("data-instant"), false);
});

test("test_a_tick_at_the_first_instant_of_the_bucket_does_not_list_the_orphan_run", () => {
  // Scenario: the run's dot sits on the row at 400 px; a tick at the first row (100 px) lists no dot and a tick at 400 px lists exactly one.
  // Steps:
  // build a bucket with a plain row at 100 px and a row with one run at 400 px, and put it on the stage.
  const runOrphan = buildOrphanWithRuns(ORPHAN_RUN_PATH, NINE_AM, [buildOrphanRun("toolu_fixture_orphan_tick")]);
  const bucket = buildOrphanBucket("No repository match", [EARLY_ORPHAN, runOrphan])!;
  const snapshot = collectBucketSnapshot(bucket);
  // the tick at the dot's own row lists exactly one dot (the li row is an event too, so only dots are counted).
  // RED: Expected values to be strictly equal: 0 !== 1
  assert.equal(countScriptDotsAtRow([NINE_AM.axisPx], snapshot), 1);
  // the tick at the first row lists no dot.
  assert.equal(countScriptDotsAtRow([EIGHT_AM.axisPx], snapshot), 0);
  // the dot's axis offset is its row's own offset from the bucket start.
  assert.equal(bucket.querySelector<HTMLElement>("i.n-script")!.style.getPropertyValue("--axis-px"), "300");
});

test("test_one_run_on_two_rows_at_different_instants_is_listed_once_per_tick", () => {
  // Scenario: one run is drawn on two rows; each tick lists its own dot only, and neither dot has data-instant.
  // Steps:
  // build a bucket of two orphans at 100 px and 400 px that hold the same run, and put it on the stage.
  const sharedRun = buildOrphanRun("toolu_fixture_orphan_shared");
  const firstOrphan = buildOrphanWithRuns("scratch/disk_only_a.py", EIGHT_AM, [sharedRun]);
  const secondOrphan = buildOrphanWithRuns("scratch/disk_only_b.py", NINE_AM, [sharedRun]);
  const bucket = buildOrphanBucket("No repository match", [firstOrphan, secondOrphan])!;
  const snapshot = collectBucketSnapshot(bucket);
  // the tick at the first row lists one dot.
  // RED: Expected values to be strictly equal: 0 !== 1
  assert.equal(countScriptDotsAtRow([EIGHT_AM.axisPx], snapshot), 1);
  // the tick at the second row lists one dot.
  assert.equal(countScriptDotsAtRow([NINE_AM.axisPx], snapshot), 1);
  // neither dot has data-instant.
  const dots = [...bucket.querySelectorAll("i.n-script")];
  assert.equal(dots.length, 2);
  assert.deepEqual(dots.map((dot) => dot.hasAttribute("data-instant")), [false, false]);
});

test("test_the_more_files_popup_rows_show_their_dots_too", () => {
  // Scenario: three files share one instant; the second one, listed in the "+2 more" popup, has a run and shows its dot there.
  // Steps:
  // build a bucket where the second file of the shared instant holds one run.
  const runOrphan = buildOrphanWithRuns(SHARED_SECOND.path, SHARED_SECOND, [buildOrphanRun("toolu_fixture_orphan_popup")]);
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, runOrphan, SHARED_THIRD])!;
  const popup = bucket.querySelector<HTMLElement>(".more-files")!;
  // the popup holds one script dot.
  // RED: Expected values to be strictly equal: 0 !== 1
  assert.equal(popup.querySelectorAll("i.n-script").length, 1);
  // the dot sits in a holder inside the popup row of the second file.
  const popupRow = popup.querySelector<HTMLElement>("li")!;
  assert.equal(popupRow.querySelector("span")?.textContent, SHARED_SECOND.path);
  assert.notEqual(popupRow.querySelector(ORPHAN_RUN_HOLDER), null);
  // the first file's own row has no holder.
  assert.equal(listRowLines(bucket)[0]!.querySelector(":scope > " + ORPHAN_RUN_HOLDER), null);
});

test("test_a_disk_orphan_without_runs_has_no_holder", () => {
  // Scenario: guard, passes before and after: an orphan with no scriptRuns field and an orphan with an empty list draw no holder.
  // Steps:
  // build a bucket with one orphan that has no scriptRuns field and one whose scriptRuns is empty.
  const emptyRunsOrphan = buildOrphanWithRuns(ORPHAN_RUN_PATH, NINE_AM, []);
  const bucket = buildOrphanBucket("No repository match", [EARLY_ORPHAN, emptyRunsOrphan])!;
  // neither row has a holder, and the bucket has no script dot.
  assert.equal(bucket.querySelector(ORPHAN_RUN_HOLDER), null);
  assert.equal(bucket.querySelector("i.n-script"), null);
});
