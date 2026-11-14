import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { selectDiskFolder, compareStateToDisk } from "./engineV3_compare_disk.ts";

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

const CONTAINER_STATE = "/container/state";

function writeGitignoreInState(folders: Folders, ignoreText: string): void {
    execFileSync("git", ["init", "-q"], { cwd: folders.stateFolder });
    writeFileIn(folders.stateFolder, ".gitignore", ignoreText);
}

function writeEventIn(t: TestContext, eventFileName: string, changedRelativePaths: string[]): string {
    const eventsFolder = join(makeTempFolder(t, "engine-v3-disk-events-"), "events");
    return writeMoreEventsIn(eventsFolder, eventFileName, changedRelativePaths);
}

function writeMoreEventsIn(eventsFolder: string, eventFileName: string, changedRelativePaths: string[]): string {
    const changes = changedRelativePaths.map((relativePath) => ({ path: `${CONTAINER_STATE}/${relativePath}`, change: "modified" }));
    writeFileIn(eventsFolder, eventFileName, JSON.stringify({ event: 0, eventText: "x", previousEvent: null, touched: [], changes }));
    return eventsFolder;
}

function compareFoldersWithEvents(folders: Folders, eventsFolder: string): string[] {
    return compareStateToDisk(new Path(folders.stateFolder), new Path(folders.diskFolder), new Path(folders.touchedFile), { eventsFolder: new Path(eventsFolder), containerState: new Path(CONTAINER_STATE) });
}

test("test_compareStateToDisk_skips_a_gitignored_file_whose_last_change_is_not_a_JSONL_line", (t) => {
    // Scenario: results/h.json is gitignored and only the start event wrote it, so the disk bytes are not compared and one skipped line is printed.
    const folders = makeFolders(t, ["results/h.json"]);
    writeGitignoreInState(folders, "results/\n");
    writeFileIn(folders.stateFolder, "results/h.json", "state");
    writeFileIn(folders.diskFolder, "results/h.json", "disk");
    const eventsFolder = writeEventIn(t, "000000_start.json", ["results/h.json"]);
    // compare the touched paths with the event files
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    // the file is listed as skipped and counted as skipped, not as different
    assert.deepEqual(lines, ["skipped (gitignored, last change not from a JSONL line: 000000_start.json): results/h.json", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 0 same, 1 skipped`]);
});

test("test_compareStateToDisk_compares_a_gitignored_file_whose_last_change_is_a_JSONL_line", (t) => {
    // Scenario: results/h.json is gitignored, the start event wrote it, then a later JSONL line changed it, so the last change is a JSONL line and the file is compared.
    const folders = makeFolders(t, ["results/h.json"]);
    writeGitignoreInState(folders, "results/\n");
    writeFileIn(folders.stateFolder, "results/h.json", "state");
    writeFileIn(folders.diskFolder, "results/h.json", "disk");
    const eventsFolder = writeEventIn(t, "000000_start.json", ["results/h.json"]);
    writeMoreEventsIn(eventsFolder, "000005_9789f2d0-5506-4633-9117-f64471817355_12.json", ["results/h.json"]);
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, ["different content: results/h.json", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 1 different, 0 same, 0 skipped`]);
});

test("test_compareStateToDisk_compares_a_file_that_is_not_gitignored_when_its_last_change_is_not_a_JSONL_line", (t) => {
    // Scenario: a.txt is not gitignored and a plate capture wrote it last, so the file is compared.
    const folders = makeFolders(t, ["a.txt"]);
    writeGitignoreInState(folders, "results/\n");
    writeFileIn(folders.stateFolder, "a.txt", "state");
    writeFileIn(folders.diskFolder, "a.txt", "disk");
    const eventsFolder = writeEventIn(t, "000003_plate_capture-1.json", ["a.txt"]);
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, ["different content: a.txt", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 1 different, 0 same, 0 skipped`]);
});

test("test_compareStateToDisk_compares_a_touched_path_outside_the_state_folder_without_asking_git", (t) => {
    // Scenario: ../outside.txt climbs out of the state folder, so git is not asked about it and the file is compared.
    const rootFolder = makeTempFolder(t, "engine-v3-disk-root-");
    const folders = makeFolders(t, ["../outside.txt"]);
    folders.stateFolder = join(rootFolder, "state");
    folders.diskFolder = join(rootFolder, "deeper", "disk");
    mkdirSync(folders.stateFolder, { recursive: true });
    mkdirSync(folders.diskFolder, { recursive: true });
    writeGitignoreInState(folders, "results/\n");
    // the two folders sit at different depths, so ../outside.txt is a different file on each side
    writeFileIn(folders.stateFolder, "../outside.txt", "state");
    writeFileIn(folders.diskFolder, "../outside.txt", "disk");
    const eventsFolder = writeEventIn(t, "000000_start.json", ["../outside.txt"]);
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, ["different content: ../outside.txt", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 1 different, 0 same, 0 skipped`]);
});

