// The TUI settings: flags, the start check on the store folder, and the one-TUI-per-store lock.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { isFullBuildRepoInStore } from "../engineV3/engineV3_step_store_guard.ts";
import { getProjectCacheFile } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { acquireTuiLock, getFlagArguments, getTuiLockFile, prepareTuiStore, readTuiSettings } from "../engineV3/tui/engineV3_tui_settings.ts";

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
    prepareTuiStore(storeFolder, new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-no-such-project-" + randomUUID())), []);
    // the store folder exists afterwards.
    assert.equal(existsSync(storeFolder.toString()), true);
});

test("test_start_accepts_a_store_folder_that_does_not_exist_yet_inside_the_cache_folder", (t) => {
    // Scenario: a new store folder inside the cache folder passes the start check without a throw.
    // a store path inside the cache folder does not exist yet.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    // the start check runs and must not throw.
    assert.doesNotThrow(() => prepareTuiStore(storeFolder, new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-no-such-project-" + randomUUID())), []));
    // the store folder was made.
    assert.equal(existsSync(storeFolder.toString()), true);
});

test("test_start_does_not_throw_for_a_store_that_holds_a_full_build_repo_and_the_store_check_reports_it", (t) => {
    // Scenario: the start check does not throw when the store holds a full-build repo of one of the project files; the full-build check reports it, so the TUI can ask the user.
    // a store path inside the cache folder, a project folder, and one project file.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    const projectFolder = new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-project-" + randomUUID()));
    const file = new Path(join(projectFolder.toString(), "a.txt"));
    // the store holds a repo folder of that file without an on-demand stamp, so it is a full-build repo.
    mkdirSync(getInverseRepoFolderForFile(storeFolder, projectFolder, file).toString(), { recursive: true });
    // the start check with that project file list does not throw.
    // assert.throws(() => prepareTuiStore(storeFolder, projectFolder, [{ file, transcriptFile: file }]), /full-build repo/);
    assert.doesNotThrow(() => prepareTuiStore(storeFolder, projectFolder, [{ file, transcriptFile: file }]));
    // the full-build check says the store holds a full-build repo.
    assert.equal(isFullBuildRepoInStore(storeFolder, projectFolder, [{ file, transcriptFile: file }]), true);
});
test("test_the_full_build_check_says_false_for_a_store_without_repos", (t) => {
    // Scenario: an empty store holds no full-build repo.
    // an empty store folder and one project file.
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    const projectFolder = new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-project-" + randomUUID()));
    const file = new Path(join(projectFolder.toString(), "a.txt"));
    // the full-build check says false.
    assert.equal(isFullBuildRepoInStore(storeFolder, projectFolder, [{ file, transcriptFile: file }]), false);
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

test("test_readTuiSettings_makes_a_relative_store_folder_absolute", () => {
    // Scenario: a relative --store becomes an absolute path, because jfred git refuses a relative repo path.
    // an argument list has a relative store folder.
    const argv = ["--project", "/tmp/project", "--jsonls", "/tmp/jsonls", "--file-history", "/tmp/history", "--store", ".cache/inverse-repos/relative-store"];
    // reading the settings gives the store folder as an absolute path inside the current folder.
    const settings = readTuiSettings(argv);
    assert.equal(settings.storeFolder.toString(), resolve(".cache/inverse-repos/relative-store"));
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

const REQUIRED_SETTINGS_KEYS = { project: "/tmp/project", jsonls: ["/tmp/jsonls-a", "/tmp/jsonls-b"], "file-history": ["/tmp/history-a", "/tmp/history-b"], store: "/tmp/store" };

function writeSettingsFile(t: TestContext, content: object): string {
    const settingsFolder = mkdtempSync(join(tmpdir(), "jfred-settings-"));
    t.after(() => rmSync(settingsFolder, { recursive: true, force: true }));
    const settingsFile = join(settingsFolder, "settings.json");
    writeFileSync(settingsFile, JSON.stringify(content));
    return settingsFile;
}

test("test_settings_file_gives_the_same_settings_as_the_flags", (t) => {
    // Scenario: every key of the settings file gives the same settings object as the matching flags.
    // a settings file holds all eight keys.
    const settingsFile = writeSettingsFile(t, { ...REQUIRED_SETTINGS_KEYS, repo: "/tmp/repo", commit: "abc123", processes: 2, auto: true });
    // the same values as flags.
    const flagArguments = ["--project", "/tmp/project", "--jsonls", "/tmp/jsonls-a,/tmp/jsonls-b", "--file-history", "/tmp/history-a,/tmp/history-b", "--store", "/tmp/store", "--repo", "/tmp/repo", "--commit", "abc123", "--processes", "2", "--auto"];
    // reading the settings file gives the same object as reading the flags.
    assert.deepEqual(readTuiSettings(["--settings", settingsFile]), readTuiSettings(flagArguments));
});

test("test_settings_file_auto_false_gives_isAuto_false", (t) => {
    // Scenario: the key auto with the value false leaves auto mode off.
    // a settings file holds the required keys and auto false.
    const settingsFile = writeSettingsFile(t, { ...REQUIRED_SETTINGS_KEYS, auto: false });
    // reading it gives isAuto false.
    assert.equal(readTuiSettings(["--settings", settingsFile]).isAuto, false);
});

test("test_settings_flag_with_another_flag_throws", (t) => {
    // Scenario: with --settings, any other flag on the command line throws.
    // a good settings file and one more flag on the command line.
    const settingsFile = writeSettingsFile(t, REQUIRED_SETTINGS_KEYS);
    // reading the settings throws.
    assert.throws(() => readTuiSettings(["--settings", settingsFile, "--auto"]));
});

test("test_settings_file_with_an_unknown_key_throws", (t) => {
    // Scenario: a key that is not a flag name throws.
    // a settings file holds the required keys and one unknown key.
    const settingsFile = writeSettingsFile(t, { ...REQUIRED_SETTINGS_KEYS, colour: "red" });
    // reading the settings throws.
    assert.throws(() => readTuiSettings(["--settings", settingsFile]));
});

test("test_settings_file_that_does_not_exist_throws", () => {
    // Scenario: a missing settings file throws.
    // reading a settings file that does not exist throws.
    assert.throws(() => readTuiSettings(["--settings", join(tmpdir(), "jfred-no-such-settings-" + randomUUID() + ".json")]));
});

test("test_settings_file_with_processes_above_four_throws", (t) => {
    // Scenario: the file path keeps the rule that processes above four throw.
    // a settings file holds the required keys and processes 5.
    const settingsFile = writeSettingsFile(t, { ...REQUIRED_SETTINGS_KEYS, processes: 5 });
    // reading the settings throws.
    assert.throws(() => readTuiSettings(["--settings", settingsFile]));
});

test("test_settings_file_with_repo_and_no_commit_throws", (t) => {
    // Scenario: the file path keeps the rule that repo and commit go together.
    // a settings file holds the required keys and a repo, but no commit.
    const settingsFile = writeSettingsFile(t, { ...REQUIRED_SETTINGS_KEYS, repo: "/tmp/repo" });
    // reading the settings throws.
    assert.throws(() => readTuiSettings(["--settings", settingsFile]));
});

test("test_settings_file_without_a_required_key_throws", (t) => {
    // Scenario: the file path keeps the rule that the store key is required.
    // a settings file holds the required keys except store.
    const { store, ...keysWithoutStore } = REQUIRED_SETTINGS_KEYS;
    const settingsFile = writeSettingsFile(t, keysWithoutStore);
    // reading the settings throws.
    assert.throws(() => readTuiSettings(["--settings", settingsFile]));
});

test("test_settings_argument_becomes_the_flags_the_cache_child_reads", (t) => {
    // Scenario: the cache child only knows real flags, so --settings must become those flags before the child starts.
    // a settings file holds the four required keys.
    const settingsFile = writeSettingsFile(t, REQUIRED_SETTINGS_KEYS);
    // the flag arguments for that settings file are the real flags, and they hold no --settings.
    assert.deepEqual(getFlagArguments(["--settings", settingsFile]), ["--project", "/tmp/project", "--jsonls", "/tmp/jsonls-a,/tmp/jsonls-b", "--file-history", "/tmp/history-a,/tmp/history-b", "--store", "/tmp/store"]);
});

test("test_flag_arguments_without_settings_stay_the_same", () => {
    // Scenario: real flags pass through unchanged.
    // an argument list holds only real flags.
    const argv = ["--project", "/tmp/project", "--auto"];
    // the flag arguments are the same list.
    assert.deepEqual(getFlagArguments(argv), argv);
});

test("test_usage_text_names_the_settings_flag", () => {
    // Scenario: the usage text lists --settings.
    // reading --settings with no file throws the usage text, and the text names --settings.
    assert.throws(() => readTuiSettings(["--settings"]), /\| --settings <file\.json>/);
});
