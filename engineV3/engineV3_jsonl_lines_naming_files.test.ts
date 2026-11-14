import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { loadJSONLLinesNamingFiles } from "./engineV3_jsonl_lines_naming_files.ts";
import { loadJSONLLinesNamingFile } from "./engineV3_replay_reverse.ts";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-naming-files-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInstant(second: number, offsetMilliseconds: number = 0): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000 + offsetMilliseconds);
}

function makeCallRecord(toolUseId: string, filePaths: string[], second: number): object {
    const content = filePaths.map((filePath, index) => ({ type: "tool_use", id: `${toolUseId}-${index}`, name: "Write", input: { file_path: filePath, content: "x" }, caller: { type: "direct" } }));
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: makeInstant(second, -1).toISOString(), cwd: "/work", message: { role: "assistant", content } };
}

function makeResultRecord(toolUseId: string, filePath: string, second: number): object {
    const content = [{ type: "tool_result", tool_use_id: `${toolUseId}-0`, content: "ok" }];
    const toolUseResult = { type: "create", filePath, content: "x", originalFile: null, structuredPatch: [], userModified: false };
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content }, toolUseResult };
}

function makeUnrelatedRecord(second: number): object {
    return { type: "user", uuid: `unrelated-${second}`, timestamp: makeInstant(second).toISOString(), cwd: "/work", message: { role: "user", content: "hello" } };
}

function writeRecords(jsonlsFolder: string, fileName: string, records: object[]): void {
    const filePath = join(jsonlsFolder, fileName);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function makeJsonlsFolder(t: TestContext): string {
    const jsonlsFolder = join(makeTempFolder(t), "projects", "p");
    mkdirSync(jsonlsFolder, { recursive: true });
    return jsonlsFolder;
}

function summarizeSources(records: JSONLLine[]): unknown[] {
    return records.map((record) => getRecordSource(record));
}

function assertListsEqualSingleFileLoader(file: Path, namingFilesLines: JSONLLine[], jsonlsFolders: Path[]): void {
    const singleFileLines = loadJSONLLinesNamingFile(file, jsonlsFolders);
    assert.ok(singleFileLines.length > 0);
    assert.deepStrictEqual(namingFilesLines, singleFileLines);
    assert.deepStrictEqual(summarizeSources(namingFilesLines), summarizeSources(singleFileLines));
}

test("test_each_file_gets_the_list_the_single_file_loader_gives", (t) => {
    // Three files are each named by their own Write call and result in two transcripts.
    const jsonlsFolder = makeJsonlsFolder(t);
    const files = [new Path("/work/alpha.ts"), new Path("/work/beta.ts"), new Path("/work/gamma.ts")];
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeUnrelatedRecord(1),
        makeCallRecord("a1", ["/work/alpha.ts"], 2),
        makeResultRecord("a1", "/work/alpha.ts", 2),
        makeUnrelatedRecord(3),
        makeCallRecord("b1", ["/work/beta.ts"], 4),
        makeResultRecord("b1", "/work/beta.ts", 4),
    ]);
    writeRecords(jsonlsFolder, "two.jsonl", [
        makeCallRecord("g1", ["/work/gamma.ts"], 5),
        makeResultRecord("g1", "/work/gamma.ts", 5),
        makeCallRecord("a2", ["/work/alpha.ts"], 6),
        makeResultRecord("a2", "/work/alpha.ts", 6),
    ]);
    // Load all three files in one call.
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFile = loadJSONLLinesNamingFiles(files, jsonlsFolders);
    // Each list matches the single-file loader: same records, same order, same record source.
    for (const file of files) {
        assertListsEqualSingleFileLoader(file, linesByFile.get(file.toString())!, jsonlsFolders);
    }
});

test("test_files_with_the_same_base_name_each_get_the_single_file_loader_lines", (t) => {
    // Two files share the base name util.ts but live in different folders.
    const jsonlsFolder = makeJsonlsFolder(t);
    const firstFile = new Path("/work/one/util.ts");
    const secondFile = new Path("/work/two/util.ts");
    writeRecords(jsonlsFolder, "one.jsonl", [
        makeCallRecord("u1", ["/work/one/util.ts"], 1),
        makeResultRecord("u1", "/work/one/util.ts", 1),
        makeCallRecord("u2", ["/work/two/util.ts"], 2),
        makeResultRecord("u2", "/work/two/util.ts", 2),
    ]);
    // Load both files in one call.
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFile = loadJSONLLinesNamingFiles([firstFile, secondFile], jsonlsFolders);
    // Each list matches what the single-file loader gives for that file.
    assertListsEqualSingleFileLoader(firstFile, linesByFile.get(firstFile.toString())!, jsonlsFolders);
    assertListsEqualSingleFileLoader(secondFile, linesByFile.get(secondFile.toString())!, jsonlsFolders);
});

