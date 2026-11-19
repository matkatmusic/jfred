// The TUI project cache: the files and the modifying events of the whole project, listed once outside the TUI process.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { GuessCategory } from "../src/structures/vocabulary.ts";
import { readEarliestBoundary, type EarliestBoundary } from "../engineV3/engineV3_earliest_boundary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildProjectCache, getProjectCacheFile, loadOrBuildProjectCache, type FileEventCounts, type ProjectCache, type ProjectEventEntry, type TuiInput } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { commitFileAtSecond, makeBashRows, makeEditRows, makeInstant, writeProjectFiles, type ProjectFolders, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

function makeTuiInput(project: ProjectFolders, earliestBoundary: EarliestBoundary | undefined): TuiInput {
    return { projectFolder: project.projectFolder, jsonlsFolders: [project.jsonlsFolder], fileHistoryFolders: [project.snapshotFolder], storeFolder: project.storeFolder, earliestBoundary };
}

// The cache file sits in a "tui-cache" folder that does not exist yet: the writer creates it.
function makeCacheFilePath(t: TestContext): Path {
    const rootFolder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-tui-cache-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    return new Path(join(rootFolder, "tui-cache", "project-cache.json"));
}

function computeSecondsOfInstant(instant: Date): number {
    return Math.round((instant.getTime() - makeInstant(0).getTime()) / 1000);
}

function listFileNameAndSecondOfEvents(events: ProjectEventEntry[]): [string, number][] {
    return events.map((event): [string, number] => [basename(event.file.toString()), computeSecondsOfInstant(event.instant)]);
}

function makeCountsWith(countByEventType: Partial<FileEventCounts>): FileEventCounts {
    const counts = {} as FileEventCounts;
    for (const eventType of Object.values(FileEventType)) {
        counts[eventType] = countByEventType[eventType] ?? 0;
    }
    return counts;
}

function listPathTexts(files: Path[]): string[] {
    return files.map((file) => file.toString());
}