test("test_compareStateToDisk_compares_every_file_when_the_state_folder_has_no_git_folder", (t) => {
    // Scenario: the state folder is not a git repo, so no file is gitignored and the file is compared.
    const folders = makeFolders(t, ["results/h.json"]);
    writeFileIn(folders.stateFolder, "results/h.json", "state");
    writeFileIn(folders.diskFolder, "results/h.json", "disk");
    const eventsFolder = writeEventIn(t, "000000_start.json", ["results/h.json"]);
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, ["different content: results/h.json", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 1 different, 0 same, 0 skipped`]);
});

test("test_compareStateToDisk_asks_the_nested_repo_about_a_file_inside_a_nested_repo", (t) => {
    // Scenario: sub is its own git repo that ignores out/, so out/a.txt inside it is skipped by the rules of the nested repo.
    const folders = makeFolders(t, ["sub/out/a.txt"]);
    writeGitignoreInState(folders, "");
    mkdirSync(join(folders.stateFolder, "sub"));
    execFileSync("git", ["init", "-q"], { cwd: join(folders.stateFolder, "sub") });
    writeFileIn(folders.stateFolder, "sub/.gitignore", "out/\n");
    writeFileIn(folders.stateFolder, "sub/out/a.txt", "state");
    writeFileIn(folders.diskFolder, "sub/out/a.txt", "disk");
    const eventsFolder = writeEventIn(t, "000000_start.json", ["sub/out/a.txt"]);
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, ["skipped (gitignored, last change not from a JSONL line: 000000_start.json): sub/out/a.txt", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 0 same, 1 skipped`]);
});

test("test_compareStateToDisk_checks_a_path_from_an_earlier_stored_event_that_the_touched_file_does_not_list", (t) => {
    // Scenario: a short run lists no touched path, but the store holds a start event from before the run that changed a.txt, so a.txt is still compared.
    const folders = makeFolders(t, []);
    writeFileIn(folders.stateFolder, "a.txt", "state");
    writeFileIn(folders.diskFolder, "a.txt", "disk");
    const eventsFolder = writeEventIn(t, "000000_start.json", ["a.txt"]);
    // compare with the store
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    // the stored path is checked and found different
    assert.deepEqual(lines, ["different content: a.txt", `check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 1 different, 0 same, 0 skipped`]);
});

test("test_compareStateToDisk_does_not_check_stored_directory_changes_or_stored_paths_outside_the_state_folder", (t) => {
    // Scenario: the store holds a directory change and a change under /container/other, which are not files of the state folder, so nothing is checked.
    const folders = makeFolders(t, []);
    const eventsFolder = join(makeTempFolder(t, "engine-v3-disk-events-"), "events");
    const changes = [{ path: `${CONTAINER_STATE}/dir`, change: "added", directory: true }, { path: "/container/other/x.txt", change: "added" }];
    writeFileIn(eventsFolder, "000000_start.json", JSON.stringify({ event: 0, eventText: "x", previousEvent: null, touched: [], changes }));
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, [`check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 0 same, 0 skipped`]);
});

test("test_compareStateToDisk_does_not_check_a_stored_path_whose_last_change_deleted_a_directory", (t) => {
    // Scenario: dir was added as a directory and deleted later (a delete change has no directory flag), and dir exists in both folders, so it is not compared as a file.
    const folders = makeFolders(t, []);
    writeFileIn(folders.stateFolder, "dir/inner.txt", "state");
    writeFileIn(folders.diskFolder, "dir/inner.txt", "disk");
    const eventsFolder = join(makeTempFolder(t, "engine-v3-disk-events-"), "events");
    const addedChanges = [{ path: `${CONTAINER_STATE}/dir`, change: "added", directory: true }];
    writeFileIn(eventsFolder, "000000_start.json", JSON.stringify({ event: 0, eventText: "x", previousEvent: null, touched: [], changes: addedChanges }));
    const deletedChanges = [{ path: `${CONTAINER_STATE}/dir`, change: "deleted" }];
    writeFileIn(eventsFolder, "000001_9789f2d0-5506-4633-9117-f64471817355_2.json", JSON.stringify({ event: 1, eventText: "x", previousEvent: null, touched: [], changes: deletedChanges }));
    const lines = compareFoldersWithEvents(folders, eventsFolder);
    assert.deepEqual(lines, [`check vs disk ${folders.diskFolder}: 0 missing, 0 extra, 0 different, 0 same, 0 skipped`]);
});

test("test_selectDiskFolder_picks_the_highest_step_folder", (t) => {
    // Scenario: the scenario folder holds step-002, step-010 and step-009, so step-010 is the last step.
    const scenarioFolder = makeTempFolder(t, "engine-v3-disk-scenario-");
    for (const stepName of ["step-002", "step-010", "step-009"]) {
        writeFileIn(scenarioFolder, `.step_states/${stepName}/manifest.json`, "{}");
    }
    const chosen = selectDiskFolder(new Path(scenarioFolder));
    assert.equal(chosen.toString(), join(scenarioFolder, ".step_states", "step-010"));
});

test("test_selectDiskFolder_keeps_the_scenario_folder_without_step_states", (t) => {
    // Scenario: the scenario folder has no .step_states folder, so the scenario folder is the disk.
    const scenarioFolder = makeTempFolder(t, "engine-v3-disk-scenario-");
    const chosen = selectDiskFolder(new Path(scenarioFolder));
    assert.equal(chosen.toString(), scenarioFolder);
});
