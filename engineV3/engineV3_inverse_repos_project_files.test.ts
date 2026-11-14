import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { listProjectFilesOnDiskAndInLogs } from "./engineV3_inverse_repos_project_files.ts";

type Scene = { projectFolder: Path; jsonlsFolder: Path };

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeCallRecord(toolName: string, toolUseId: string, input: object, second: number, cwd: string): object {
    const content = [{ type: "tool_use", id: toolUseId, name: toolName, input, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: makeInstant(second).toISOString(), cwd, message: { role: "assistant", content } };
}

function makeWriteRecords(toolUseId: string, filePath: string, content: string, second: number, cwd: string): object[] {
    const toolUseResult = { type: "create", filePath, content, originalFile: null, structuredPatch: [], userModified: false };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second + 1).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath, content }, second, cwd), resultRecord];
}

function makeBashRecord(toolUseId: string, command: string, second: number, cwd: string): object {
    return makeCallRecord("Bash", toolUseId, { command }, second, cwd);
}

// A project folder with the named files on disk (name to text) and one transcript made from the records.
function makeScene(t: TestContext, textByFileName: Record<string, string>, makeRecords: (projectFolder: string) => object[]): Scene {
    const rootFolder = mkdtempSync(join(tmpdir(), "engine-v3-project-files-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    mkdirSync(projectFolder);
    mkdirSync(jsonlsFolder);
    for (const [fileName, text] of Object.entries(textByFileName)) {
        mkdirSync(join(projectFolder, fileName, ".."), { recursive: true });
        writeFileSync(join(projectFolder, fileName), text);
    }
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), makeRecords(projectFolder).map((record) => JSON.stringify(record)).join("\n") + "\n");
    return { projectFolder: new Path(projectFolder), jsonlsFolder: new Path(jsonlsFolder) };
}

function listFileNames(scene: Scene): string[] {
    const projectFiles = listProjectFilesOnDiskAndInLogs(scene.projectFolder, [scene.jsonlsFolder]);
    return projectFiles.map((projectFile) => projectFile.file.toString().slice(scene.projectFolder.toString().length + 1));
}

test("test_a_file_on_disk_is_listed_with_its_own_path_as_transcript_file", (t) => {
    // Scenario: a file that is on disk and that the logs do not name is listed.
    // The project holds a.txt on disk and the logs name no file.
    const scene = makeScene(t, { "a.txt": "A" }, () => []);
    // The project files are listed.
    const projectFiles = listProjectFilesOnDiskAndInLogs(scene.projectFolder, [scene.jsonlsFolder]);
    // The only project file is a.txt, and the logs use the path on disk for it.
    assert.equal(projectFiles.length, 1);
    assert.equal(projectFiles[0]!.file.toString(), join(scene.projectFolder.toString(), "a.txt"));
    assert.ok(projectFiles[0]!.transcriptFile.equals(projectFiles[0]!.file));
});

test("test_a_file_that_the_logs_wrote_and_that_is_gone_now_is_listed", (t) => {
    // Scenario: the logs write gone.txt, and it is not on disk now.
    const scene = makeScene(t, { "a.txt": "A" }, (projectFolder) => makeWriteRecords("w1", join(projectFolder, "gone.txt"), "G", 1, projectFolder));
    // Both files are listed: the file on disk first, then the gone file.
    assert.deepEqual(listFileNames(scene), ["a.txt", "gone.txt"]);
});

test("test_a_file_that_the_logs_deleted_is_listed", (t) => {
    // Scenario: the logs run `rm` on gone.txt, and it is not on disk now.
    const scene = makeScene(t, {}, (projectFolder) => [makeBashRecord("b1", `rm ${join(projectFolder, "gone.txt")}`, 1, projectFolder)]);
    // The deleted file is listed.
    assert.deepEqual(listFileNames(scene), ["gone.txt"]);
});

test("test_the_source_of_a_move_that_the_logs_ran_is_listed", (t) => {
    // Scenario: the logs run `mv a.txt b.txt`; only b.txt is on disk now.
    const scene = makeScene(t, { "b.txt": "B" }, (projectFolder) => [makeBashRecord("b1", `mv ${join(projectFolder, "a.txt")} ${join(projectFolder, "b.txt")}`, 1, projectFolder)]);
    // The source a.txt is listed after the file b.txt on disk.
    assert.deepEqual(listFileNames(scene), ["b.txt", "a.txt"]);
});

