import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { loadJSONLLinesNamingFiles } from "./engineV3_jsonl_lines_naming_files.ts";
import { addLinesNamingWrittenScripts } from "./engineV3_jsonl_lines_naming_scripts.ts";

const TARGET_FILE = new Path("/work/core_alpha.py");
const SCRIPT_NAME = "move_files.py";

function makeJsonlsFolder(t: TestContext): string {
    const root = mkdtempSync(join(tmpdir(), "engine-v3-naming-scripts-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const jsonlsFolder = join(root, "projects", "p");
    mkdirSync(jsonlsFolder, { recursive: true });
    return jsonlsFolder;
}

function makeInstant(second: number): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000).toISOString();
}

function makeScriptWriteRecord(scriptName: string, scriptBody: string, second: number): object {
    const content = [{ type: "tool_use", id: `write-${scriptName}-${second}`, name: "Write", input: { file_path: `/work/${scriptName}`, content: scriptBody }, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `write-${scriptName}-${second}`, timestamp: makeInstant(second), cwd: "/work", message: { role: "assistant", content } };
}

function makeScriptRunRecord(scriptName: string, second: number, commandSuffix: string = ""): object {
    const content = [{ type: "tool_use", id: `run-${scriptName}-${second}`, name: "Bash", input: { command: `python3 ${scriptName}${commandSuffix}` }, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `run-${scriptName}-${second}`, timestamp: makeInstant(second), cwd: "/work", message: { role: "assistant", content } };
}

function writeRecords(jsonlsFolder: string, fileName: string, records: object[]): void {
    writeFileSync(join(jsonlsFolder, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function listSourceKeys(lines: JSONLLine[]): string[] {
    return lines.map((line) => {
        const source = getRecordSource(line)!;
        return `${source.filePath}:${source.lineNumber}`;
    });
}

function listTimestamps(lines: JSONLLine[]): number[] {
    return lines.map((line) => line.timestamp!.getTime());
}

function loadInitialLines(jsonlsFolders: Path[]): Map<string, JSONLLine[]> {
    return loadJSONLLinesNamingFiles([TARGET_FILE], jsonlsFolders);
}

test("test_run_line_of_a_script_that_names_the_file_is_added", (t) => {
    // A transcript writes move_files.py with a body that names core_alpha.py, then runs `python3 move_files.py`.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeScriptWriteRecord(SCRIPT_NAME, "open('core_alpha.py','w').write('x')", 1),
        makeScriptRunRecord(SCRIPT_NAME, 2),
    ]);
    const jsonlsFolders = [new Path(jsonlsFolder)];
    // The list of core_alpha.py starts with the Write line only.
    const linesByFileKey = loadInitialLines(jsonlsFolders);
    assert.equal(linesByFileKey.get(TARGET_FILE.toString())!.length, 1);
    // Add the lines naming written scripts.
    addLinesNamingWrittenScripts(linesByFileKey, [TARGET_FILE], jsonlsFolders);
    // The list now also holds the run line.
    const lines = linesByFileKey.get(TARGET_FILE.toString())!;
    assert.equal(lines.length, 2);
    assert.deepStrictEqual(listSourceKeys(lines).map((key) => key.split(":")[1]), ["1", "2"]);
});

test("test_script_that_does_not_name_the_file_adds_nothing", (t) => {
    // core_alpha.py is written directly. move_files.py is written with a body that does not name core_alpha.py, then run.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeScriptWriteRecord("core_alpha.py", "x = 1", 1),
        makeScriptWriteRecord(SCRIPT_NAME, "print('hello')", 2),
        makeScriptRunRecord(SCRIPT_NAME, 3),
    ]);
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFileKey = loadInitialLines(jsonlsFolders);
    const linesBefore = [...linesByFileKey.get(TARGET_FILE.toString())!];
    // Add the lines naming written scripts.
    addLinesNamingWrittenScripts(linesByFileKey, [TARGET_FILE], jsonlsFolders);
    // The run line of move_files.py is not added: its body does not name core_alpha.py.    assert.deepStrictEqual(listSourceKeys(linesByFileKey.get(TARGET_FILE.toString())!), listSourceKeys(linesBefore));
});

test("test_no_script_write_reads_no_transcript", (t) => {
    // The only line naming core_alpha.py is a Write of a data file, not a script.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeScriptWriteRecord("notes.txt", "core_alpha.py is the target", 1),
    ]);
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFileKey = loadInitialLines(jsonlsFolders);
    // Add the lines naming written scripts with a counting reader.
    let readCount = 0;
    const countingReader = (transcriptFile: Path): Buffer => {
        readCount += 1;
        return readFileSync(transcriptFile.toString());
    };
    addLinesNamingWrittenScripts(linesByFileKey, [TARGET_FILE], jsonlsFolders, countingReader);
    // No transcript was read.
    assert.equal(readCount, 0);
});

test("test_line_already_in_the_list_is_not_added_twice", (t) => {
    // The run line itself names core_alpha.py, so the first load already holds it.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeScriptWriteRecord(SCRIPT_NAME, "open('core_alpha.py','w').write('x')", 1),
        makeScriptRunRecord(SCRIPT_NAME, 2, " # core_alpha.py"),
        makeScriptWriteRecord("again.py", "# core_alpha.py", 3),
    ]);
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFileKey = loadInitialLines(jsonlsFolders);
    const keysBefore = listSourceKeys(linesByFileKey.get(TARGET_FILE.toString())!);
    assert.equal(keysBefore.length, 3);
    // Add the lines naming written scripts twice.
    addLinesNamingWrittenScripts(linesByFileKey, [TARGET_FILE], jsonlsFolders);
    addLinesNamingWrittenScripts(linesByFileKey, [TARGET_FILE], jsonlsFolders);
    // Every source line appears once. The run line (line 2) appears once.
    const keysAfter = listSourceKeys(linesByFileKey.get(TARGET_FILE.toString())!);
    assert.equal(new Set(keysAfter).size, keysAfter.length);
    assert.equal(keysAfter.filter((key) => key.endsWith(":2")).length, 1);
});

test("test_added_lines_keep_timestamp_order", (t) => {
    // The run lines come from a second transcript and fall between and after the Write lines of the first.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeScriptWriteRecord(SCRIPT_NAME, "open('core_alpha.py','w').write('1')", 1),
        makeScriptWriteRecord(SCRIPT_NAME, "open('core_alpha.py','w').write('3')", 3),
    ]);
    writeRecords(jsonlsFolder, "two.jsonl", [
        makeScriptRunRecord(SCRIPT_NAME, 2),
        makeScriptRunRecord(SCRIPT_NAME, 4),
    ]);
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFileKey = loadInitialLines(jsonlsFolders);
    // Add the lines naming written scripts.
    addLinesNamingWrittenScripts(linesByFileKey, [TARGET_FILE], jsonlsFolders);
    // The list holds all four lines in timestamp order.
    const timestamps = listTimestamps(linesByFileKey.get(TARGET_FILE.toString())!);
    assert.equal(timestamps.length, 4);
    assert.deepStrictEqual(timestamps, [...timestamps].sort((left, right) => left - right));
});
