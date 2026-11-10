import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, symlinkSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";

import type { Path } from "../src/structures/domain.ts";
import { scanWatchedFolders } from "./engineV3_replay_snapshot_scan.ts";
import { ChangeKind, listChangesSinceLastScan, type FileChange } from "./engineV3_replay_snapshot.ts";
import { makeTempFolder, writeFileIn } from "./engineV3_replay_snapshot_testing.ts";

function listChangesAfter(folder: Path, skipFolder: Path, makeChange: () => void): FileChange[] {
  const previous = scanWatchedFolders([folder], [skipFolder],new Map());
  makeChange();
  return listChangesSinceLastScan(previous, scanWatchedFolders([folder], [skipFolder],previous));
}

test("test_listChangesSinceLastScan_marks_a_new_file_as_added", (t) => {
  // Scenario: a file that appears between two scans is "added" with its hash.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // scan an empty folder, write a.txt, scan again
  let filePath = "";
  const changes = listChangesAfter(folder, skipFolder, () => {
    filePath = writeFileIn(folder, "a.txt", "hello");
  });
  // one change: a.txt added, with a content hash
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.path, filePath);
  assert.equal(changes[0]!.change, ChangeKind.Added);
  assert.match(changes[0]!.contentHash!, /^sha256:[0-9a-f]{64}$/);
});

test("test_listChangesSinceLastScan_marks_a_removed_file_as_deleted", (t) => {
  // Scenario: a file that disappears between two scans is "deleted" with no other fields.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // write a.txt, scan, remove a.txt, scan again
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const changes = listChangesAfter(folder, skipFolder, () => unlinkSync(filePath));
  // one change: a.txt deleted
  assert.deepEqual(changes, [{ path: filePath, change: ChangeKind.Deleted }]);
});

test("test_listChangesSinceLastScan_marks_a_file_with_new_content_as_modified", (t) => {
  // Scenario: a file whose content changes is "modified" with the new hash.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // write a.txt, scan, write new content with a new mtime, scan again
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const changes = listChangesAfter(folder, skipFolder, () => {
    writeFileIn(folder, "a.txt", "changed");
    utimesSync(filePath, new Date(2020, 0, 1), new Date(2020, 0, 1));
  });
  // one change: a.txt modified
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, ChangeKind.Modified);
});

test("test_listChangesSinceLastScan_ignores_a_file_touched_with_the_same_content", (t) => {
  // Scenario: a rewrite with identical content and a new mtime is not a change.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // write a.txt, scan, write the same content with a new mtime, scan again
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const changes = listChangesAfter(folder, skipFolder, () => {
    writeFileIn(folder, "a.txt", "hello");
    utimesSync(filePath, new Date(2020, 0, 1), new Date(2020, 0, 1));
  });
  // no changes
  assert.deepEqual(changes, []);
});

test("test_listChangesSinceLastScan_records_a_symlink_target", (t) => {
  // Scenario: a new symlink is "added" with its target text and no hash.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // scan, make a link to "../eslint/bin/eslint.js", scan again
  const linkPath = join(folder.toString(), "eslint");
  const changes = listChangesAfter(folder, skipFolder, () => symlinkSync("../eslint/bin/eslint.js", linkPath));
  // the change holds the target and no content hash
  assert.deepEqual(changes, [{ path: linkPath, change: ChangeKind.Added, symlinkTarget: "../eslint/bin/eslint.js" }]);
});

test("test_listChangesSinceLastScan_records_a_mode_change", (t) => {
  // Scenario: chmod with the same content is "modified" with the new mode.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // write a.txt, scan, chmod 755, scan again
  const filePath = writeFileIn(folder, "a.txt", "hello");
  const changes = listChangesAfter(folder, skipFolder, () => chmodSync(filePath, 0o755));
  // one change: modified, mode 755
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, ChangeKind.Modified);
  assert.equal(changes[0]!.mode, "755");
});

test("test_listChangesSinceLastScan_reports_a_kind_change_as_one_modified_entry", (t) => {
  // Scenario: a file replaced by a folder of the same name is one "modified" entry with the folder's fields.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // write thing as a file, scan, replace it with an empty folder, scan again
  const thingPath = writeFileIn(folder, "thing", "hello");
  const changes = listChangesAfter(folder, skipFolder, () => {
    unlinkSync(thingPath);
    mkdirSync(thingPath);
  });
  // one change: modified, directory true, no hash
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, ChangeKind.Modified);
  assert.equal(changes[0]!.directory, true);
  assert.equal(changes[0]!.contentHash, undefined);
});

test("test_listChangesSinceLastScan_sorts_a_deleted_folder_after_its_contents", (t) => {
  // Scenario: the entry for a deleted folder comes after the deletions inside it, and before a later sibling name.
  const folder = makeTempFolder(t, "snap-changes-");
  const skipFolder = makeTempFolder(t, "snap-skip-");
  // write dir/a.txt and dir/b.txt, scan, remove dir, add dir-x.txt, scan again
  writeFileIn(folder, "dir/a.txt", "a");
  writeFileIn(folder, "dir/b.txt", "b");
  const changes = listChangesAfter(folder, skipFolder, () => {
    rmSync(join(folder.toString(), "dir"), { recursive: true });
    writeFileIn(folder, "dir-x.txt", "x");
  });
  // the order is dir/a.txt, dir/b.txt, dir, dir-x.txt
  const names: string[] = [];
  for (const change of changes) {
    names.push(change.path.slice(folder.toString().length + 1));
  }
  assert.deepEqual(names, ["dir/a.txt", "dir/b.txt", "dir", "dir-x.txt"]);
});