test("test_the_source_of_a_copy_that_the_logs_ran_is_listed", (t) => {
    // Scenario: the logs run `cp a.txt b.txt`; only b.txt is on disk now.
    const scene = makeScene(t, { "b.txt": "B" }, (projectFolder) => [makeBashRecord("b1", `cp ${join(projectFolder, "a.txt")} ${join(projectFolder, "b.txt")}`, 1, projectFolder)]);
    // The source a.txt is listed after the file b.txt on disk.
    assert.deepEqual(listFileNames(scene), ["b.txt", "a.txt"]);
});

test("test_a_path_outside_the_project_folder_is_not_listed", (t) => {
    // Scenario: the logs write a file in a folder next to the project folder.
    const scene = makeScene(t, {}, (projectFolder) => makeWriteRecords("w1", join(projectFolder, "..", "other", "out.txt"), "O", 1, projectFolder));
    // The file is not listed.
    assert.deepEqual(listFileNames(scene), []);
});

test("test_a_gone_path_under_node_modules_is_not_listed", (t) => {
    // Scenario: the logs write a file under node_modules, and a normal gone file.
    const scene = makeScene(t, {}, (projectFolder) => [
        ...makeWriteRecords("w1", join(projectFolder, "node_modules", "pkg", "index.js"), "N", 1, projectFolder),
        ...makeWriteRecords("w2", join(projectFolder, "gone.txt"), "G", 3, projectFolder),
    ]);
    // Only the normal gone file is listed.
    assert.deepEqual(listFileNames(scene), ["gone.txt"]);
});

test("test_a_gone_path_under_a_folder_that_gitignore_names_is_not_listed", (t) => {
    // Scenario: .gitignore names the folder build/, and the logs write a file in it.
    const scene = makeScene(t, { ".gitignore": "build/\n" }, (projectFolder) => makeWriteRecords("w1", join(projectFolder, "build", "out.txt"), "O", 1, projectFolder));
    // Only .gitignore is listed.
    assert.deepEqual(listFileNames(scene), [".gitignore"]);
});

test("test_a_path_that_names_a_folder_on_disk_is_not_listed", (t) => {
    // Scenario: the logs move a folder src to dst; dst is a folder on disk now.
    const scene = makeScene(t, { "dst/x.txt": "X" }, (projectFolder) => [makeBashRecord("b1", `mv ${join(projectFolder, "src")} ${join(projectFolder, "dst")}`, 1, projectFolder)]);
    // The folder dst is not a file, so only dst/x.txt and the gone src are listed.
    assert.deepEqual(listFileNames(scene), ["dst/x.txt", "src"]);
});

test("test_no_path_is_listed_twice", (t) => {
    // Scenario: a.txt is on disk, and the logs write it twice; gone.txt is written twice.
    const scene = makeScene(t, { "a.txt": "A" }, (projectFolder) => [
        ...makeWriteRecords("w1", join(projectFolder, "a.txt"), "A", 1, projectFolder),
        ...makeWriteRecords("w2", join(projectFolder, "a.txt"), "A", 3, projectFolder),
        ...makeWriteRecords("w3", join(projectFolder, "gone.txt"), "G", 5, projectFolder),
        ...makeWriteRecords("w4", join(projectFolder, "gone.txt"), "G", 7, projectFolder),
    ]);
    // Each path is listed once.
    assert.deepEqual(listFileNames(scene), ["a.txt", "gone.txt"]);
});

test("test_the_gone_files_are_sorted_by_path_after_the_files_on_disk", (t) => {
    // Scenario: the logs write z-gone.txt before a-gone.txt; m.txt is on disk.
    const scene = makeScene(t, { "m.txt": "M" }, (projectFolder) => [
        ...makeWriteRecords("w1", join(projectFolder, "z-gone.txt"), "Z", 1, projectFolder),
        ...makeWriteRecords("w2", join(projectFolder, "a-gone.txt"), "A", 3, projectFolder),
    ]);
    // The file on disk comes first; the gone files follow in path order.
    assert.deepEqual(listFileNames(scene), ["m.txt", "a-gone.txt", "z-gone.txt"]);
});
