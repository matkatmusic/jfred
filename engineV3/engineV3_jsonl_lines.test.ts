import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { getJSONLLineKind, JSONLLineKind, type JSONLLine } from "./engineV3.ts";
import { getFirstLineTime, loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-jsonl-lines-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeUserLine(uuid: string, secondsPastMidnight: number, extraFields: object): string {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, secondsPastMidnight)).toISOString();
    return JSON.stringify({ type: "user", uuid, timestamp, ...extraFields });
}

function writeJSONLFile(folder: string, fileName: string, lines: string[]): void {
    writeFileSync(join(folder, fileName), lines.join("\n") + "\n");
}

function listUuids(folder: string): string[] {
    const uuids: string[] = [];
    for (const line of loadMergedJSONLLines([folder]).jsonlLines) {
        uuids.push(String(line.uuid));
    }
    return uuids;
}

test("test_loadMergedJSONLLines_orders_lines_of_two_files_by_time", (t) => {
    // Scenario: lines from two files sort by time.
    const folder = makeTempFolder(t);
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {}), makeUserLine("c", 40, {})]);
    writeJSONLFile(folder, "two.jsonl", [makeUserLine("b", 30, {})]);
    assert.deepEqual(listUuids(folder), ["a", "b", "c"]);
});

test("test_loadMergedJSONLLines_reads_the_same_folders_once", (t) => {
    // Scenario: a second call for the same folders gives the very same lines without reading the files again.
    const folder = makeTempFolder(t);
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {})]);
    const firstLoad = loadMergedJSONLLines([folder]);
    const secondLoad = loadMergedJSONLLines([folder]);
    assert.equal(secondLoad, firstLoad);
});

test("test_loadMergedJSONLLines_keeps_a_line_without_timestamp_after_the_line_before_it", (t) => {
    // Scenario: a last-prompt line without timestamp stays right after the 20s line.
    const folder = makeTempFolder(t);
    const lastPromptLine = JSON.stringify({ type: "last-prompt", leafUuid: "l1", sessionId: "s1" });
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {}), lastPromptLine, makeUserLine("c", 40, {})]);
    writeJSONLFile(folder, "two.jsonl", [makeUserLine("b", 30, {})]);
    const merged = loadMergedJSONLLines([folder]).jsonlLines;
    assert.deepEqual([merged[0]?.type, merged[1]?.type, merged[2]?.type], ["user", "last-prompt", "user"]);
});

test("test_loadMergedJSONLLines_keeps_unknown_type_lines_in_place_and_lists_the_type_once", (t) => {
    // Scenario: bogus-type lines stay in place, are listed once, and get the Skip kind.
    const folder = makeTempFolder(t);
    const bogusLine = JSON.stringify({ type: "bogus-type", timestamp: "2026-01-01T00:00:25.000Z" });
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {}), bogusLine, bogusLine, makeUserLine("c", 40, {})]);
    const result = loadMergedJSONLLines([folder]);
    const types = [result.jsonlLines[0]?.type, result.jsonlLines[1]?.type, result.jsonlLines[2]?.type, result.jsonlLines[3]?.type];
    assert.deepEqual(types, ["user", "bogus-type", "bogus-type", "user"]);
    assert.deepEqual(result.unknownRecordTypes, ["bogus-type"]);
    assert.equal(getJSONLLineKind(result.jsonlLines[1] as JSONLLine, new Path(folder)), JSONLLineKind.Skip);
});

test("test_loadMergedJSONLLines_gives_an_unknown_type_line_its_file_and_line_number", (t) => {
    // Scenario: an atis-latch line on line 2 has a record source naming its file and line.
    const folder = makeTempFolder(t);
    const atisLatchLine = JSON.stringify({ type: "atis-latch", timestamp: "2026-01-01T00:00:25.000Z" });
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {}), atisLatchLine]);
    const atisLatchRecord = loadMergedJSONLLines([folder]).jsonlLines.find((line) => String(line.type) === "atis-latch") as JSONLLine;
    assert.deepEqual(getRecordSource(atisLatchRecord), { filePath: join(folder, "one.jsonl"), lineNumber: 2 });
});

test("test_loadMergedJSONLLines_throws_naming_the_file_and_line_of_bad_json", (t) => {
    // Scenario: a line of bad JSON on line 2 still throws with file, line number and text.
    const folder = makeTempFolder(t);
    const badJsonLine = "{not json";
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {}), badJsonLine]);
    const expectedPart = `${join(folder, "one.jsonl")}:2`;
    const hasFileLineAndText = (error: Error): boolean => error.message.includes(expectedPart) && error.message.includes(badJsonLine);
    assert.throws(() => loadMergedJSONLLines([folder]), hasFileLineAndText);
});

test("test_loadMergedJSONLLines_loads_a_copied_transcript_once", (t) => {
    // Scenario: a source-a1 folder holds a byte-identical copy of one.jsonl; its lines load once.
    const folder = makeTempFolder(t);
    const copyFolder = join(folder, "source-a1", "projects", "proj");
    mkdirSync(copyFolder, { recursive: true });
    const lines = [makeUserLine("a", 20, {}), makeUserLine("b", 30, {})];
    writeJSONLFile(folder, "one.jsonl", lines);
    writeJSONLFile(copyFolder, "one.jsonl", lines);
    assert.deepEqual(listUuids(folder), ["a", "b"]);
});

test("test_loadMergedJSONLLines_loads_same_named_files_with_different_content_both", (t) => {
    // Scenario: two files named one.jsonl hold different lines; both load.
    const folder = makeTempFolder(t);
    const otherFolder = join(folder, "other");
    mkdirSync(otherFolder);
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, {})]);
    writeJSONLFile(otherFolder, "one.jsonl", [makeUserLine("b", 30, {})]);
    assert.deepEqual(listUuids(folder), ["a", "b"]);
});

test("test_getFirstLineTime_returns_the_earliest_timestamp_even_when_a_line_has_none", (t) => {
    // Scenario: a line with no timestamp comes first, and the earliest stamped line is last in the file.
    const folder = makeTempFolder(t);
    const noTimestampLine = JSON.stringify({ type: "last-prompt", leafUuid: "x", sessionId: "s" });
    writeJSONLFile(folder, "one.jsonl", [noTimestampLine, makeUserLine("late", 50, {}), makeUserLine("early", 20, {})]);
    const jsonlLines = loadMergedJSONLLines([folder]).jsonlLines;
    assert.equal(getFirstLineTime(jsonlLines).toISOString(), "2026-01-01T00:00:20.000Z");
});

test("test_loadMergedJSONLLines_lists_an_unknown_field_once_and_still_loads", (t) => {
    // Scenario: two lines share one unknown field; it is listed once.
    const folder = makeTempFolder(t);
    writeJSONLFile(folder, "one.jsonl", [makeUserLine("a", 20, { bogusField: 1 }), makeUserLine("b", 30, { bogusField: 2 })]);
    const result = loadMergedJSONLLines([folder]);
    assert.equal(result.jsonlLines.length, 2);
    assert.deepEqual(result.unknownFields, [{ recordType: "user", fieldName: "bogusField" }]);
});
