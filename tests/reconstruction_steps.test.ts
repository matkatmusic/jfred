import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRepoStateAtTime, computeFilesAtStep } from "../src/reconstruction_steps.ts";
import type { FileHistory, FileRevision } from "../src/reconstruction_events.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

const OLD_PATH = new Path("/repo/old.txt");
const NEW_PATH = new Path("/repo/new.txt");
const WRITE_TIME = new Date("2026-01-01T00:00:00.000Z");
const RENAME_TIME = new Date("2026-01-01T00:00:01.000Z");

function createRevision(kind: EventKind, timestamp: Date, text: string): FileRevision {
  return {
    kind,
    changeId: new Uuid(`id-${timestamp.getTime()}`),
    timestamp,
    lines: [{ oldLineNum: 0, values: [{ line: text, timestamp }] }],
  };
}

function createRenamedHistory(): FileHistory {
  const renameRevision = createRevision(EventKind.rename, RENAME_TIME, "hello");
  renameRevision.rename = { from: OLD_PATH, to: NEW_PATH };
  return {
    target: NEW_PATH,
    revisions: [createRevision(EventKind.write, WRITE_TIME, "hello"), renameRevision],
  };
}

test("test_computeRepoStateAtTime_keys_a_file_by_its_old_name_before_a_rename", () => {
  const snapshot = computeRepoStateAtTime([createRenamedHistory()], WRITE_TIME);
  assert.deepEqual([...snapshot.keys()].map(String), ["/repo/old.txt"]);
});

test("test_computeRepoStateAtTime_keys_a_file_by_its_new_name_after_a_rename", () => {
  const snapshot = computeRepoStateAtTime([createRenamedHistory()], RENAME_TIME);
  assert.deepEqual([...snapshot.keys()].map(String), ["/repo/new.txt"]);
});

test("test_computeRepoStateAtTime_omits_a_file_not_yet_written", () => {
  const before = new Date("2025-12-31T00:00:00.000Z");
  const snapshot = computeRepoStateAtTime([createRenamedHistory()], before);
  assert.equal(snapshot.size, 0);
});

test("test_computeFilesAtStep_returns_path_strings_mapped_to_text", () => {
  const files = computeFilesAtStep([createRenamedHistory()], RENAME_TIME);
  assert.deepEqual(files, { "/repo/new.txt": "hello" });
});