test("test_a_base_name_inside_a_longer_base_name_matches_the_single_file_loader", (t) => {
    // Only my-index.ts is written; its name holds the shorter name index.ts.
    const jsonlsFolder = makeJsonlsFolder(t);
    const shortFile = new Path("/work/index.ts");
    const longFile = new Path("/work/my-index.ts");
    writeRecords(jsonlsFolder, "one.jsonl", [makeCallRecord("m1", ["/work/my-index.ts"], 1), makeCallRecord("i1", ["/work/index.ts"], 2)]);
    // Load both files in one call.
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFile = loadJSONLLinesNamingFiles([shortFile, longFile], jsonlsFolders);
    // The shorter name still finds the line of the longer name, and each list equals the single-file loader.
    assert.equal(linesByFile.get(shortFile.toString())!.length, 2);
    assertListsEqualSingleFileLoader(shortFile, linesByFile.get(shortFile.toString())!, jsonlsFolders);
    assertListsEqualSingleFileLoader(longFile, linesByFile.get(longFile.toString())!, jsonlsFolders);
});

test("test_a_line_naming_two_input_files_is_in_both_lists", (t) => {
    // One Write call names both alpha.ts and beta.ts in one transcript line.
    const jsonlsFolder = makeJsonlsFolder(t);
    const alphaFile = new Path("/work/alpha.ts");
    const betaFile = new Path("/work/beta.ts");
    writeRecords(jsonlsFolder, "one.jsonl", [makeCallRecord("ab", ["/work/alpha.ts", "/work/beta.ts"], 1)]);
    // Load both files in one call.
    const linesByFile = loadJSONLLinesNamingFiles([alphaFile, betaFile], [new Path(jsonlsFolder)]);
    // The call line is in both lists, with the same line number.
    const alphaSources = summarizeSources(linesByFile.get(alphaFile.toString())!);
    const betaSources = summarizeSources(linesByFile.get(betaFile.toString())!);
    assert.equal(alphaSources.length, 1);
    assert.deepStrictEqual(alphaSources, betaSources);
});

test("test_a_file_named_by_no_line_gets_an_empty_list", (t) => {
    // Only alpha.ts is named in the transcript.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [makeCallRecord("a1", ["/work/alpha.ts"], 1), makeUnrelatedRecord(2)]);
    // Ask for alpha.ts and for missing.ts.
    const missingFile = new Path("/work/missing.ts");
    const linesByFile = loadJSONLLinesNamingFiles([new Path("/work/alpha.ts"), missingFile], [new Path(jsonlsFolder)]);
    // The map has an entry for missing.ts and the entry is empty.
    assert.equal(linesByFile.size, 2);
    assert.deepStrictEqual(linesByFile.get(missingFile.toString()), []);
});

test("test_lines_from_two_transcripts_come_out_in_the_single_file_loader_merged_order", (t) => {
    // alpha.ts is named in two transcripts with interleaved timestamps.
    const jsonlsFolder = makeJsonlsFolder(t);
    const alphaFile = new Path("/work/alpha.ts");
    writeRecords(jsonlsFolder, "one.jsonl", [makeCallRecord("a1", ["/work/alpha.ts"], 1), makeCallRecord("a3", ["/work/alpha.ts"], 3)]);
    writeRecords(jsonlsFolder, "two.jsonl", [makeCallRecord("a2", ["/work/alpha.ts"], 2), makeCallRecord("a4", ["/work/alpha.ts"], 4)]);
    // Load alpha.ts through the many-file loader.
    const jsonlsFolders = [new Path(jsonlsFolder)];
    const linesByFile = loadJSONLLinesNamingFiles([alphaFile], jsonlsFolders);
    // The order is by timestamp across both transcripts, equal to the single-file loader.
    const uuids = linesByFile.get(alphaFile.toString())!.map((record) => (record as { uuid: Uuid }).uuid.toString());
    assert.deepStrictEqual(uuids, ["call-a1", "call-a2", "call-a3", "call-a4"]);
    assertListsEqualSingleFileLoader(alphaFile, linesByFile.get(alphaFile.toString())!, jsonlsFolders);
});

test("test_each_transcript_is_read_from_disk_one_time", (t) => {
    // Two transcripts name three files.
    const jsonlsFolder = makeJsonlsFolder(t);
    writeRecords(jsonlsFolder, "one.jsonl", [makeCallRecord("a1", ["/work/alpha.ts"], 1), makeCallRecord("b1", ["/work/beta.ts"], 2)]);
    writeRecords(jsonlsFolder, "two.jsonl", [makeCallRecord("g1", ["/work/gamma.ts"], 3)]);
    const files = [new Path("/work/alpha.ts"), new Path("/work/beta.ts"), new Path("/work/gamma.ts")];
    // Load all three files with a reader that records each path it reads.
    const readPaths: string[] = [];
    const readAndRecord = (transcriptFile: Path): Buffer => {
        readPaths.push(transcriptFile.toString());
        return readFileSync(transcriptFile.toString());
    };
    loadJSONLLinesNamingFiles(files, [new Path(jsonlsFolder)], readAndRecord);
    // Each transcript path appears exactly one time.
    assert.deepStrictEqual([...readPaths].sort(), [join(jsonlsFolder, "one.jsonl"), join(jsonlsFolder, "two.jsonl")]);
});