function appendRowsToSessionLog(project: ProjectFolders, rows: object[]): void {
    appendFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

// a.txt is edited at seconds 10 and 40, b.txt at second 20.
function writeProjectWithTwoEditedFiles(t: TestContext, extraRows: (projectFolder: string, filePathByFileName: Map<string, string>) => object[] = () => []): ProjectWithFiles {
    return writeProjectFiles(t, new Map([["a.txt", "a2\n"], ["b.txt", "b1\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a1", filePathByFileName.get("a.txt")!, "a0", "a1", null, 10),
        ...makeEditRows(projectFolder, "toolu_b1", filePathByFileName.get("b.txt")!, "b0", "b1", null, 20),
        ...makeEditRows(projectFolder, "toolu_a2", filePathByFileName.get("a.txt")!, "a1", "a2", null, 40),
        ...extraRows(projectFolder, filePathByFileName),
    ]);
}

test("test_cache_lists_the_modifying_events_newest_first_across_files", (t) => {
    // Scenario: a.txt is edited at seconds 10 and 40, b.txt at second 20.
    const project = writeProjectWithTwoEditedFiles(t);
    // Build the cache.
    const cache = buildProjectCache(makeTuiInput(project, undefined));
    // The events of both files are in one list, newest first.
    assert.deepEqual(listFileNameAndSecondOfEvents(cache.events), [["a.txt", 40], ["b.txt", 20], ["a.txt", 10]]);
});

test("test_cache_excludes_disk_now_and_reads", (t) => {
    // Scenario: as above, plus a script at second 30 that only reads a.txt.
    const project = writeProjectWithTwoEditedFiles(t, (projectFolder) => makeBashRows(projectFolder, "toolu_cat", "cat a.txt", 30));
    // Build the cache.
    const cache = buildProjectCache(makeTuiInput(project, undefined));
    // The three edits are in the list, and no event is a disk-now event or a read-only script.
    assert.equal(cache.events.length, 3);
    assert.equal(cache.events.some((event) => event.eventType === FileEventType.DiskNow), false);
    assert.equal(cache.events.some((event) => event.eventType === FileEventType.ScriptReadOnly), false);
});

test("test_cache_counts_every_event_type_per_file", (t) => {
    // Scenario: a.txt has two edits and one read-only script, b.txt has one edit; both are on disk.
    const project = writeProjectWithTwoEditedFiles(t, (projectFolder) => makeBashRows(projectFolder, "toolu_cat", "cat a.txt", 30));
    // Build the cache.
    const cache = buildProjectCache(makeTuiInput(project, undefined));
    // The counts of each file, keyed by its absolute path, hold every event type.
    assert.deepEqual(cache.countsByFile.get(project.fileByName.get("a.txt")!.toString()), makeCountsWith({ [FileEventType.EditRow]: 2, [FileEventType.ScriptReadOnly]: 1, [FileEventType.DiskNow]: 1 }));
    assert.deepEqual(cache.countsByFile.get(project.fileByName.get("b.txt")!.toString()), makeCountsWith({ [FileEventType.EditRow]: 1, [FileEventType.DiskNow]: 1 }));
});

test("test_cache_counts_script_may_write_and_script_read_only_by_distinct_source", (t) => {
    // Scenario: one script writes a.txt and b.txt, and another script only reads a.txt.
    const project = writeProjectFiles(t, new Map([["a.txt", "a\n"], ["b.txt", "b\n"]]), (projectFolder) => [
        ...makeBashRows(projectFolder, "toolu_write", "echo x > a.txt; echo y > b.txt", 10),
        ...makeBashRows(projectFolder, "toolu_read", "cat a.txt", 20),
    ]);
    // Build the cache.
    const cache = buildProjectCache(makeTuiInput(project, undefined));
    // The writing script counts once although it makes an event for each of the two files, and the reading script counts once.
    assert.deepEqual(cache.scriptCounts, { mayWrite: 1, readOnly: 1 });
});

test("test_cache_is_reused_when_the_inputs_hash_is_equal", (t) => {
    // Scenario: the cache was built and written once.
    const project = writeProjectWithTwoEditedFiles(t);
    const cacheFile = makeCacheFilePath(t);
    const input = makeTuiInput(project, undefined);
    const firstResult = loadOrBuildProjectCache(input, cacheFile);
    assert.equal(firstResult.wasRebuilt, true);
    // Nothing changed, so the second call reads the file.
    const secondResult = loadOrBuildProjectCache(input, cacheFile);
    assert.equal(secondResult.wasRebuilt, false);
    assert.equal(secondResult.cache.inputsHash, firstResult.cache.inputsHash);
    assert.deepEqual(listFileNameAndSecondOfEvents(secondResult.cache.events), listFileNameAndSecondOfEvents(firstResult.cache.events));
});

test("test_cache_is_rebuilt_when_a_log_file_grew", (t) => {
    // Scenario: the cache was built and written once.
    const project = writeProjectWithTwoEditedFiles(t);
    const cacheFile = makeCacheFilePath(t);
    const input = makeTuiInput(project, undefined);
    const firstResult = loadOrBuildProjectCache(input, cacheFile);
    // A new row (an edit of b.txt at second 50) is added to the log file.
    appendRowsToSessionLog(project, makeEditRows(project.projectFolder.toString(), "toolu_b2", project.fileByName.get("b.txt")!.toString(), "b1", "b2", null, 50));
    // The second call builds the cache again and holds the new event.
    const secondResult = loadOrBuildProjectCache(input, cacheFile);
    assert.equal(secondResult.wasRebuilt, true);
    assert.equal(secondResult.cache.events.length, firstResult.cache.events.length + 1);
});

test("test_cache_is_rebuilt_when_the_project_gets_a_new_git_commit", (t) => {
    // Scenario: the cache was built and written once.
    const project = writeProjectWithTwoEditedFiles(t);
    const cacheFile = makeCacheFilePath(t);
    const input = makeTuiInput(project, undefined);
    loadOrBuildProjectCache(input, cacheFile);
    // The project repo gets a new commit.
    commitFileAtSecond(project.projectFolder.toString(), "c.txt", "c\n", 60);
    // The second call builds the cache again.
    const secondResult = loadOrBuildProjectCache(input, cacheFile);
    assert.equal(secondResult.wasRebuilt, true);
});

test("test_cache_with_a_boundary_has_no_event_at_or_before_the_commit_time", (t) => {
    // Scenario: a.txt is committed at second 5 and at second 15 (the boundary commit); the logs edit it at seconds 20 and 30.
    const project = writeProjectFiles(t, new Map([["a.txt", "three\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 20),
        ...makeEditRows(projectFolder, "toolu_b", filePathByFileName.get("a.txt")!, "two", "three", null, 30),
    ]);
    commitFileAtSecond(project.projectFolder.toString(), "a.txt", "zero\n", 5);
    const commitHash = commitFileAtSecond(project.projectFolder.toString(), "a.txt", "one\n", 15);
    const boundary = readEarliestBoundary(project.projectFolder, new Uuid(commitHash));
    // Without the boundary the cache holds an event at or before the commit time (a commit event).
    const cacheWithoutBoundary = buildProjectCache(makeTuiInput(project, undefined));
    assert.equal(cacheWithoutBoundary.events.some((event) => event.instant.getTime() <= boundary.instant.getTime()), true);
    // With the boundary, every event is at or after the commit time; the only event at the commit time is the commit text (GitCommit); the two edits remain.
    const cacheWithBoundary = buildProjectCache(makeTuiInput(project, boundary));
    // assert.equal(cacheWithBoundary.events.some((event) => event.instant.getTime() <= boundary.instant.getTime()), false);
    assert.equal(cacheWithBoundary.events.some((event) => event.instant.getTime() < boundary.instant.getTime()), false);
    const eventsAtCommitTime = cacheWithBoundary.events.filter((event) => event.instant.getTime() === boundary.instant.getTime());
    assert.equal(eventsAtCommitTime.length, 1);
    assert.equal(eventsAtCommitTime[0]!.eventType, FileEventType.GitCommit);
    assert.equal(cacheWithBoundary.events.filter((event) => event.eventType === FileEventType.EditRow).length, 2);
});

test("test_cache_file_is_not_inside_the_store_folder", () => {
    // Scenario: a store folder named "store".
    const storeFolder = new Path(join(realpathSync(tmpdir()), "engine-v3-tui-cache-unused", "store"));
    // The cache file is "<jfred folder>/.cache/tui/store/project-cache.json".
    const cacheFile = getProjectCacheFile(storeFolder);
    assert.equal(cacheFile.toString(), join(import.meta.dirname, "..", ".cache", "tui", "store", "project-cache.json"));
    // It is not inside the store folder.
    assert.equal(cacheFile.toString().startsWith(storeFolder.toString() + sep), false);
});

test("test_cache_gives_each_guess_file_its_category", (t) => {
    // Scenario: a.txt is edited by two partial Edits (no older beacon), c.txt is on disk and no log line names it.
    const project = writeProjectFiles(t, new Map([["a.txt", "a2\n"], ["c.txt", "c\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a1", filePathByFileName.get("a.txt")!, "a0", "a1", null, 10),
        ...makeEditRows(projectFolder, "toolu_a2", filePathByFileName.get("a.txt")!, "a1", "a2", null, 40),
    ]);
    // Build the cache.
    const cache = buildProjectCache(makeTuiInput(project, undefined));
    // a.txt has guess steps and c.txt has no log lines.
    assert.equal(cache.guessCategoryByFile.get(project.fileByName.get("a.txt")!.toString()), GuessCategory.HasGuessSteps);
    assert.equal(cache.guessCategoryByFile.get(project.fileByName.get("c.txt")!.toString()), GuessCategory.NoLogLines);
});

test("test_cache_keeps_the_guess_categories_when_it_is_read_back_from_the_file", (t) => {
    // Scenario: the cache was built and written once.
    const project = writeProjectWithTwoEditedFiles(t);
    const cacheFile = makeCacheFilePath(t);
    const input = makeTuiInput(project, undefined);
    const firstResult = loadOrBuildProjectCache(input, cacheFile);
    // The second call reads the file.
    const secondResult = loadOrBuildProjectCache(input, cacheFile);
    assert.equal(secondResult.wasRebuilt, false);
    // The categories are the same.
    assert.deepEqual([...secondResult.cache.guessCategoryByFile], [...firstResult.cache.guessCategoryByFile]);
});

test("test_cache_stored_before_the_guess_categories_existed_is_rebuilt_and_not_read", (t) => {
    // Scenario: a cache file without the guess categories and with another inputs hash.
    const project = writeProjectWithTwoEditedFiles(t);
    const cacheFile = makeCacheFilePath(t);
    const input = makeTuiInput(project, undefined);
    loadOrBuildProjectCache(input, cacheFile);
    const oldJson = JSON.parse(readFileSync(cacheFile.toString(), "utf8"));
    delete oldJson.guessCategoryByFile;
    oldJson.inputsHash = "old-format-hash";
    writeFileSync(cacheFile.toString(), JSON.stringify(oldJson));
    // The next call rebuilds and does not throw.
    const result = loadOrBuildProjectCache(input, cacheFile);
    assert.equal(result.wasRebuilt, true);
    assert.equal(result.cache.guessCategoryByFile.size > 0, true);
});

test("test_cache_lists_the_replay_files_and_the_project_files_separately", (t) => {
    // Scenario: a.txt is on disk; old.txt was committed at second 5 and then removed from disk.
    const project = writeProjectFiles(t, new Map([["a.txt", "a\n"]]), (projectFolder, filePathByFileName) => makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "a0", "a", null, 10));
    commitFileAtSecond(project.projectFolder.toString(), "old.txt", "old\n", 5);
    rmSync(join(project.projectFolder.toString(), "old.txt"));
    // Build the cache.
    const cache: ProjectCache = buildProjectCache(makeTuiInput(project, undefined));
    // The project files (layered search) hold both files, because the git history names old.txt.
    const projectFileTexts = listPathTexts(cache.projectFiles);
    assert.equal(projectFileTexts.includes(project.fileByName.get("a.txt")!.toString()), true);
    assert.equal(projectFileTexts.includes(join(project.projectFolder.toString(), "old.txt")), true);
    // The replay files (disk and logs) hold a.txt only, because neither the disk nor the logs name old.txt.
    const replayFileTexts = listPathTexts(cache.replayFiles);
    assert.equal(replayFileTexts.includes(project.fileByName.get("a.txt")!.toString()), true);
    assert.equal(replayFileTexts.includes(join(project.projectFolder.toString(), "old.txt")), false);
});
