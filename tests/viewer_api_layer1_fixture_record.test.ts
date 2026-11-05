import assert from "node:assert/strict";
import { test } from "node:test";
import { findFixtureLineRecord } from "../src/viewer_api_layer1_fixture_record.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { SNAPSHOTS } from "../src/viewer_api_layer2_fixture_data.ts";
import { EDITS } from "../src/viewer_api_layer3_fixture_data.ts";
import { SCRIPT_RUNS } from "../src/viewer_api_layer4_fixture_data.ts";

test("test_a_snapshot_line_finds_a_file_history_snapshot_record", () => {
  // Steps: take the first snapshot, look up its session and line, expect its path in the record.
  const snapshot = SNAPSHOTS[0]!;
  const record = findFixtureLineRecord(snapshot.session, snapshot.line) as { type: string; snapshot: object };
  assert.equal(record.type, "file-history-snapshot");
  assert.ok(snapshot.path in (record.snapshot as { trackedFileBackups: object }).trackedFileBackups);
});

test("test_a_script_run_line_finds_an_assistant_record_with_the_script_code", () => {
  // Steps: take the first script run, look up its session and line, expect its code in the command.
  const run = SCRIPT_RUNS[0]!;
  const record = findFixtureLineRecord(run.session, run.line) as { type: string };
  assert.equal(record.type, "assistant");
  assert.ok(JSON.stringify(record).includes(JSON.stringify(run.code.join("\n")).slice(1, -1)));
});

test("test_an_edit_line_finds_a_record_naming_the_edit_change_id", () => {
  // Steps: take the first edit, look up its session and line, expect its change id in the record.
  const edit = EDITS[0]!;
  assert.ok(JSON.stringify(findFixtureLineRecord(edit.session, edit.line)).includes(edit.changeId));
});

test("test_an_annotation_line_finds_a_record_with_its_label", () => {
  // Steps: take the first annotation, look up its session file name and line, expect its label.
  const annotation = buildFixtureLayer1View().annotations![0]!;
  const session = annotation.sessionFile.split("/").pop()!;
  const record = findFixtureLineRecord(session, annotation.line) as { message: { content: string } };
  assert.equal(record.message.content, annotation.label);
});

test("test_an_unowned_line_finds_nothing", () => {
  // Steps: look up a line that no fixture entry owns.
  assert.equal(findFixtureLineRecord("0f3c9a7e.jsonl", 999999), undefined);
});
