// Test for webapp/layer1-jfred-message.ts: the commit message text and the per-file snapshot lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { FOOTNOTE_PREFIX, buildCommitMessage, listSnapLines } = await import("../webapp/layer1-jfred-message.ts");

const MARK = "2026-06-03T10:30:00Z";
const WALL_CLOCK = "2026-11-03T12:00:00Z";
const SNAP_LINES = ["src/index.ts: @v2 at 2026-06-01T09:05:00Z", "src/util.ts: 0a1b2c3d at 2026-06-02T08:00:00Z"];

function buildMessage(skippedCount: number, snapLines: string[] = SNAP_LINES): string {
  return buildCommitMessage({ markInstant: MARK, skippedCount, snapLines, wallClock: WALL_CLOCK });
}

test("test_message_with_zero_skipped_has_no_includes_line", () => {
  // Verify: N = 0 prints no includes line.
  assert.equal(buildMessage(0).includes("includes"), false);
});

test("test_message_with_one_skipped_prints_the_literal_phrase", () => {
  // Verify: N = 1 uses the plural phrase unchanged.
  assert.equal(buildMessage(1).split("\n")[2], "includes 1 unmarked changes");
});

test("test_message_has_the_exact_shape", () => {
  // Verify: subject, includes, files, dates, footnote, separated by blank lines.
  assert.equal(
    buildMessage(2),
    [
      "jfred: reconstruct to 2026-06-03T10:30:00Z",
      "",
      "includes 2 unmarked changes",
      "",
      ...SNAP_LINES,
      "",
      "Author-Date: 2026-06-03T10:30:00Z",
      "Commit-Date: 2026-11-03T12:00:00Z",
      "reconstructed by JFRED @ 2026-11-03T12:00:00Z",
    ].join("\n"),
  );
});

test("test_message_without_includes_has_one_blank_line_after_the_subject", () => {
  // Verify: no double blank line when N = 0.
  const lines = buildMessage(0).split("\n");
  assert.deepEqual(lines.slice(0, 3), ["jfred: reconstruct to 2026-06-03T10:30:00Z", "", SNAP_LINES[0]]);
});

test("test_last_line_is_the_footnote", () => {
  // Verify: the footnote always ends the message.
  assert.equal(buildMessage(0).split("\n").at(-1), `${FOOTNOTE_PREFIX}${WALL_CLOCK}`);
});

function addFile(path: string, nodes: { cls: string; instant: string; label: string }[]): void {
  const box = document.createElement("div");
  box.className = "filebox";
  const name = document.createElement("span");
  name.className = "fname";
  name.dataset["path"] = path;
  box.append(name);
  for (const node of nodes) {
    const dot = document.createElement("i");
    dot.className = `node ${node.cls}`;
    dot.dataset["instant"] = node.instant;
    const label = document.createElement("span");
    label.className = "nlabel";
    label.textContent = node.label;
    box.append(dot, label);
  }
  document.getElementById("stage")!.append(box);
}

test("test_snap_lines_take_the_latest_beacon_at_or_before_the_mark", () => {
  // Verify: a later node is skipped, the latest earlier one wins, the line has path, label and instant.
  initLayer1Dom();
  addFile("a.ts", [
    { cls: "n-commit", instant: "2026-06-01T00:00:00Z", label: "aaaaaaaa" },
    { cls: "n-snap", instant: "2026-06-02T00:00:00Z", label: "@v3" },
    { cls: "n-snap", instant: "2026-06-04T00:00:00Z", label: "@v4" },
  ]);
  assert.deepEqual(listSnapLines(Date.parse(MARK)), ["a.ts: @v3 at 2026-06-02T00:00:00Z"]);
});

test("test_snap_lines_leave_out_a_file_with_no_beacon_at_or_before_the_mark", () => {
  // Verify: later-only and created-only files are absent.
  initLayer1Dom();
  addFile("late.ts", [{ cls: "n-snap", instant: "2026-06-09T00:00:00Z", label: "@v1" }]);
  addFile("born.ts", [{ cls: "n-disk n-created", instant: "2026-06-01T00:00:00Z", label: "created at" }]);
  addFile("ok.ts", [{ cls: "n-disk", instant: "2026-06-01T00:00:00Z", label: "on disk" }]);
  assert.deepEqual(listSnapLines(Date.parse(MARK)), ["ok.ts: on disk at 2026-06-01T00:00:00Z"]);
});

test("test_snap_lines_skip_a_box_without_a_path", () => {
  // Verify: a bucket box has no fname path, so it adds no line.
  initLayer1Dom();
  const bucket = document.createElement("div");
  bucket.className = "filebox";
  document.getElementById("stage")!.append(bucket);
  assert.deepEqual(listSnapLines(Date.parse(MARK)), []);
});
