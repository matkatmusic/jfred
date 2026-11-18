// The TUI settings: flags, the start check on the store folder, and the one-TUI-per-store lock.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { getProjectCacheFile } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { acquireTuiLock, getTuiLockFile, prepareTuiStore, readTuiSettings } from "../engineV3/tui/engineV3_tui_settings.ts";

// A store path inside the cache folder that does not exist yet. The test removes the store and its tui cache folder.
function makeMissingStoreFolderInsideCacheFolder(t: TestContext): Path {
    const storeFolder = new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-" + randomUUID()));
    t.after(() => {
        rmSync(storeFolder.toString(), { recursive: true, force: true });
        rmSync(dirname(getProjectCacheFile(storeFolder).toString()), { recursive: true, force: true });
    });
    return storeFolder;
}

function makeLockFolder(storeFolder: Path): void {
    mkdirSync(dirname(getTuiLockFile(storeFolder).toString()), { recursive: true });
}

test("test_start_makes_the_store_folder_before_the_store_check", (t) => {
    // Scenario: the start check creates a missing store folder first, because the check needs a real path to resolve.
    // a store path inside the cache folder does not exist yet.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    assert.equal(existsSync(storeFolder.toString()), false);
    // the start check runs.
    prepareTuiStore(storeFolder, new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-no-such-project-" + randomUUID())));
    // the store folder exists afterwards.
    assert.equal(existsSync(storeFolder.toString()), true);
});

test("test_start_accepts_a_store_folder_that_does_not_exist_yet_inside_the_cache_folder", (t) => {
    // Scenario: a new store folder inside the cache folder passes the start check without a throw.
    // a store path inside the cache folder does not exist yet.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    // the start check runs and must not throw.
    assert.doesNotThrow(() => prepareTuiStore(storeFolder, new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-no-such-project-" + randomUUID()))));
    // the store folder was made.
    assert.equal(existsSync(storeFolder.toString()), true);
});

test("test_the_lock_refuses_a_second_start_while_the_first_process_is_alive", (t) => {
    // Scenario: a second TUI on the same store throws while the first TUI process is alive.
    // a store path and its lock folder exist.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    makeLockFolder(storeFolder);
    // the first start takes the lock.
    acquireTuiLock(storeFolder);
    // the lock file holds the current process id.
    assert.equal(readFileSync(getTuiLockFile(storeFolder).toString(), "utf8").trim(), String(process.pid));
    // the second start throws because that process is alive.
    assert.throws(() => acquireTuiLock(storeFolder));
});

test("test_a_lock_of_a_dead_process_is_taken_over", (t) => {
    // Scenario: a lock that names a process that no longer runs does not block a new start.
    // a child process starts and ends, so its process id is not alive.
    const deadChild = spawnSync("node", ["-e", ""]);
    const deadProcessId = deadChild.pid;
    assert.notEqual(spawnSync("ps", ["-p", String(deadProcessId)]).status, 0);
    // a lock file holds that dead process id.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    makeLockFolder(storeFolder);
    writeFileSync(getTuiLockFile(storeFolder).toString(), String(deadProcessId));
    // the start takes the lock without a throw.
    assert.doesNotThrow(() => acquireTuiLock(storeFolder));
    // the lock file now holds the current process id.
    assert.equal(readFileSync(getTuiLockFile(storeFolder).toString(), "utf8").trim(), String(process.pid));
});

test("test_processes_flag_above_four_throws", () => {
    // Scenario: the settings refuse a process count above four.
    // an argument list asks for five processes.
    const argv = ["--project", "/tmp/project", "--jsonls", "/tmp/jsonls", "--file-history", "/tmp/history", "--store", "/tmp/store", "--processes", "5"];
    // reading the settings throws.
    assert.throws(() => readTuiSettings(argv));
});

test("test_readTuiSettings_reads_the_comma_lists_and_defaults", () => {
    // Scenario: the settings read both comma lists and fill the defaults for the optional flags.
    // an argument list has two jsonls folders and two file-history folders, and none of the optional flags.
    const argv = ["--project", "/tmp/project", "--jsonls", "/tmp/jsonls-a,/tmp/jsonls-b", "--file-history", "/tmp/history-a,/tmp/history-b", "--store", "/tmp/store"];
    // reading the settings gives the folders as lists of paths.
    const settings = readTuiSettings(argv);
    assert.deepEqual(settings.projectFolder, new Path("/tmp/project"));
    assert.deepEqual(settings.jsonlsFolders, [new Path("/tmp/jsonls-a"), new Path("/tmp/jsonls-b")]);
    assert.deepEqual(settings.fileHistoryFolders, [new Path("/tmp/history-a"), new Path("/tmp/history-b")]);
    assert.deepEqual(settings.storeFolder, new Path("/tmp/store"));
    // the optional flags have their defaults.
    assert.equal(settings.repoFolder, undefined);
    assert.equal(settings.commit, undefined);
    assert.equal(settings.processes, 4);
    assert.equal(settings.isAuto, false);
});
