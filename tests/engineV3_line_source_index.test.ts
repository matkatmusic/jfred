// The line source index stores which log lines name each project file, so a step child reads only those lines.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "../engineV3/engineV3.ts";
import { createProjectEventsLoader, createSingleFileEventsLoader } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { buildLineSourceIndex, getLineSourceIndexFile, listLinesOfFileFromIndex, readLineSourceIndex, writeLineSourceIndex } from "../engineV3/engineV3_jsonl_lines_source_index.ts";
import { Path } from "../src/structures/domain.ts";
import { readProjectCache } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { makeBashRows, makeEditRows, makeWriteCreateRows, writeProjectCacheOfProject, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

// a.txt is edited, a script move.py names a.txt, the script is run, and b.txt is edited.
function writeProjectWithScript(t: TestContext): ProjectWithFiles {
    return writeProjectFiles(t, new Map([["a.txt", "two\n"], ["b.txt", "other\n"]]), (projectFolder, filePathByFileName) => [
        ...makeWriteCreateRows(projectFolder, "toolu_s", join(projectFolder, "move.py"), "open('a.txt')\n", 5),
        ...makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 10),
        ...makeBashRows(projectFolder, "toolu_r", "python3 move.py", 20),
        ...makeEditRows(projectFolder, "toolu_b", filePathByFileName.get("b.txt")!, "x", "other", null, 30),
    ]);
}
function listProjectFilesOfProject(project: ProjectWithFiles): { file: Path; transcriptFile: Path }[] {
    return [project.fileByName.get("a.txt")!, project.fileByName.get("b.txt")!].map((file) => ({ file, transcriptFile: file }));
}
function captureLinesOfScan(project: ProjectWithFiles): Map<string, JSONLLine[]> {
    let capturedLines: Map<string, JSONLLine[]> | undefined;
    const getEvents = createProjectEventsLoader(listProjectFilesOfProject(project), [project.jsonlsFolder], [project.snapshotFolder], undefined, (linesByFileKey) => { capturedLines = linesByFileKey; });
    getEvents(0);
    return capturedLines!;
}
function describeLines(lines: JSONLLine[]): string[] {
    return lines.map((line) => `${JSON.stringify(getRecordSource(line))} ${JSON.stringify(line)}`);
}

test("test_lines_read_back_from_the_index_equal_the_lines_of_the_scan", (t) => {
    // Scenario: the scan of the project gives each file its lines, including the run line of the script that names a.txt.
    const project = writeProjectWithScript(t);
    const scannedLines = captureLinesOfScan(project);
    const aKey = project.fileByName.get("a.txt")!.toString();
    assert.ok(describeLines(scannedLines.get(aKey)!).some((description) => description.includes("python3 move.py")));
    // an index built from the scanned lines gives back the same lines in the same order, for every file.
    const index = buildLineSourceIndex(scannedLines);
    for (const [fileKey, lines] of scannedLines) {
        assert.deepEqual(describeLines(listLinesOfFileFromIndex(index, fileKey)), describeLines(lines));
    }
});

test("test_reading_a_file_that_is_not_in_the_index_throws", (t) => {
    // Scenario: the index holds a.txt and b.txt only.
    const project = writeProjectWithScript(t);
    const index = buildLineSourceIndex(captureLinesOfScan(project));
    // asking for another file throws.
    assert.throws(() => listLinesOfFileFromIndex(index, "/nowhere/c.txt"));
});

test("test_the_single_file_loader_with_the_index_gives_the_same_events_as_without_it", (t) => {
    // Scenario: the same project; one loader scans the logs, the other reads the lines named by the index.
    const project = writeProjectWithScript(t);
    const index = buildLineSourceIndex(captureLinesOfScan(project));
    const projectFiles = listProjectFilesOfProject(project);
    const scanningLoader = createSingleFileEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder]);
    const indexedLoader = createSingleFileEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder], undefined, index);
    // the events of each file are equal, sources included.
    for (const fileIndex of [0, 1]) {
        assert.ok(scanningLoader(fileIndex).length > 0);
        assert.equal(JSON.stringify(indexedLoader(fileIndex)), JSON.stringify(scanningLoader(fileIndex)));
    }
});

test("test_writing_the_project_cache_writes_the_line_source_index_beside_it", (t) => {
    // Scenario: the project cache of the project is built by the one scan of the logs and written.
    const project = writeProjectWithScript(t);
    const cacheFile = writeProjectCacheOfProject(project);
    // the index file exists beside the cache file and holds an entry for every project file of the cache.
    const index = readLineSourceIndex(getLineSourceIndexFile(cacheFile));
    const cache = readProjectCache(cacheFile);
    assert.ok(cache.projectFiles.length > 0);
    for (const file of cache.projectFiles) {
        assert.ok(index.refsByFile[file.toString()] !== undefined, file.toString());
    }
});

test("test_the_index_file_is_written_and_read_back_beside_the_cache_file", (t) => {
    // Scenario: an index is written to the index file of a cache file.
    const project = writeProjectWithScript(t);
    const index = buildLineSourceIndex(captureLinesOfScan(project));
    const indexFile = getLineSourceIndexFile(new Path(join(project.rootFolder, "project-cache.json")));
    writeLineSourceIndex(indexFile, index);
    // the index file is in the folder of the cache file, and reading it gives the same index.
    assert.equal(indexFile.toString(), join(project.rootFolder, "lines-index.json"));
    assert.deepEqual(readLineSourceIndex(indexFile), index);
});
