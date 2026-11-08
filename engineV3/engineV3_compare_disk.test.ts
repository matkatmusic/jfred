import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { compareStateToDisk } from "./engineV3_compare_disk.ts";

type Folders = { stateFolder: string; diskFolder: string; touchedFile: string };

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function writeFileIn(folder: string, name: string, content: string): void {
    const filePath = join(folder, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}

function makeFolders(t: TestContext, touchedPaths: string[]): Folders {
    const stateFolder = makeTempFolder(t, "engine-v3-disk-state-");
    const diskFolder = makeTempFolder(t, "engine-v3-disk-disk-");
    const touchedFile = join(makeTempFolder(t, "engine-v3-disk-touched-"), "touched-paths.txt");
    writeFileSync(touchedFile, touchedPaths.join("\n") + "\n");
    return { stateFolder, diskFolder, touchedFile };
}

function compareFolders(folders: Folders): string[] {
    return compareStateToDisk(new Path(folders.stateFolder), new Path(folders.diskFolder), new Path(folders.touchedFile));
}

test("test_compareStateToDisk_counts_a_file_with_the_same_bytes_as_same", (t) => {
    // Scenario: a.txt has the same bytes in both folders, so only the summary line is printed.
    const folders = makeFolders(t, ["a.txt"]);
    writeFileIn(folders.stateFolder, "a.txt", "a");
    writeFileIn(folders.diskFolder, "a.txt", "a");
    // compare the touched paths
    const lines = compareFolders(folders);
    assert.deepEqual(lines, [`check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 1 same`]);
});

test("test_compareStateToDisk_lists_a_file_with_different_bytes", (t) => {
    // Scenario: a.txt has other bytes in the state folder, so it is listed as different.
    const folders = makeFolders(t, ["a.txt"]);
    writeFileIn(folders.stateFolder, "a.txt", "state");
    writeFileIn(folders.diskFolder, "a.txt", "disk");
    const lines = compareFolders(folders);
    assert.deepEqual(lines, ["different content: a.txt", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 1 different, 0 same`]);
});

test("test_compareStateToDisk_lists_a_file_only_on_disk_as_missing_from_state", (t) => {
    // Scenario: dir/a.txt is only on disk, so it is listed as missing from state.
    const folders = makeFolders(t, ["dir/a.txt"]);
    writeFileIn(folders.diskFolder, "dir/a.txt", "a");
    const lines = compareFolders(folders);
    assert.deepEqual(lines, ["missing from state: dir/a.txt", `check vs disk ${folders.diskFolder}: 1 missing, 0 extra, 0 different, 0 same`]);
});

test("test_compareStateToDisk_lists_a_file_only_in_state_as_extra", (t) => {
    // Scenario: a.txt is only in the state folder, so it is listed as extra in state.
    const folders = makeFolders(t, ["a.txt"]);
    writeFileIn(folders.stateFolder, "a.txt", "a");
    const lines = compareFolders(folders);
    assert.deepEqual(lines, ["extra in state: a.txt", `check vs disk ${folders.diskFolder}: 0 missing, 1 extra, 0 different, 0 same`]);
});

test("test_compareStateToDisk_skips_a_touched_path_inside_the_git_folder", (t) => {
    // Scenario: .git/config is only in the state folder, so it is not listed as extra and not counted.
    const folders = makeFolders(t, [".git/config"]);
    writeFileIn(folders.stateFolder, ".git/config", "x");
    const lines = compareFolders(folders);
    assert.deepEqual(lines, [`check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 0 same`]);
});

test("test_compareStateToDisk_skips_a_touched_path_inside_the_idleState_folder", (t) => {
    // Scenario: .idleState/x.json has other bytes in the state folder, so it is not listed as different and not counted.
    const folders = makeFolders(t, [".idleState/x.json"]);
    writeFileIn(folders.stateFolder, ".idleState/x.json", "state");
    writeFileIn(folders.diskFolder, ".idleState/x.json", "disk");
    const lines = compareFolders(folders);
    assert.deepEqual(lines, [`check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 0 same`]);
});

test("test_compareStateToDisk_counts_a_file_in_neither_folder_as_same", (t) => {
    // Scenario: a.txt was deleted in both folders, so it counts as same.
    const folders = makeFolders(t, ["a.txt"]);
    const lines = compareFolders(folders);
    assert.deepEqual(lines, [`check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 1 same`]);
});
